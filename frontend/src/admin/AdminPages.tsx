import { useLanguage } from '../i18n';
import { Pagination, usePagination, type Pager } from '../components/Pagination';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Search, Eye, Lock, LockOpen, MessageSquare, Shield, Plus, Pencil, Trash2 } from 'lucide-react';
import { type PlatformUser, type PlatformTransaction, type SystemCategory, aiUsage, questionTopics } from './data';
import { money, compact, dateLabel, localDate } from '../data';
import { percent } from '../lib/currency';
import { Badge, Button, Card, Empty, Field, IconButton, Modal, Progress, SectionHead, fieldClass } from '../components/ui';
import { AdminChart } from './AdminCharts';
import { FormSelect, Select } from '../components/Select';
import { adminCategoriesApi, adminTransactionsApi, adminUsersApi, type AdminTransactionStatsResponse, type AdminUserResponse, type CategoryResponse, type CategoryType, type PagedResult } from '../services';
import { useErrorText } from '../pages/Auth';
import { QuotaBadge, QuotaDialog, limitLabel } from './AIQuota';
import { CategoryIcon, CategoryIconPicker, categoryIcons, getCategoryIcon, type CategoryIconId } from '../components/CategoryIcon';

export type ConfirmAction = { title: string; text: string; action: () => void };
export function PlatformStats({ items }: { items: { label: string; value: string; note?: string }[] }) {
  return <div className={`grid gap-4 sm:grid-cols-2 ${items.length > 4 ? 'xl:grid-cols-3' : 'xl:grid-cols-4'}`}>{items.map(s => <Card className="p-5" key={s.label}><p className="text-sm text-muted">{s.label}</p><p className="mt-3 text-[26px] font-semibold tracking-tight tabular-nums">{s.value}</p>{s.note && <p className="mt-2 text-xs text-muted">{s.note}</p>}</Card>)}</div>;
}
export function AdminTable({ headers, children, empty }: { headers: string[]; children: ReactNode; empty?: boolean }) {
  return <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-sm"><thead className="border-y border-line bg-base/40 text-xs text-muted"><tr>{headers.map(h => <th key={h} className="px-5 py-4 font-medium">{h}</th>)}</tr></thead><tbody className="divide-y divide-line [&_td]:px-5 [&_td]:py-3.5">{children}</tbody></table>{empty && <Empty title="No matching records" text="Try adjusting your search or filters." />}</div>;
}
/** Account numbers for the overview, read from /api/admin/users. `recent` is the newest page (up to 100 accounts). */
export type AdminUserStats = { total: number; active: number; recent: AdminUserResponse[] };
/** Overview: account numbers from /api/admin/users, transaction numbers from /api/admin/transactions/stats (30 days). */
export function AdminOverview({ stats, txStats }: { stats: AdminUserStats | null; txStats: AdminTransactionStatsResponse | null }) {
  const volume = txStats ? txStats.totalIncome + txStats.totalExpense : 0;
  // Cumulative registrations at each month end. Accounts older than the loaded page are counted as a baseline.
  const growth = Array.from({ length: 6 }, (_, i) => {
    const n = new Date(), end = new Date(n.getFullYear(), n.getMonth() - 5 + i + 1, 0, 23, 59, 59);
    const recent = stats?.recent ?? [];
    const older = (stats?.total ?? 0) - recent.length;
    return { name: end.toLocaleDateString('en', { month: 'short' }), users: older + recent.filter(u => new Date(u.createdAt) <= end).length };
  });
  const daily = aiUsage.map(d => ({ name: d.name, requests: d.requests }));
  const txDaily = (txStats?.daily ?? []).map(d => ({ name: shortDay(d.date), transactions: d.count }));
  const count = (value?: number) => value === undefined ? '…' : value.toLocaleString();
  return <div className="space-y-5"><PlatformStats items={[
    { label: 'Total users', value: count(stats?.total), note: 'Registered accounts' },
    { label: 'Active users', value: count(stats?.active), note: 'Accounts not locked' },
    { label: 'Total transactions', value: txStats ? txStats.transactionCount.toLocaleString() : '…', note: 'Last 30 days, all users' },
    { label: 'Financial volume', value: txStats ? money(volume) : '…', note: 'Income + expenses, last 30 days' },
    { label: 'AI requests', value: aiUsage.reduce((s, d) => s + d.requests, 0).toLocaleString(), note: 'Six-day synthetic usage sample' },
    { label: 'System status', value: 'Demo healthy', note: 'Simulated · No live health checks' },
  ]} /><div className="grid gap-5 xl:grid-cols-2"><AdminChart title="User growth" subtitle="Cumulative registrations · last six months" data={growth} dataKey="users" /><AdminChart title="Daily platform activity" subtitle="AI request events in the demo usage log" data={daily} dataKey="requests" bar /><AdminChart title="AI request volume" subtitle="Synthetic six-day sample" data={aiUsage} dataKey="requests" color="var(--color-ai)" /><AdminChart title="Transaction activity" subtitle="Transactions per day · last 30 days" data={txDaily} dataKey="transactions" bar color="var(--color-positive)" /></div></div>;
}
const isAdmin = (u: AdminUserResponse) => u.roles.includes('Admin');
const dateTime = (iso?: string | null) => iso ? new Date(iso).toLocaleString('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
/**
 * Accounts from /api/admin/users: server-side search (name or email), status filter and paging.
 * Lock asks for a reason and ends the user's sessions; unlock also clears a failed-login lockout.
 * The backend refuses to lock administrators or your own account, so those buttons are disabled here too.
 */
export function UserManagement({ currentUserId, onChanged }: { currentUserId?: string; onChanged?: () => void }) {
  const { t } = useLanguage();
  const errorText = useErrorText();
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState('All statuses');
  const [page, setPage] = useState(1), [size, setSize] = useState(10);
  const [data, setData] = useState<PagedResult<AdminUserResponse> | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState<unknown>(null);
  const [detail, setDetail] = useState<AdminUserResponse | null>(null);
  const [locking, setLocking] = useState<AdminUserResponse | null>(null), [unlocking, setUnlocking] = useState<AdminUserResponse | null>(null);
  const [quotaFor, setQuotaFor] = useState<AdminUserResponse | null>(null), [defaultLimit, setDefaultLimit] = useState<number | null>(null);
  useEffect(() => { adminUsersApi.getAIQuotaSettings().then(s => setDefaultLimit(s.defaultDailyLimit)).catch(() => undefined); }, []);
  const [busy, setBusy] = useState(false), [actionError, setActionError] = useState(''), [notice, setNotice] = useState('');
  const request = useRef(0);
  // Wait for a pause in typing before searching, then start again from page 1.
  useEffect(() => { const id = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300); return () => clearTimeout(id); }, [search]);
  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true); setError(null);
    try {
      const isActive = status === 'Active' ? true : status === 'Locked' ? false : undefined;
      const result = await adminUsersApi.listUsers({ page, pageSize: size, search: query || undefined, isActive });
      if (current !== request.current) return;
      // Deleting or locking the last row of the last page: step back to the new last page.
      if (!result.items.length && page > 1 && result.totalPages > 0) { setPage(result.totalPages); return; }
      setData(result);
    } catch (e) { if (current === request.current) setError(e); }
    finally { if (current === request.current) setLoading(false); }
  }, [page, size, query, status]);
  useEffect(() => { void load(); }, [load]);
  const pager: Pager<AdminUserResponse> = {
    items: data?.items ?? [], page, pageCount: Math.max(1, data?.totalPages ?? 1), size, total: data?.totalCount ?? 0,
    start: (page - 1) * size, setPage, setSize: next => { setSize(next); setPage(1); },
  };
  const replace = (user: AdminUserResponse) => {
    setData(old => old && { ...old, items: old.items.map(u => u.id === user.id ? user : u) });
    setDetail(d => d?.id === user.id ? user : d);
  };
  async function run(action: () => Promise<AdminUserResponse>, done: string) {
    setBusy(true); setActionError('');
    try {
      replace(await action());
      setLocking(null); setUnlocking(null); setNotice(done);
      onChanged?.();
      void load(); // the row may no longer match the status filter
    } catch (e) { setActionError(errorText(e)); }
    finally { setBusy(false); }
  }
  const lockDisabled = (u: AdminUserResponse) => u.id === currentUserId || isAdmin(u);
  return <Card><div className="flex flex-wrap items-center gap-3 p-4"><div className="relative min-w-[210px] flex-1"><Search className="absolute left-3 top-3.5 h-4 w-4 text-muted" /><input aria-label="Search users" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or email..." className={`${fieldClass} pl-10`} /></div><Select label="Filter account status" className="w-full sm:w-[170px]" value={status} onChange={value => { setStatus(value); setPage(1); }} options={['All statuses', 'Active', 'Locked'].map(v => ({ value: v, label: v }))} /></div>
    {notice && <p role="status" className="mx-4 mb-3 rounded-lg bg-positive/10 px-4 py-2.5 text-sm text-positive">{notice}</p>}
    {error != null && <div role="alert" className="mx-4 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-negative/30 bg-negative/10 px-4 py-3 text-sm text-negative"><span>{errorText(error)}</span><Button secondary onClick={() => void load()}>{t('Try again')}</Button></div>}
    <div aria-busy={loading} className={loading && data ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      <AdminTable headers={['User', 'Email', 'Registered', 'Last sign-in', 'Role', 'Status', 'AI messages', 'Actions']} empty={!loading && !error && !pager.items.length}>{pager.items.map(u => <tr key={u.id} className="hover:bg-line/30">
        <td><span className="font-medium">{u.fullName}</span>{u.id === currentUserId && <span className="ml-2 text-xs text-muted">(you)</span>}</td>
        <td className="text-muted">{u.email}</td>
        <td className="text-muted">{dateLabel(u.createdAt.slice(0, 10))}</td>
        <td className="text-muted">{u.lastLoginAt ? dateLabel(u.lastLoginAt.slice(0, 10)) : 'Never'}</td>
        <td><Badge tone={isAdmin(u) ? 'blue' : 'neutral'}>{isAdmin(u) ? 'ADMIN' : 'USER'}</Badge></td>
        <td><Badge tone={u.isActive ? 'positive' : 'negative'}>{u.isActive ? 'Active' : 'Locked'}</Badge></td>
        <td>{isAdmin(u) ? <span className="text-xs text-muted">—</span> : <QuotaBadge user={u} />}</td>
        <td><div className="flex"><IconButton icon={Eye} label={`View ${u.fullName}`} onClick={() => setDetail(u)} />
          <IconButton icon={MessageSquare} label={`Set AI message limit for ${u.fullName}`} disabled={isAdmin(u)} title={isAdmin(u) ? 'Administrators do not use the AI assistant' : undefined} onClick={() => { setNotice(''); setQuotaFor(u); }} />
          {u.isActive
            ? <IconButton icon={Lock} label={`Lock ${u.fullName}`} disabled={lockDisabled(u)} title={lockDisabled(u) ? 'Administrators and your own account cannot be locked' : undefined} onClick={() => { setActionError(''); setNotice(''); setLocking(u); }} />
            : <IconButton icon={LockOpen} label={`Unlock ${u.fullName}`} onClick={() => { setActionError(''); setNotice(''); setUnlocking(u); }} />}
        </div></td>
      </tr>)}</AdminTable>
      {loading && !data && <p role="status" className="p-5 text-sm text-muted">Loading users...</p>}
    </div>
    <Pagination pager={pager} sizes={[5, 10, 20, 50]} className="border-t border-line" />
    <p className="p-5 text-xs text-muted">{pager.total.toLocaleString()} accounts{query ? ` matching “${query}”` : ''} · Administrators and your own account cannot be locked.</p>
    {detail && <Modal title="User details" onClose={() => setDetail(null)}><div className="space-y-4"><h3 className="text-lg font-semibold">{detail.fullName}</h3><p className="text-sm text-muted">{detail.email}</p><div className="flex gap-2"><Badge tone="blue">{isAdmin(detail) ? 'ADMIN' : 'USER'}</Badge><Badge tone={detail.isActive ? 'positive' : 'negative'}>{detail.isActive ? 'Active' : 'Locked'}</Badge></div><dl className="space-y-3 border-t border-line pt-5 text-sm">
      <div className="flex justify-between gap-4"><dt className="text-muted">Registered</dt><dd>{dateTime(detail.createdAt)}</dd></div>
      <div className="flex justify-between gap-4"><dt className="text-muted">Last sign-in</dt><dd>{dateTime(detail.lastLoginAt)}</dd></div>
      {!detail.isActive && <><div className="flex justify-between gap-4"><dt className="text-muted">Locked at</dt><dd>{dateTime(detail.lockedAt)}</dd></div><div className="flex justify-between gap-4"><dt className="text-muted">Reason</dt><dd className="text-right">{detail.lockedReason || '—'}</dd></div></>}
      <div className="flex justify-between gap-4"><dt className="text-muted">Roles</dt><dd>{detail.roles.join(', ') || '—'}</dd></div>
      <div className="flex justify-between gap-4"><dt className="text-muted">Account ID</dt><dd className="truncate font-mono text-xs">{detail.id}</dd></div>
    </dl><Button secondary onClick={() => setDetail(null)}>Close details</Button></div></Modal>}
    {quotaFor && <QuotaDialog user={quotaFor} defaultLimit={defaultLimit} onClose={() => setQuotaFor(null)} onSaved={user => {
      replace(user); setQuotaFor(null);
      setNotice(`AI message limit for ${user.fullName}: ${user.aiQuota.customLimit === null ? `system default (${limitLabel(user.aiQuota.effectiveLimit).toLowerCase()})` : limitLabel(user.aiQuota.customLimit).toLowerCase()}.`);
    }} />}
    {locking && <Modal title="Lock this account?" onClose={() => !busy && setLocking(null)}><form className="space-y-5" onSubmit={e => {
      e.preventDefault(); const reason = String(new FormData(e.currentTarget).get('reason')).trim();
      if (!reason) { setActionError('Enter a reason for locking this account.'); return; }
      const target = locking;
      void run(() => adminUsersApi.lockUser(target.id, reason), `${target.fullName} has been locked.`);
    }}><p className="text-sm leading-6 text-muted">{locking.fullName} ({locking.email}) will be signed out on every device and cannot sign in until unlocked. An access token already issued stays valid until it expires (up to 15 minutes).</p>
      <Field label="Reason (recorded in the audit log)"><textarea name="reason" required maxLength={500} rows={3} className={`${fieldClass} block resize-none py-3`} placeholder="e.g. Suspicious activity reported" /></Field>
      {actionError && <p role="alert" className="text-sm text-negative">{actionError}</p>}
      <div className="flex justify-end gap-3"><Button secondary type="button" disabled={busy} onClick={() => setLocking(null)}>{t('Cancel')}</Button><Button className="!bg-negative !text-on-negative" disabled={busy}>{busy ? 'Locking...' : 'Lock account'}</Button></div></form></Modal>}
    {unlocking && <Modal title="Unlock this account?" onClose={() => !busy && setUnlocking(null)}><p className="text-sm leading-6 text-muted">{unlocking.fullName} will be able to sign in again right away.{unlocking.lockedReason ? ` Locked for: “${unlocking.lockedReason}”.` : ''}</p>
      {actionError && <p role="alert" className="mt-3 text-sm text-negative">{actionError}</p>}
      <div className="mt-6 flex justify-end gap-3"><Button secondary disabled={busy} onClick={() => setUnlocking(null)}>{t('Cancel')}</Button><Button disabled={busy} onClick={() => { const target = unlocking; void run(() => adminUsersApi.unlockUser(target.id), `${target.fullName} has been unlocked.`); }}>{busy ? 'Unlocking...' : 'Unlock account'}</Button></div></Modal>}
  </Card>;
}const RANGES = [7, 30, 90] as const;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
/** Last `days` days including today, as YYYY-MM-DD (UTC, matching the API). */
export function lastDays(days: number) {
  const to = new Date(), from = new Date(to); from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: isoDate(from), to: isoDate(to) };
}
const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });

/**
 * Transaction monitoring from /api/admin/transactions/stats. Aggregated only: administrators never see an
 * individual transaction, description, account or user. Small or user-created categories are merged by the API.
 */
export function TransactionMonitoring() {
  const { t } = useLanguage();
  const errorText = useErrorText();
  const [days, setDays] = useState<number>(30);
  const [stats, setStats] = useState<AdminTransactionStatsResponse | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState<unknown>(null);
  const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true); setError(null);
    try {
      const range = lastDays(days);
      const result = await adminTransactionsApi.getTransactionStats(range.from, range.to);
      if (current === request.current) setStats(result);
    } catch (e) { if (current === request.current) setError(e); }
    finally { if (current === request.current) setLoading(false); }
  }, [days]);
  useEffect(() => { void load(); }, [load]);

  const volume = (stats?.totalIncome ?? 0) + (stats?.totalExpense ?? 0);
  const daily = (stats?.daily ?? []).map(d => ({ name: shortDay(d.date), transactions: d.count, volume: d.income + d.expense }));
  const sources = stats?.sources ?? [];
  const sourceTotal = sources.reduce((s, x) => s + x.count, 0);
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="tablist" aria-label="Time range" className="flex rounded-xl border border-line bg-surface p-1">{RANGES.map(n =>
        <button key={n} role="tab" aria-selected={days === n} onClick={() => setDays(n)} className={`min-h-9 rounded-lg px-4 text-sm transition-colors ${days === n ? 'bg-brand/15 font-medium text-brand' : 'text-muted hover:text-ink'}`}>Last {n} days</button>)}</div>
      {stats && <span className="text-xs text-muted">{dateLabel(stats.from.slice(0, 10))} – {dateLabel(stats.to.slice(0, 10))}</span>}
    </div>
    {error != null && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-negative/30 bg-negative/10 px-4 py-3 text-sm text-negative"><span>{errorText(error)}</span><Button secondary onClick={() => void load()}>{t('Try again')}</Button></div>}
    <div aria-busy={loading} className={`space-y-5 transition-opacity ${loading && stats ? 'opacity-60' : ''}`}>
      <PlatformStats items={[
        { label: 'Transactions', value: stats ? stats.transactionCount.toLocaleString() : '…', note: `Recorded in the last ${days} days` },
        { label: 'Active users', value: stats ? stats.activeUsers.toLocaleString() : '…', note: 'People who recorded at least one transaction' },
        { label: 'Income volume', value: stats ? money(stats.totalIncome) : '…', note: 'Sum of all income' },
        { label: 'Expense volume', value: stats ? money(stats.totalExpense) : '…', note: 'Sum of all expenses' },
      ]} />
      <div className="grid gap-5 xl:grid-cols-2">
        <AdminChart title="Transactions per day" subtitle={`Platform-wide · last ${days} days`} data={daily} dataKey="transactions" bar color="var(--color-positive)" />
        <AdminChart title="Financial volume per day" subtitle="Income + expenses, all users combined" data={daily} dataKey="volume" axisFormat={compact} valueFormat={money} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card><div className="p-5 pb-3"><SectionHead title="Volume by category" subtitle={`Categories used by fewer than ${stats?.minGroupSize ?? 3} people, and user-created categories, are grouped to protect privacy.`} /></div>
          <AdminTable headers={['Category', 'Type', 'Transactions', 'Amount', 'Share']} empty={!loading && !stats?.categories.length}>
            {(stats?.categories ?? []).map(c => {
              const typeTotal = c.type === 'Income' ? stats!.totalIncome : stats!.totalExpense;
              return <tr key={`${c.categoryName ?? '~other'}-${c.type}`} className="hover:bg-line/30">
                <td className="flex items-center gap-3">{c.categoryName ? <CategoryIcon name={c.categoryName} small /> : <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-lg bg-line/60 text-muted"><Shield className="size-3.5" /></span>}<span className={c.categoryName ? '' : 'italic text-muted'}>{c.categoryName ?? 'Other & custom categories'}</span></td>
                <td><Badge tone={c.type === 'Income' ? 'positive' : 'neutral'}>{c.type}</Badge></td>
                <td className="tabular-nums">{c.count.toLocaleString()}</td>
                <td className="tabular-nums">{money(c.amount)}</td>
                <td className="tabular-nums text-muted">{percent(c.amount, typeTotal)}</td>
              </tr>;
            })}
          </AdminTable></Card>
        <Card className="p-5"><SectionHead title="How transactions are entered" subtitle="Manual entries vs. AI drafts" />
          <div className="space-y-4">{sources.length ? sources.map(s => <div key={s.source}>
            <div className="mb-2 flex justify-between text-sm"><span>{s.source === 'AIDraft' ? 'AI draft' : 'Manual'}</span><span className="tabular-nums text-muted">{s.count.toLocaleString()} · {percent(s.count, sourceTotal)}</span></div>
            <Progress label={s.source} value={sourceTotal ? s.count / sourceTotal * 100 : 0} color={s.source === 'AIDraft' ? 'var(--color-ai)' : undefined} />
          </div>) : <p className="text-sm text-muted">No transactions in this range.</p>}</div>
          <p className="mt-6 border-t border-line pt-4 text-xs leading-5 text-muted">Total volume {stats ? money(volume) : '…'}. Administrators can only see these aggregates: individual transactions stay private to their owners.</p>
        </Card>
      </div>
    </div>
  </div>;
}
type CategoryFilter = 'All' | 'Expense' | 'Income' | 'Hidden';
/**
 * Default (system) categories from /api/admin/categories: shared by every user, who cannot edit them.
 * Deleting an unused one removes it; one already used by transactions or budgets is only hidden, so no user
 * loses data. The type of a used category cannot change (the API answers 409). Usage counts come from the
 * 30-day aggregates, which only list categories used by enough people.
 */
export function CategoryManagement() {
  const { t } = useLanguage();
  const errorText = useErrorText();
  const [items, setItems] = useState<CategoryResponse[] | null>(null);
  const [usage, setUsage] = useState<Map<string, number> | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState<CategoryFilter>('All');
  const [editing, setEditing] = useState<CategoryResponse | 'new' | null>(null);
  const [deleting, setDeleting] = useState<CategoryResponse | null>(null);
  const [icon, setIcon] = useState<CategoryIconId>('Tag');
  const [busy, setBusy] = useState(false), [formError, setFormError] = useState(''), [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const range = lastDays(30);
      const [list, stats] = await Promise.all([
        adminCategoriesApi.listSystemCategories(),
        adminTransactionsApi.getTransactionStats(range.from, range.to).catch(() => null),
      ]);
      setItems(list);
      setUsage(stats ? new Map(stats.categories.filter(s => s.categoryName).map(s => [`${s.type}:${s.categoryName}`, s.count])) : null);
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const all = items ?? [];
  const shown = all.filter(c => filter === 'All' ? true : filter === 'Hidden' ? !c.isActive : c.type === filter);
  const pager = usePagination(shown, 10, filter);
  const selected = editing && editing !== 'new' ? editing : undefined;
  function startEdit(category: CategoryResponse | 'new') {
    setFormError(''); setNotice('');
    setIcon(category === 'new' ? 'Tag' : getCategoryIcon(category.name, category.icon ?? undefined));
    setEditing(category);
  }
  async function run(action: () => Promise<string>) {
    setBusy(true); setFormError('');
    try { setNotice(await action()); setEditing(null); setDeleting(null); }
    catch (e) { setFormError(errorText(e)); }
    finally { setBusy(false); }
  }
  const request = (c: CategoryResponse, isActive: boolean) => ({ name: c.name, type: c.type, icon: c.icon, color: c.color, isActive });

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="tablist" aria-label="Filter categories" className="flex rounded-xl border border-line bg-surface p-1">{(['All', 'Expense', 'Income', 'Hidden'] as const).map(f =>
        <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={`min-h-9 rounded-lg px-4 text-sm transition-colors ${filter === f ? 'bg-brand/15 font-medium text-brand' : 'text-muted hover:text-ink'}`}>
          {f}{f === 'Hidden' && all.some(c => !c.isActive) ? ` (${all.filter(c => !c.isActive).length})` : ''}</button>)}</div>
      <Button onClick={() => startEdit('new')}><Plus className="h-4 w-4" />Add category</Button>
    </div>
    {notice && <p role="status" className="rounded-lg bg-positive/10 px-4 py-2.5 text-sm text-positive">{notice}</p>}
    {error != null && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-negative/30 bg-negative/10 px-4 py-3 text-sm text-negative"><span>{errorText(error)}</span><Button secondary onClick={() => void load()}>{t('Try again')}</Button></div>}
    <Card>
      <div aria-busy={loading} className={loading && items ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <AdminTable headers={['Category', 'Type', 'Status', 'Transactions (30 days)', 'Actions']} empty={!loading && !error && !shown.length}>{pager.items.map(c => {
          const count = usage?.get(`${c.type}:${c.name}`);
          return <tr key={c.id} className="hover:bg-line/30">
            <td><span className={`flex items-center gap-3 ${c.isActive ? '' : 'opacity-60'}`}><CategoryIcon name={c.name} icon={c.icon ?? undefined} />{c.name}</span></td>
            <td><Badge tone={c.type === 'Income' ? 'positive' : 'neutral'}>{c.type}</Badge></td>
            <td><Badge tone={c.isActive ? 'positive' : 'neutral'}>{c.isActive ? 'Visible to users' : 'Hidden'}</Badge></td>
            <td className="tabular-nums text-muted" title={count === undefined ? `Shown only when at least ${3} people used it` : undefined}>{count === undefined ? '—' : count.toLocaleString()}</td>
            <td><div className="flex">
              <IconButton icon={Pencil} label={`Edit system category ${c.name}`} onClick={() => startEdit(c)} />
              {c.isActive
                ? <IconButton icon={Trash2} label={`Delete system category ${c.name}`} onClick={() => { setFormError(''); setNotice(''); setDeleting(c); }} />
                : <IconButton icon={Eye} label={`Show ${c.name} to users again`} disabled={busy} onClick={() => void run(async () => { await adminCategoriesApi.updateSystemCategory(c.id, request(c, true)); await load(); return `“${c.name}” is visible to users again.`; })} />}
            </div></td>
          </tr>;
        })}</AdminTable>
        {loading && !items && <p role="status" className="p-5 text-sm text-muted">Loading categories...</p>}
      </div>
      <Pagination pager={pager} sizes={[10, 20, 50]} className="border-t border-line" />
      <p className="px-5 py-4 text-xs leading-5 text-muted">{all.length} default categories, shared by every user. Users cannot edit them; their own categories are not listed here. “—” means fewer than 3 people used the category in the last 30 days.</p>
    </Card>

    {editing && <Modal title={selected ? 'Edit system category' : 'Add system category'} onClose={() => !busy && setEditing(null)}><form className="space-y-5" onSubmit={e => {
      e.preventDefault();
      const d = new FormData(e.currentTarget), name = String(d.get('name')).trim(), type = d.get('type') as CategoryType;
      if (!name) return setFormError('Enter a category name.');
      if (all.some(c => c.id !== selected?.id && c.type === type && c.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return setFormError('A default category with this name and type already exists.');
      const body = { name, type, icon, color: selected?.color ?? null, isActive: selected?.isActive ?? true };
      void run(async () => {
        if (selected) await adminCategoriesApi.updateSystemCategory(selected.id, body);
        else await adminCategoriesApi.createSystemCategory(body);
        await load();
        return selected ? `“${name}” was updated for every user.` : `“${name}” was added for every user.`;
      });
    }}>
      <Field label={t('Category name')}><input name="name" required maxLength={100} defaultValue={selected?.name} className={fieldClass} /></Field>
      <Field label={t('Type')}><FormSelect name="type" label={t('Type')} defaultValue={selected?.type || 'Expense'} options={[{ value: 'Expense', label: t('Expense') }, { value: 'Income', label: t('Income') }]} /></Field>
      <CategoryIconPicker value={icon} onChange={setIcon} />
      {selected && <p className="text-xs leading-5 text-muted">Changes apply to every user. The type cannot change once transactions or budgets use this category.</p>}
      {formError && <p role="alert" className="text-sm text-negative">{formError}</p>}
      <div className="flex justify-end gap-3"><Button secondary type="button" disabled={busy} onClick={() => setEditing(null)}>{t('Cancel')}</Button><Button disabled={busy}>{busy ? 'Saving...' : t('Save category')}</Button></div>
    </form></Modal>}

    {deleting && <Modal title="Delete this default category?" onClose={() => !busy && setDeleting(null)}>
      <p className="text-sm leading-6 text-muted">If no transaction or budget uses “{deleting.name}”, it is deleted. Otherwise it is <strong className="text-ink">hidden</strong> instead: users keep their existing records but can no longer pick it. A hidden category can be shown again later.</p>
      {formError && <p role="alert" className="mt-3 text-sm text-negative">{formError}</p>}
      <div className="mt-6 flex justify-end gap-3">
        <Button secondary disabled={busy} onClick={() => setDeleting(null)}>{t('Cancel')}</Button>
        <Button className="!bg-negative !text-on-negative" disabled={busy} onClick={() => {
          const target = deleting;
          void run(async () => {
            await adminCategoriesApi.deleteSystemCategory(target.id);
            const list = await adminCategoriesApi.listSystemCategories();
            setItems(list);
            return list.some(c => c.id === target.id) ? `“${target.name}” is in use, so it was hidden instead of deleted.` : `“${target.name}” was deleted.`;
          });
        }}>{t('Delete')}</Button>
      </div>
    </Modal>}
  </div>;
}
export function AIAnalytics() {
  const requests = aiUsage.reduce((s, d) => s + d.requests, 0), completed = aiUsage.reduce((s, d) => s + d.completed, 0);
  const tokens = aiUsage.reduce((s, d) => s + d.tokens, 0), latency = aiUsage.reduce((s, d) => s + d.latency * d.requests, 0) / requests;
  return <div className="space-y-5"><PlatformStats items={[{ label: 'Total AI requests', value: requests.toLocaleString() }, { label: 'Completion rate', value: `${(completed / requests * 100).toFixed(1)}%` }, { label: 'Estimated tokens', value: tokens.toLocaleString() }, { label: 'Average response', value: `${latency.toFixed(2)}s` }]} /><div className="grid gap-5 xl:grid-cols-2"><AdminChart title="Daily AI usage" subtitle="Synthetic usage · Last six days" data={aiUsage} dataKey="requests" color="var(--color-ai)" /><Card className="p-5"><SectionHead title="Most common question topics" subtitle="Illustrative distribution of the sample request volume" /><div className="space-y-5">{questionTopics.map(q => <div key={q.name}><div className="mb-2 flex justify-between text-sm"><span>{q.name}</span><span className="text-muted">{q.share}%</span></div><Progress label={q.name} value={q.share} color="var(--color-ai)" /></div>)}</div></Card></div><Card className="p-5"><SectionHead title="Response statistics" action={<Badge tone="neutral">Simulated service</Badge>} /><div className="grid gap-6 sm:grid-cols-3"><div><p className="text-sm text-muted">Completed requests</p><p className="mt-2 text-2xl font-semibold text-positive">{completed.toLocaleString()}</p></div><div><p className="text-sm text-muted">Failed requests</p><p className="mt-2 text-2xl font-semibold text-negative">{requests - completed}</p></div><div><p className="text-sm text-muted">AI service status</p><p className="mt-2 text-[1rem] font-medium">Not connected · Demo only</p></div></div></Card></div>;
}
