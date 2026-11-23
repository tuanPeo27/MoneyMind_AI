import { useCallback, useEffect, useState } from 'react';

export type AuthUser = {
  id: string; fullName: string; email: string; phoneNumber?: string | null; avatarUrl?: string | null; roles: string[];
  createdAt?: string; lastLoginAt?: string | null;
  /** Missing in sessions saved before this field existed: treat anything but `false` as "has a password". */
  hasPassword?: boolean;
};
export type AuthSession = { accessToken: string; refreshToken: string; accessTokenExpiresAt: string; user: AuthUser };

const SESSION_KEY = 'mm-auth-session-v1';
const SESSION_EVENT = 'mm-auth-session-change';

export function getSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) as AuthSession : null;
  } catch { return null; }
}

export function setSession(session: AuthSession | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* storage unavailable: session lasts only until reload */ }
  window.dispatchEvent(new Event(SESSION_EVENT));
}

/** Patch the cached user without touching the tokens (used after editing the profile). */
export function patchSessionUser(patch: Partial<AuthUser>) {
  const current = getSession();
  if (current) setSession({ ...current, user: { ...current.user, ...patch } });
}

export function useSession() {
  const [session, setState] = useState<AuthSession | null>(getSession);
  useEffect(() => {
    const update = () => setState(getSession());
    window.addEventListener(SESSION_EVENT, update);
    window.addEventListener('storage', update);
    return () => { window.removeEventListener(SESSION_EVENT, update); window.removeEventListener('storage', update); };
  }, []);
  // signOut is wired up in ./auth to avoid a circular import with the axios client.
  const signOut = useCallback(() => import('./auth').then(m => m.logout()), []);
  return { session, signOut };
}
