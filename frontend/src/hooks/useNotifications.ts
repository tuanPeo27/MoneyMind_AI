import { useCallback } from 'react';
import { useLocal } from './useLocal';

export type NotificationKind = 'transaction' | 'budget' | 'category' | 'system' | 'data';
export type AppNotification = {
  id: string; kind: NotificationKind; message: string; time: string; read: boolean;
  values?: Record<string, string | number>;
};

const KEY = 'mm-notifications-v1';
const MAX = 50;

const seed = (): AppNotification[] => [{
  id: 'seed-budget', kind: 'budget', read: false,
  message: 'Time for a budget check-in',
  time: new Date(Date.now() - 36e5).toISOString(),
}];

export function useNotifications() {
  const [items, setItems] = useLocal<AppNotification[]>(KEY, seed);
  const unread = items.filter(n => !n.read).length;

  const add = useCallback((message: string, kind: NotificationKind = 'system', values?: Record<string, string | number>) => {
    setItems(old => [{ id: crypto.randomUUID(), kind, message, values, time: new Date().toISOString(), read: false }, ...old].slice(0, MAX));
  }, [setItems]);
  const markAllRead = useCallback(() => setItems(old => old.map(n => n.read ? n : { ...n, read: true })), [setItems]);
  const markRead = useCallback((id: string) => setItems(old => old.map(n => n.id === id ? { ...n, read: true } : n)), [setItems]);
  const remove = useCallback((id: string) => setItems(old => old.filter(n => n.id !== id)), [setItems]);
  const clear = useCallback(() => setItems([]), [setItems]);

  return { items, unread, add, markAllRead, markRead, remove, clear };
}
