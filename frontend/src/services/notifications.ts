import { http, getData } from './client';
import type { NotificationQuery, NotificationResponse, PagedResult, UnreadCountResponse } from './types';

export const listNotifications = (query: NotificationQuery = {}) =>
  getData(http.get<PagedResult<NotificationResponse>>('/notifications', { params: query }));
export const getUnreadCount = () => getData(http.get<UnreadCountResponse>('/notifications/unread-count'));
export const markNotificationRead = (id: string) => http.put(`/notifications/${id}/read`).then(() => undefined);
export const markAllNotificationsRead = () => http.put('/notifications/read-all').then(() => undefined);
export const deleteNotification = (id: string) => http.delete(`/notifications/${id}`).then(() => undefined);
