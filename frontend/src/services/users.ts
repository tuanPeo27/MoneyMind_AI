import { http, getData } from './client';
import { getSession, patchSessionUser } from './session';
import type { ChangePasswordRequest, MessageResponse, UpdateProfileRequest, UserResponse } from './types';

export const getProfile = () => getData(http.get<UserResponse>('/users/me'));

export async function updateProfile(request: UpdateProfileRequest) {
  // Keep the current avatar unless the caller sets a new one: the backend treats an empty value as "remove".
  const body = { ...request, avatarUrl: request.avatarUrl ?? getSession()?.user.avatarUrl ?? null };
  const user = await getData(http.put<UserResponse>('/users/me', body));
  patchSessionUser({ fullName: user.fullName, phoneNumber: user.phoneNumber, avatarUrl: user.avatarUrl });
  return user;
}

export const changePassword = (request: ChangePasswordRequest) =>
  getData(http.put<MessageResponse>('/users/me/password', request));
