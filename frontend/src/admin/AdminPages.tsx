import { useLanguage } from '../i18n';
import { Pagination, usePagination, type Pager } from '../components/Pagination';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Search, Eye, Lock, LockOpen, Shield, Plus, Pencil, Trash2 } from 'lucide-react';
import { type PlatformUser, type PlatformTransaction, type SystemCategory, aiUsage, questionTopics } from './data';
import { money, dateLabel, localDate } from '../data';
import { Badge, Button, Card, Empty, Field, IconButton, Modal, Progress, SectionHead, fieldClass } from '../components/ui';
import { AdminChart } from './AdminCharts';
import { FormSelect, Select } from '../components/Select';
import { adminUsersApi, type AdminUserResponse, type PagedResult } from '../services';
import { useErrorText } from '../pages/Auth';
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
export function AdminOverview({ stats, transactions }: { stats: AdminUserStats | null; transactions: PlatformTransaction[] }) {
  const volume = transactions.reduce((s, t) => s + t.amount, 0);
  // Cumulative registrations at each month end. Accounts older than the loaded page are counted as a baseline.
  const growth = Array.from({ length: 6 }, (_, i) => {
    const n = new Date(), end = new Date(n.getFullYear(), n.getMonth() - 5 + i + 1, 0, 23, 59, 59);
    const recent = stats?.recent ?? [];
    const older = (stats?.total ?? 0) - recent.length;
    return { name: end.toLocaleDateString('en', { month: 'short' }), users: older + recent.filter(u => new Date(u.createdAt) <= end).length };
  });
  const daily = aiUsage.map(d => ({ name: d.name, transactions: transactions.filter(t => t.date === d.date).length, requests: d.requests }));
  const count = (value?: number) => value === undefined ? '…' : value.toLocaleString();
  return <div className="space-y-5"><PlatformStats items={[
    { label: 'Total users', value: count(stats?.total), note: 'Registered accounts' },
    { label: 'Active users', value: count(stats?.active), note: 'Accounts not locked' },
    { label: 'Total transactions', value: String(transactions.length), note: 'Platform sample records' },
    { label: 'Financial volume', value: money(volume), note: 'Income + expense volume' },
    { label: 'AI requests', value: aiUsage.reduce((s, d) => s + d.requests, 0).toLocaleString(), note: 'Six-day synthetic usage sample' },
    { label: 'System status', value: 'Demo healthy', note: 'Simulated · No live health checks' },
  ]} /><div className="grid gap-5 xl:grid-cols-2"><AdminChart title="User growth" subtitle="Cumulative registrations · last six months" data={growth} dataKey="users" /><AdminChart title="Daily platform activity" subtitle="AI request events in the demo usage log" data={daily} dataKey="requests" bar /><AdminChart title="AI request volume" subtitle="Synthetic six-day sample" data={aiUsage} dataKey="requests" color="var(--color-ai)" /><AdminChart title="Transaction activity" subtitle="Sample financial records per day" data={daily} dataKey="transactions" bar color="var(--color-positive)" /></div></div>;
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
      <AdminTable headers={['User', 'Email', 'Registered', 'Last sign-in', 'Role', 'Status', 'Actions']} empty={!loading && !error && !pager.items.length}>{pager.items.map(u => <tr key={u.id} className="hover:bg-line/30">
        <td><span className="font-medium">{u.fullName}</span>{u.id === currentUserId && <span className="ml-2 text-xs text-muted">(you)</span>}</td>
        <td className="text-muted">{u.email}</td>
        <td className="text-muted">{dateLabel(u.createdAt.slice(0, 10))}</td>
        <td className="text-muted">{u.lastLoginAt ? dateLabel(u.lastLoginAt.slice(0, 10)) : 'Never'}</td>
        <td><Badge tone={isAdmin(u) ? 'blue' : 'neutral'}>{isAdmin(u) ? 'ADMIN' : 'USER'}</Badge></td>
        <td><Badge tone={u.isActive ? 'positive' : 'negative'}>{u.isActive ? 'Active' : 'Locked'}</Badge></td>
        <td><div className="flex"><IconButton icon={Eye} label={`View ${u.fullName}`} onClick={() => setDetail(u)} />
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
}export function TransactionMonitoring({ transactions, users, categories }: { transactions: PlatformTransaction[]; users: PlatformUser[]; categories: SystemCategory[] }) {
  const { t } = useLanguage();
  const [search, setSearch] = useState(''), [user, setUser] = useState('All users'), [category, setCategory] = useState('All categories');
  const [start, setStart] = useState(''), [end, setEnd] = useState(''), [detail, setDetail] = useState<PlatformTransaction | null>(null);
  const shown = transactions.filter(t => `${t.description} ${users.find(u => u.id === t.userId)?.name}`.toLowerCase().includes(search.toLowerCase()) && (user === 'All users' || user === t.userId) && (category === 'All categories' || category === t.category) && (!start || t.date >= start) && (!end || t.date <= end));
  const txPager = usePagination(shown, 10, `${search}|${user}|${category}|${start}|${end}`);
  return <Card><div className="flex flex-wrap items-center gap-3 p-4"><input aria-label="Search platform transactions" value={search} onChange={e => setSearch(e.target.value)} placeholder={t("Search transactions...")} className={`${fieldClass} min-w-[200px] flex-1`} /><Select label="Filter by platform user" className="w-full sm:w-[200px]" value={user} onChange={setUser} options={[{ value: 'All users', label: 'All users' }, ...users.map(u => ({ value: u.id, label: u.name }))]} /><Select label="Filter platform category" className="w-full sm:w-[200px]" value={category} onChange={setCategory} options={[{ value: 'All categories', label: t("All categories") }, ...[...new Set(transactions.map(t => t.category))].map(c => ({ value: c, label: c }))]} /><input aria-label={t("Start date")} type="date" value={start} onChange={e => setStart(e.target.value)} className={`${fieldClass} w-auto`} /><input aria-label={t("End date")} type="date" value={end} min={start} onChange={e => setEnd(e.target.value)} className={`${fieldClass} w-auto`} /></div><div className="flex items-center gap-2 border-t border-line px-5 py-3 text-xs text-muted"><Shield className="h-3.5 w-3.5" />Read-only monitoring · Administrators cannot edit financial records.</div><AdminTable headers={['Transaction', 'User', 'Category', 'Date', 'Amount', 'Details']} empty={!shown.length}>{txPager.items.map(t => <tr key={t.id} className="hover:bg-line/30"><td className="max-w-[240px] truncate font-medium">{t.description}</td><td>{users.find(u => u.id === t.userId)?.name}</td><td><span className="flex items-center gap-2"><CategoryIcon name={t.category} icon={categories.find(c => c.name === t.category)?.icon} small />{t.category}</span></td><td className="text-muted">{dateLabel(t.date)}</td><td className={`tabular-nums ${t.type === 'Income' ? 'text-positive' : 'text-negative'}`}>{t.type === 'Income' ? '+' : '−'}{money(t.amount)}</td><td><IconButton icon={Eye} label={`View transaction ${t.id}`} onClick={() => setDetail(t)} /></td></tr>)}</AdminTable><Pagination pager={txPager} sizes={[10, 20, 50]} className="border-t border-line" /><p className="p-5 text-xs text-muted">{shown.length} read-only sample records</p>{detail && <Modal title="Transaction details · Read-only" onClose={() => setDetail(null)}><h3 className="mb-5 text-[1rem] font-semibold">{detail.description}</h3><dl className="space-y-4 text-sm">{[{ label: 'User', value: users.find(u => u.id === detail.userId)?.name }, { label: 'Amount', value: money(detail.amount) }, { label: 'Type', value: detail.type }, { label: 'Category', value: detail.category }, { label: 'Account', value: detail.account }, { label: 'Date', value: dateLabel(detail.date) }, { label: 'Reference', value: detail.id }].map(d => <div className="flex justify-between gap-4" key={d.label}><dt className="text-muted">{d.label}</dt><dd className="text-right">{d.value}</dd></div>)}</dl><div className="mt-6 flex justify-end"><Button secondary onClick={() => setDetail(null)}>Close details</Button></div></Modal>}</Card>;
}
export function CategoryManagement({ categories, transactions, onSave, onDelete, confirm }: {
  categories: SystemCategory[]; transactions: PlatformTransaction[];
  onSave: (category: SystemCategory) => void; onDelete: (id: string) => void; confirm: (c: ConfirmAction) => void;
}) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState<SystemCategory | 'new' | null>(null), [error, setError] = useState('');
  const [icon, setIcon] = useState<CategoryIconId>('Tag');
  const selected = editing && editing !== 'new' ? editing : undefined;
  const categoryPager = usePagination(categories, 10, categories.length);
  function startEdit(category: SystemCategory | 'new') {
    setError('');
    setIcon(category === 'new' ? 'Tag' : getCategoryIcon(category.name, category.icon));
    setEditing(category);
  }
  return <div className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted">System-wide defaults · Separate from personal categories</p><Button onClick={() => startEdit('new')}><Plus className="h-4 w-4" />Add category</Button></div><Card><AdminTable headers={['Category', 'Type', 'Icon', 'Usage', 'Actions']}>{categoryPager.items.map(c => {
    const used = transactions.filter(t => t.category === c.name).length;
    return <tr key={c.id} className="hover:bg-line/30"><td><span className="flex items-center gap-3"><CategoryIcon name={c.name} icon={c.icon} />{c.name}</span></td><td><Badge tone={c.type === 'Income' ? 'positive' : 'neutral'}>{c.type}</Badge></td><td className="text-muted">{categoryIcons[getCategoryIcon(c.name, c.icon)].label}</td><td className="text-muted">{used} records</td><td><div className="flex"><IconButton icon={Pencil} label={`Edit system category ${c.name}`} onClick={() => startEdit(c)} /><IconButton icon={Trash2} label={`Delete system category ${c.name}`} disabled={used > 0} onClick={() => confirm({ title: 'Delete system category?', text: `Delete “${c.name}” from local system defaults?`, action: () => onDelete(c.id) })} /></div></td></tr>;
  })}</AdminTable><Pagination pager={categoryPager} sizes={[5, 10, 20]} className="border-t border-line" /><p className="px-5 py-4 text-xs text-muted">Categories used by platform records cannot be deleted. No personal categories are changed.</p></Card>{editing && <Modal title={selected ? 'Edit system category' : 'Add system category'} onClose={() => setEditing(null)}><form className="space-y-5" onSubmit={e => {
    e.preventDefault(); const d = new FormData(e.currentTarget), name = String(d.get('name')).trim();
    if (!name || categories.some(c => c.id !== selected?.id && c.name.toLowerCase() === name.toLowerCase())) return setError('Choose a unique category name.');
    if (selected && transactions.some(t => t.category === selected.name) && (name !== selected.name || d.get('type') !== selected.type)) return setError('This category is used by platform records. Only its icon may be changed.');
    onSave({ id: selected?.id || crypto.randomUUID(), name, type: d.get('type') as SystemCategory['type'], icon, color: selected?.color ?? '#3B82F6' }); setEditing(null);
  }}><Field label={t("Category name")}><input name="name" required maxLength={40} defaultValue={selected?.name} className={fieldClass} /></Field><Field label={t("Type")}><FormSelect name="type" label={t("Type")} defaultValue={selected?.type || 'Expense'} options={[{ value: 'Expense', label: t("Expense") }, { value: 'Income', label: t("Income") }]} /></Field><CategoryIconPicker value={icon} onChange={setIcon} />{error && <p role="alert" className="text-sm text-negative">{error}</p>}<div className="flex justify-end gap-3"><Button secondary type="button" onClick={() => setEditing(null)}>{t("Cancel")}</Button><Button>{t("Save category")}</Button></div></form></Modal>}</div>;
}
export function AIAnalytics() {
  const requests = aiUsage.reduce((s, d) => s + d.requests, 0), completed = aiUsage.reduce((s, d) => s + d.completed, 0);
  const tokens = aiUsage.reduce((s, d) => s + d.tokens, 0), latency = aiUsage.reduce((s, d) => s + d.latency * d.requests, 0) / requests;
  return <div className="space-y-5"><PlatformStats items={[{ label: 'Total AI requests', value: requests.toLocaleString() }, { label: 'Completion rate', value: `${(completed / requests * 100).toFixed(1)}%` }, { label: 'Estimated tokens', value: tokens.toLocaleString() }, { label: 'Average response', value: `${latency.toFixed(2)}s` }]} /><div className="grid gap-5 xl:grid-cols-2"><AdminChart title="Daily AI usage" subtitle="Synthetic usage · Last six days" data={aiUsage} dataKey="requests" color="var(--color-ai)" /><Card className="p-5"><SectionHead title="Most common question topics" subtitle="Illustrative distribution of the sample request volume" /><div className="space-y-5">{questionTopics.map(q => <div key={q.name}><div className="mb-2 flex justify-between text-sm"><span>{q.name}</span><span className="text-muted">{q.share}%</span></div><Progress label={q.name} value={q.share} color="var(--color-ai)" /></div>)}</div></Card></div><Card className="p-5"><SectionHead title="Response statistics" action={<Badge tone="neutral">Simulated service</Badge>} /><div className="grid gap-6 sm:grid-cols-3"><div><p className="text-sm text-muted">Completed requests</p><p className="mt-2 text-2xl font-semibold text-positive">{completed.toLocaleString()}</p></div><div><p className="text-sm text-muted">Failed requests</p><p className="mt-2 text-2xl font-semibold text-negative">{requests - completed}</p></div><div><p className="text-sm text-muted">AI service status</p><p className="mt-2 text-[1rem] font-medium">Not connected · Demo only</p></div></div></Card></div>;
}
