import { useCallback, useEffect, useMemo, useState } from 'react';
import { notificationsApi, type NotificationResponse } from '../services';

export type NotificationKind = 'transaction' | 'budget' | 'category' | 'system' | 'data';
export type AppNotification = {
  id: string; kind: NotificationKind; message: string; time: string; read: boolean;
  values?: Record<string, string | number>;
};

const POLL_MS = 60_000;
const PAGE_SIZE = 50;

const toItem = (n: NotificationResponse): AppNotification => ({
  id: n.id, kind: n.source === 'Budget' ? 'budget' : 'system', message: n.message, time: n.createdAt, read: n.isRead,
});

/** Server-side notifications for the signed-in user. Polls while signed in and refreshes on window focus. */
export function useNotifications(userId: string | undefined) {
  const [items, setItems] = useState<AppNotification[]>([]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const page = await notificationsApi.listNotifications({ page: 1, pageSize: PAGE_SIZE });
      setItems(page.items.map(toItem));
    } catch { /* keep the last known list; the next poll retries */ }
  }, [userId]);

  useEffect(() => {
    setItems([]);
    if (!userId) return;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [userId, refresh]);

  const unread = useMemo(() => items.filter(n => !n.read).length, [items]);

  // Optimistic updates, rolled back by a refresh when the request fails.
  const markRead = useCallback((id: string) => {
    setItems(old => old.map(n => n.id === id ? { ...n, read: true } : n));
    notificationsApi.markNotificationRead(id).catch(() => refresh());
  }, [refresh]);
  const markAllRead = useCallback(() => {
    setItems(old => old.map(n => n.read ? n : { ...n, read: true }));
    notificationsApi.markAllNotificationsRead().catch(() => refresh());
  }, [refresh]);
  const remove = useCallback((id: string) => {
    setItems(old => old.filter(n => n.id !== id));
    notificationsApi.deleteNotification(id).catch(() => refresh());
  }, [refresh]);
  const clear = useCallback(() => {
    const ids = items.map(n => n.id);
    setItems([]);
    Promise.all(ids.map(id => notificationsApi.deleteNotification(id))).catch(() => undefined).finally(() => void refresh());
  }, [items, refresh]);

  return { items, unread, refresh, markAllRead, markRead, remove, clear };
}
