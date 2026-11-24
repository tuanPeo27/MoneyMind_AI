import { useMemo } from 'react';
import { ArrowLeftRight, Wallet, Shapes, Database, Bell, CheckCheck, PiggyBank, Trash2, X, type LucideIcon } from 'lucide-react';
import { useLanguage } from '../i18n';
import { Button, Card, Empty, IconButton } from '../components/ui';
import type { AppNotification, NotificationKind } from '../hooks/useNotifications';
import { LoadingStatus, Skeleton, SkeletonText, useFadeIn } from '../components/Skeleton';

const meta: Record<NotificationKind, { icon: LucideIcon; tone: string }> = {
  transaction: { icon: ArrowLeftRight, tone: 'text-brand bg-brand/10' },
  budget: { icon: Wallet, tone: 'text-ai bg-ai/10' },
  goal: { icon: PiggyBank, tone: 'text-positive bg-positive/10' },
  category: { icon: Shapes, tone: 'text-chart-tertiary bg-chart-tertiary/10' },
  data: { icon: Database, tone: 'text-positive bg-positive/10' },
  system: { icon: Bell, tone: 'text-muted bg-line/60' },
};

function relativeTime(iso: string, locale: string, t: (s: string, v?: Record<string, string | number>) => string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return t('Just now');
  if (mins < 60) return t('{n} min ago', { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t('{n}h ago', { n: hours });
  const days = Math.round(hours / 24);
  if (days < 7) return t('{n}d ago', { n: days });
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

export default function NotificationsPage({ items, onMarkAllRead, onMarkRead, onRemove, onClear, loading = false }: {
  items: AppNotification[];
  /** First load: skeleton rows instead of the list or the empty state. */
  loading?: boolean;
  onMarkAllRead: () => void; onMarkRead: (id: string) => void; onRemove: (id: string) => void; onClear: () => void;
}) {
  const { t, locale } = useLanguage();
  const fade = useFadeIn(loading);
  const unread = items.filter(n => !n.read).length;
  const groups = useMemo(() => {
    const today: AppNotification[] = [], earlier: AppNotification[] = [];
    const start = new Date(); start.setHours(0, 0, 0, 0);
    items.forEach(n => (new Date(n.time) >= start ? today : earlier).push(n));
    return [{ title: 'Today', items: today }, { title: 'Earlier', items: earlier }].filter(g => g.items.length);
  }, [items]);

  return <div className="mx-auto max-w-2xl space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      {loading ? <SkeletonText className="h-5" width="w-32" /> : <p className={`text-sm text-muted ${fade}`}>{unread ? t('{n} unread', { n: unread }) : t('You are all caught up.')}</p>}
      <div className="flex gap-2">
        <Button secondary onClick={onMarkAllRead} disabled={loading || !unread}><CheckCheck className="size-4" aria-hidden="true" />{t('Mark all as read')}</Button>
        <Button secondary onClick={onClear} disabled={loading || !items.length}><Trash2 className="size-4" aria-hidden="true" />{t('Clear all')}</Button>
      </div>
    </div>
    {loading && <section className="space-y-2"><LoadingStatus label={t('Loading your data...')} />
      <SkeletonText className="h-4 px-1" bar="h-2.5" width="w-16" />
      <Card className="divide-y divide-line overflow-hidden">{[0, 1, 2, 3].map(i => <div key={i} aria-hidden="true" className="flex items-start gap-3 px-4 py-4">
        <Skeleton className="mt-0.5 size-9 shrink-0 !rounded-xl" />
        <span className="min-w-0 flex-1"><SkeletonText className="h-5" width={i % 2 ? 'w-48' : 'w-64'} /><SkeletonText className="mt-0.5 h-5" width="w-40" /><SkeletonText className="mt-0.5 h-4" bar="h-2.5" width="w-16" /></span>
      </div>)}</Card>
    </section>}
    {!loading && !items.length && <Card><Empty title={t('No notifications yet')} text={t('Activity in your workspace will show up here.')} /></Card>}
    {!loading && groups.map(group => <section key={group.title} className={`space-y-2 ${fade}`}>
      <h2 className="px-1 text-xs font-medium uppercase tracking-[0.12em] text-muted">{t(group.title)}</h2>
      <Card className="divide-y divide-line overflow-hidden">
        {group.items.map(n => {
          const { icon: Icon, tone } = meta[n.kind] ?? meta.system;
          return <div key={n.id} className={`group flex items-start gap-3 px-4 py-4 transition-colors ${n.read ? '' : 'bg-brand/[0.04]'}`}>
            <span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl ${tone}`}><Icon className="size-4" aria-hidden="true" /></span>
            <button type="button" onClick={() => onMarkRead(n.id)} className="min-w-0 flex-1 text-left focus-visible:outline-none">
              <p className="flex items-center gap-2 text-sm font-medium text-ink">{n.title ? n.title : t(n.message, n.values)}{!n.read && <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-label={t('Unread')} />}</p>
              {n.title && <p className="mt-0.5 text-sm text-muted">{t(n.message, n.values)}</p>}
              <p className="mt-0.5 text-xs text-muted">{relativeTime(n.time, locale, t)}</p>
            </button>
            <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"><IconButton icon={X} label={t('Dismiss notification')} onClick={() => onRemove(n.id)} /></span>
          </div>;
        })}
      </Card>
    </section>)}
  </div>;
}
