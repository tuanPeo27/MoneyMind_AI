import { http, getData } from './client';
import { getSession, setSession } from './session';
import type { AuthResponse, MessageResponse, SessionResponse } from './types';

export async function login(email: string, password: string) {
  const session = await getData(http.post<AuthResponse>('/auth/login', { email, password }));
  setSession(session);
  return session;
}

export async function register(fullName: string, email: string, password: string) {
  const session = await getData(http.post<AuthResponse>('/auth/register', { fullName, email, password }));
  setSession(session);
  return session;
}

/** Sign in (or sign up) with the ID token Google Identity Services returned. The backend verifies it. */
export async function loginWithGoogle(idToken: string) {
  const session = await getData(http.post<AuthResponse>('/auth/google', { idToken }));
  setSession(session);
  return session;
}

/** Clear the local session and revoke the refresh token on the server (best effort). */
export async function logout() {
  const current = getSession();
  setSession(null);
  if (current?.refreshToken) await http.post('/auth/logout', { refreshToken: current.refreshToken }).catch(() => undefined);
}

export const forgotPassword = (email: string) => getData(http.post<MessageResponse>('/auth/forgot-password', { email }));
export const resetPassword = (token: string, newPassword: string) => getData(http.post<MessageResponse>('/auth/reset-password', { token, newPassword }));
export const listSessions = () => getData(http.get<SessionResponse[]>('/auth/sessions'));
export const revokeSession = (id: string) => http.delete(`/auth/sessions/${id}`).then(() => undefined);
export const logoutAll = () => http.post('/auth/logout-all').then(() => undefined);
