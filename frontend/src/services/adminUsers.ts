import { http, getData } from './client';
import type { AdminUserQuery, AdminUserResponse, AIQuotaSettingsResponse, PagedResult } from './types';

/** Newest accounts first. Requires the Admin role (enforced by the backend). */
export const listUsers = (query: AdminUserQuery = {}) =>
  getData(http.get<PagedResult<AdminUserResponse>>('/admin/users', { params: query }));
export const getUser = (id: string) => getData(http.get<AdminUserResponse>(`/admin/users/${id}`));
/** Locks the account and revokes its refresh tokens. The backend refuses admins and your own account. */
export const lockUser = (id: string, reason: string) =>
  getData(http.post<AdminUserResponse>(`/admin/users/${id}/lock`, { reason }));
/** Unlocks the account and clears any failed-login lockout. */
export const unlockUser = (id: string) => getData(http.post<AdminUserResponse>(`/admin/users/${id}/unlock`));
/** Grants 10, 20 or 50 AI messages per day, or unlimited (-1). null returns the user to the system default. */
export const setAIQuota = (id: string, dailyLimit: number | null) =>
  getData(http.put<AdminUserResponse>(`/admin/users/${id}/ai-quota`, { dailyLimit }));
/** The default daily limit (for users without their own) and the values an admin may choose. */
export const getAIQuotaSettings = () => getData(http.get<AIQuotaSettingsResponse>('/admin/ai/quota'));
export const setDefaultAIQuota = (dailyLimit: number) =>
  getData(http.put<AIQuotaSettingsResponse>('/admin/ai/quota/default', { dailyLimit }));