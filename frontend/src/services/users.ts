import { http, getData } from './client';
import { patchSessionUser } from './session';
import type { ChangePasswordRequest, MessageResponse, UpdateProfileRequest, UserResponse } from './types';

export const getProfile = () => getData(http.get<UserResponse>('/users/me'));

export async function updateProfile(request: UpdateProfileRequest) {
  const user = await getData(http.put<UserResponse>('/users/me', request));
  patchSessionUser({ fullName: user.fullName, phoneNumber: user.phoneNumber });
  return user;
}

export const changePassword = (request: ChangePasswordRequest) =>
  getData(http.put<MessageResponse>('/users/me/password', request));
