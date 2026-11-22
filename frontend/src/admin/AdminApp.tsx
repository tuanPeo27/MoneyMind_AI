import { useLanguage } from '../i18n';
import { useCallback, useEffect, useState } from 'react';
import { ChartNoAxesCombined, LayoutDashboard, Users, ArrowLeftRight, Shapes, Sparkles, Settings, LogOut, ChevronRight, Menu, X, ShieldCheck, Activity, Check } from 'lucide-react';
import { useLocal } from '../hooks/useLocal';
import { initialUsers, platformTransactions, systemCategories, adminNav, type SystemCategory } from './data';
import { AdminOverview, UserManagement, TransactionMonitoring, CategoryManagement, AIAnalytics, type AdminUserStats, type ConfirmAction } from './AdminPages';
import { adminUsersApi, useSession } from '../services';
import { Button, Card, Badge, Field, IconButton, Modal, SectionHead, fieldClass } from '../components/ui';

const icons = { overview: LayoutDashboard, users: Users, transactions: ArrowLeftRight, categories: Shapes, ai: Sparkles, settings: Settings };
export function AdminApp({ path, navigate, onSignOut, onStats }: {
  path: string; navigate: (path: string) => void; onSignOut: () => void;
  /** Reports the account counts so the AI assistant can talk about them. */
  onStats?: (stats: AdminUserStats) => void;
}) {
  const { t } = useLanguage();
  const [mobile, setMobile] = useState(false), [confirmation, setConfirmation] = useState<ConfirmAction | null>(null);
  const [categories, setCategories, categoryError] = useLocal<SystemCategory[]>('mm-system-categories-v1', systemCategories);
  const [events, setEvents] = useLocal<{ time: string; text: string }[]>('mm-admin-audit-v1', []);
  const current = adminNav.find(p => p.path === path) || adminNav[0];
  const { session } = useSession();
  const me = session?.user;
  const initials = (me?.fullName ?? 'Admin').split(' ').filter(Boolean).slice(-2).map(w => w[0]).join('').toUpperCase();
  // Account numbers for the overview: two count-only requests plus the newest 100 accounts for the growth chart.
  const [stats, setStats] = useState<AdminUserStats | null>(null);
  const [statsError, setStatsError] = useState(false);
  const loadStats = useCallback(async () => {
    try {
      const [recent, active] = await Promise.all([
        adminUsersApi.listUsers({ page: 1, pageSize: 100 }),
        adminUsersApi.listUsers({ page: 1, pageSize: 1, isActive: true }),
      ]);
      const next = { total: recent.totalCount, active: active.totalCount, recent: recent.items };
      setStats(next); setStatsError(false); onStats?.(next);
    } catch { setStatsError(true); }
  }, [onStats]);
  useEffect(() => { void loadStats(); }, [loadStats]);
  function audit(text: string) {
    setEvents(old => [{ time: new Date().toISOString(), text }, ...old].slice(0, 20));
  }
  return <div className="min-h-screen overflow-x-clip text-sm text-ink">
    {mobile && <button className="fixed inset-0 z-40 bg-black/60 md:hidden" aria-label="Close administration navigation" onClick={() => setMobile(false)} />}
    <aside className={`fixed inset-y-0 z-40 flex w-[220px] flex-col border-r border-white/60 bg-surface backdrop-blur-2xl no-dark-blur dark:border-white/10 transition-transform duration-300 md:translate-x-0 ${mobile ? '' : '-translate-x-full'}`}>
      <a href="/admin" onClick={e => { e.preventDefault(); navigate('/admin'); }} className="flex h-[76px] items-center gap-2.5 px-5"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand"><ChartNoAxesCombined className="h-5 w-5 text-on-brand" /></span><span className="text-lg font-semibold tracking-tight">MoneyMind <span className="text-xs text-muted">AI</span></span></a>
      <div className="mx-4 mb-8 flex items-center gap-2 rounded-lg border border-line bg-base px-3 py-3"><ShieldCheck className="h-4 w-4 text-brand" /><span className="text-sm font-medium">Administration</span></div>
      <p className="mb-3 px-6 text-xs tracking-widest text-muted">PLATFORM</p>
      <nav aria-label="Administration navigation" className="flex-1 space-y-1 px-3">{adminNav.map(item => {
        const Icon = icons[item.icon];
        return <a key={item.path} href={item.path} onClick={e => { e.preventDefault(); navigate(item.path); setMobile(false); }} aria-current={path === item.path ? 'page' : undefined} className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-brand ${current.path === item.path ? 'bg-brand/10 text-brand' : 'text-muted hover:bg-line hover:text-ink'}`}><Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />{item.label}</a>;
      })}</nav>
      <button onClick={onSignOut} className="mx-4 mb-4 flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-sm text-muted hover:bg-line hover:text-ink"><LogOut className="h-4 w-4" />Sign out</button>
      <div className="flex items-center gap-3 border-t border-line px-5 py-5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/15 text-xs text-brand">{initials}</span><div className="min-w-0"><p className="truncate text-sm font-medium">{me?.fullName ?? "Administrator"}</p><div className="mt-1"><Badge tone="blue">ADMIN</Badge></div></div></div>
    </aside>
    <div className="min-w-0 md:ml-[220px]"><header className="flex min-h-[76px] items-center justify-between gap-4 border-b border-line px-5 lg:px-8"><div className="flex items-center gap-3"><span className="md:hidden"><IconButton icon={Menu} label="Open administration navigation" onClick={() => setMobile(true)} /></span><span className="text-muted">Admin</span><ChevronRight className="h-3.5 w-3.5 text-muted" /><span>{current.label}</span></div><Badge tone="positive"><Activity className="h-3 w-3" />Local sandbox</Badge></header>
      <main className="mx-auto max-w-[1640px] px-5 pb-32 pt-8 lg:px-8"><div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><p className="mb-2 text-xs font-medium tracking-[0.13em] text-muted">PLATFORM OPERATIONS</p><h1 className="text-[27px] font-semibold tracking-[-0.04em]">{current.label}</h1></div><span className="text-sm text-muted">{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span></div>
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" /><p className="text-sm leading-6 text-muted">User accounts are live data from the server, and every admin request is authorized by the backend. Transactions, categories, AI analytics and settings on these pages are still sample data.</p></div>
        {categoryError && <p role="alert" className="mb-4 text-sm text-negative">Browser storage unavailable. Category changes will not survive a refresh.</p>}
        {statsError && current.path === '/admin' && <p role="alert" className="mb-4 text-sm text-negative">Could not load account statistics. <button className="underline" onClick={() => void loadStats()}>Try again</button></p>}
        {current.path === '/admin' && <AdminOverview stats={stats} transactions={platformTransactions} />}
        {current.path === '/admin/users' && <UserManagement currentUserId={me?.id} onChanged={() => void loadStats()} />}
        {current.path === '/admin/transactions' && <TransactionMonitoring transactions={platformTransactions} users={initialUsers} categories={categories} />}
        {current.path === '/admin/categories' && <CategoryManagement categories={categories} transactions={platformTransactions} confirm={setConfirmation} onSave={category => { setCategories(old => old.some(c => c.id === category.id) ? old.map(c => c.id === category.id ? category : c) : [...old, category]); audit(`Saved system category ${category.name}.`); }} onDelete={id => { setCategories(old => old.filter(c => c.id !== id)); audit(`Deleted unused system category ${id}.`); }} />}
        {current.path === '/admin/ai' && <AIAnalytics />}
        {current.path === '/admin/settings' && <SystemSettings onSave={audit} />}
        {events.length > 0 && <Card className="mt-5 p-5"><SectionHead title="Local administrative activity" subtitle="Recent actions on this browser · Not a server audit trail" /><div className="space-y-3">{events.slice(0, 4).map((event, index) => <div key={`${event.time}-${index}`} className="flex flex-wrap justify-between gap-2 text-sm"><span className="text-muted">{event.text}</span><time className="text-xs text-muted" dateTime={event.time}>{new Date(event.time).toLocaleString('vi-VN')}</time></div>)}</div></Card>}
      </main>
    </div>
    {confirmation && <Modal title={confirmation.title} onClose={() => setConfirmation(null)}><p className="text-sm leading-6 text-muted">{confirmation.text}</p><div className="mt-6 flex justify-end gap-3"><Button secondary onClick={() => setConfirmation(null)}>{t("Cancel")}</Button><Button onClick={() => { confirmation.action(); setConfirmation(null); }}>Confirm change</Button></div></Modal>}
  </div>;
}
function SystemSettings({ onSave }: { onSave: (message: string) => void }) {
  const { t } = useLanguage();
  const [settings, setSettings] = useLocal('mm-system-settings-v1', { name: 'MoneyMind AI', model: 'Local simulation', notifications: true, maintenance: false, maxTokens: 1500 });
  const [notifications, setNotifications] = useState(settings.notifications), [maintenance, setMaintenance] = useState(settings.maintenance), [saved, setSaved] = useState(false);
  const [confirm, setConfirm] = useState<(() => void) | null>(null);
  return <form className="max-w-4xl space-y-5" onSubmit={e => {
    e.preventDefault(); const data = new FormData(e.currentTarget);
    const save = () => { setSettings({ name: String(data.get('name')).trim(), model: String(data.get('model')), maxTokens: Number(data.get('tokens')), notifications, maintenance }); onSave(`Saved platform demo configuration. Maintenance preference: ${maintenance ? 'on' : 'off'}.`); setSaved(true); };
    if (maintenance !== settings.maintenance) setConfirm(() => save); else save();
  }}><Card className="p-6"><SectionHead title="Application configuration" /><div className="grid gap-5 md:grid-cols-2"><Field label="Application name"><input required name="name" maxLength={60} defaultValue={settings.name} className={fieldClass} /></Field><Field label="Environment"><input readOnly value="Local frontend demo" className={fieldClass} /></Field></div></Card><Card className="p-6"><SectionHead title="AI model configuration" subtitle="Configuration preview only. No provider is connected, and no secrets are stored here." /><div className="grid gap-5 md:grid-cols-2"><Field label="Model adapter"><select name="model" defaultValue={settings.model} className={fieldClass}><option>Local simulation</option><option>GPT-compatible (not connected)</option><option>Claude-compatible (not connected)</option></select></Field><Field label="Response token preference"><input name="tokens" type="number" min="100" max="16000" required defaultValue={settings.maxTokens} className={fieldClass} /></Field></div></Card><Card className="p-6"><SectionHead title="System preferences" />{[{ label: 'System notifications', text: 'Remember the notification preference for a future integration.', value: notifications, set: setNotifications }, { label: 'Maintenance mode preference', text: 'Demo setting only; does not take the application offline.', value: maintenance, set: setMaintenance }].map(s => <div className="flex items-center justify-between gap-4 border-t border-line py-5" key={s.label}><div><p className="text-sm font-medium">{s.label}</p><p className="mt-1 text-sm text-muted">{s.text}</p></div><button type="button" role="switch" aria-label={s.label} aria-checked={s.value} onClick={() => { s.set(!s.value); setSaved(false); }} className="flex h-11 w-12 shrink-0 items-center focus-visible:ring-2 focus-visible:ring-brand"><span className={`flex h-6 w-11 items-center rounded-full px-0.5 ${s.value ? 'bg-brand' : 'bg-line'}`}><span className={`h-5 w-5 rounded-full transition-transform motion-reduce:transition-none ${s.value ? 'translate-x-5 bg-on-brand' : 'bg-muted'}`} /></span></button></div>)}</Card><Card className="p-6"><SectionHead title="Platform information" /><div className="grid gap-3 text-sm text-muted sm:grid-cols-2"><p>Version: 1.1 · Ambient workspace</p><p>Stack: React · TypeScript · Vite</p><p>Persistence: Browser localStorage</p><p>Authorization: Mock UI roles only</p></div></Card><div className="flex items-center justify-end gap-4">{saved && <span role="status" className="flex items-center gap-2 text-sm text-positive"><Check className="h-4 w-4" />Saved locally</span>}<Button type="submit">Save configuration</Button></div>{confirm && <Modal title="Change maintenance preference?" onClose={() => { setConfirm(null); setMaintenance(settings.maintenance); }}><p className="text-sm leading-6 text-muted">This saves a demo preference only. No live service will be stopped or restarted.</p><div className="mt-5 flex justify-end gap-3"><Button secondary type="button" onClick={() => { setConfirm(null); setMaintenance(settings.maintenance); }}>{t("Cancel")}</Button><Button type="button" onClick={() => { confirm(); setConfirm(null); }}>Confirm</Button></div></Modal>}</form>;
}
