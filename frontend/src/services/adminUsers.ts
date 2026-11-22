import { http, getData } from './client';
import type { AdminUserQuery, AdminUserResponse, PagedResult } from './types';

/** Newest accounts first. Requires the Admin role (enforced by the backend). */
export const listUsers = (query: AdminUserQuery = {}) =>
  getData(http.get<PagedResult<AdminUserResponse>>('/admin/users', { params: query }));
export const getUser = (id: string) => getData(http.get<AdminUserResponse>(`/admin/users/${id}`));
/** Locks the account and revokes its refresh tokens. The backend refuses admins and your own account. */
export const lockUser = (id: string, reason: string) =>
  getData(http.post<AdminUserResponse>(`/admin/users/${id}/lock`, { reason }));
/** Unlocks the account and clears any failed-login lockout. */
export const unlockUser = (id: string) => getData(http.post<AdminUserResponse>(`/admin/users/${id}/unlock`));