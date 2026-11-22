import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, CalendarDays, ChevronDown, Check, X, ArrowUpRight } from 'lucide-react';
import {
  type Page, type Transaction, type Budget, type Category, seedTransactions,
  initialBudgets, initialCategories, today, localDate, usePeriodRange, dateLabel,
} from './data';
import { Button, Field, Modal, fieldClass } from './components/ui';
import { Select } from './components/Select';
import { TransactionForm } from './components/transactions';
import Overview, { getTotals } from './pages/Overview';
import { Transactions, Budgets, Categories, Reports, BudgetForm, CategoryForm } from './pages/Management';
import { Insights } from './pages/Intelligence';
import SettingsPage from './pages/Settings';
import WorkspacePage from './pages/Workspace';
import NotificationsPage from './pages/Notifications';
import { useNotifications, type NotificationKind } from './hooks/useNotifications';
import { UserLayout, type Profile } from './components/layout/UserLayout';
import { useLocal } from './hooks/useLocal';
import { useTheme } from './hooks/useTheme';
import { useRoute, pagePaths, demoRole } from './routing';
import { LanguageProvider, useLanguage } from './i18n';
import { AmbientAIProvider, useAmbientAI } from './components/ambient-ai/AmbientAIProvider';
import { AmbientShell, AmbientAIOverlay, AmbientAIFab, AssistantHome } from './components/ambient-ai/AmbientAI';
import { type FinancialContext, type Highlight } from './components/ambient-ai/mockAssistant';
import { AdminApp } from './admin/AdminApp';
import { AuthPages, authPaths } from './pages/Auth';
import { useSession } from './lib/auth';
import { initialUsers, adminNav, platformTransactions, aiUsage, type PlatformUser } from './admin/data';

type Dialog =
  | { kind: 'transaction'; value?: Transaction }
  | { kind: 'budget'; value?: Budget }
  | { kind: 'category'; value?: Category }
  | { kind: 'delete'; title: string; text: string; action: () => void }
  | { kind: 'date' } | null;

export default function App() {
  return <LanguageProvider><AmbientAIProvider><Workspace /></AmbientAIProvider></LanguageProvider>;
}
function Workspace() {
  const { t, locale } = useLanguage();
  const { theme, setTheme } = useTheme();
  // Existing personal data keys and CRUD behavior are intentionally retained.
  const [rows, setRows, storageError] = useLocal<Transaction[]>('mm-transactions-v1', seedTransactions);
  const [budgets, setBudgets, budgetStorageError] = useLocal<Budget[]>('mm-budgets-v1', initialBudgets);
  const [categories, setCategories, categoryStorageError] = useLocal<Category[]>('mm-categories-v1', initialCategories);
  const [storedProfile, setProfile] = useLocal<Profile>('mm-profile-v1', {
    name: 'Nguyễn Minh Chương', email: 'chuong.nguyen@gmail.com', notifications: true, insights: true,
  });
  const { session, signOut } = useSession();
  const profile = useMemo<Profile>(() => session ? { ...storedProfile, name: session.user.fullName, email: session.user.email } : storedProfile, [storedProfile, session]);
  const role = demoRole;
  const [platformUsers, setPlatformUsers] = useLocal<PlatformUser[]>('mm-platform-users-v1', initialUsers);
  const [hidden, setHidden] = useLocal('mm-balance-hidden-v1', false);
  const notifications = useNotifications();
  const { path: rawPath, navigate: goTo } = useRoute();
  const { setContext, registerNavigator, openAssistant, closeAssistant, open: assistantOpen } = useAmbientAI();
  // The AI assistant is its own page at /assistant. The workspace stays mounted behind it, on the page the user came from.
  const lastPath = useRef('/');
  if (rawPath !== '/assistant') lastPath.current = rawPath;
  const path = rawPath === '/assistant' ? lastPath.current : rawPath;
  const page = (Object.entries(pagePaths).find(([, value]) => value === path)?.[0] || 'Overview') as Page;
  const [period, setPeriod] = useState('This month');
  const [custom, setCustom] = useState({ start: today.slice(0, 7) + '-01', end: today });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [search, setSearch] = useState(''); const [toast, setToast] = useState<{ message: string; values?: Record<string, string | number> }>();
  const [selection, setSelection] = useState<FinancialContext['selection']>();
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const authPage = authPaths.includes(path);
  const admin = path === '/admin' || path.startsWith('/admin/');
  const range = usePeriodRange(period, custom);
  const filtered = useMemo(() => rows.filter(t => t.date >= range.start && t.date <= range.end), [rows, range.start, range.end]);
  const previous = useMemo(() => {
    const start = new Date(range.start + 'T12:00:00'), end = new Date(range.end + 'T12:00:00');
    const prevEnd = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = period === 'This month' || period === 'Last month'
      ? new Date(start.getFullYear(), start.getMonth() - 1, 1)
      : period === 'This year' ? new Date(start.getFullYear() - 1, 0, 1)
      : new Date(prevEnd.getTime() - (end.getTime() - start.getTime()));
    return rows.filter(t => t.date >= localDate(prevStart) && t.date <= localDate(prevEnd));
  }, [rows, range.start, range.end, period]);
  const financial = useMemo<FinancialContext>(() => ({
    route: path,
    page: admin ? adminNav.find(item => item.path === path)?.label || 'Admin Overview' : page,
    period: admin ? 'Platform demo sample' : period, range,
    rows: admin ? [] : filtered, previous: admin ? [] : previous,
    budgets: admin ? [] : budgets, selection: admin ? undefined : selection,
    metrics: admin ? undefined : getTotals(filtered),
    platform: admin ? {
      users: platformUsers.length, active: platformUsers.filter(u => u.active).length,
      requests: aiUsage.reduce((s, d) => s + d.requests, 0),
      volume: platformTransactions.reduce((s, t) => s + t.amount, 0),
    } : undefined,
  }), [path, admin, page, period, range.start, range.end, filtered, previous, budgets, selection, platformUsers]);
  useEffect(() => { setContext(financial); }, [financial, setContext]);
  useEffect(() => {
    if (authPage) return;
    if (admin && role !== 'ADMIN') {
      goTo('/', true);
      setToast({ message: 'Admin access requires the ADMIN demo role. Returned to your dashboard.' });
    } else if (admin && !adminNav.some(item => item.path === path)) goTo('/admin', true);
    else if (!admin && !Object.values(pagePaths).includes(path)) goTo('/', true);
  }, [authPage, admin, role, path, goTo]);
  useEffect(() => {
    registerNavigator((target: Highlight) => {
      goTo('/');
      setDialog(null);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        document.getElementById(`ai-${target}`)?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
          block: 'center',
        });
      }));
    });
  }, [goTo, registerNavigator]);
  // Keep the URL and the assistant's open state in sync (button/Ctrl+K, back button, deep link).
  const pushedAssistant = useRef(false), wasOpen = useRef(assistantOpen);
  useEffect(() => {
    if (assistantOpen && !wasOpen.current && rawPath !== '/assistant') { pushedAssistant.current = true; goTo('/assistant'); }
    else if (!assistantOpen && wasOpen.current && rawPath === '/assistant') {
      if (pushedAssistant.current) { pushedAssistant.current = false; window.history.back(); }
      else goTo(lastPath.current, true);
    }
    wasOpen.current = assistantOpen;
  }, [assistantOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (rawPath === '/assistant' && !assistantOpen && !wasOpen.current) openAssistant();
    if (rawPath !== '/assistant' && assistantOpen) { pushedAssistant.current = false; closeAssistant(); }
  }, [rawPath]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const notify = useCallback((message: string, values?: Record<string, string | number>) => {
    setToast({ message, values }); clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), 5000);
    const lower = message.toLowerCase();
    const kind: NotificationKind = lower.includes('budget') ? 'budget' : lower.includes('categor') ? 'category' : lower.includes('transaction') ? 'transaction' : lower.includes('export') ? 'data' : 'system';
    notifications.add(message, kind, values);
  }, [notifications]);
  function navigate(next: Page) {
    setSelection(undefined);
    goTo(pagePaths[next]);
  }
  function editTransaction(transaction: Transaction) {
    setSelection({ transaction, category: transaction.category });
    setDialog({ kind: 'transaction', value: transaction });
  }
  function exportRows(list: Transaction[]) {
    const escape = (s: unknown) => `"${String(s).replace(/"/g, '""')}"`;
    const csv = '\uFEFF' + [
      ['Date', 'Description', 'Category', 'Account', 'Type', 'Amount (VND)', 'Notes'],
      ...list.map(t => [t.date, t.description, t.category, t.account, t.type, t.amount, t.notes]),
    ].map(r => r.map(escape).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url; link.download = `MoneyMind-${range.start}-${range.end}.csv`; link.click();
    URL.revokeObjectURL(url); notify('Exported {count} transactions as CSV.', { count: list.length });
  }
  function deleteTransaction(transaction: Transaction) {
    setDialog({
      kind: 'delete', title: 'Delete transaction?',
      text: t('“{name}” will be removed from this browser. This cannot be undone.', { name: transaction.description }),
      action: () => {
        setRows(old => old.filter(r => r.id !== transaction.id));
        setSelection(undefined); notify('Transaction deleted.');
      },
    });
  }
  function saveCategory(category: Category) {
    const oldName = dialog?.kind === 'category' ? dialog.value?.name : undefined;
    setCategories(old => oldName ? old.map(c => c.name === oldName ? category : c) : [...old, category]);
    if (oldName) {
      setRows(old => old.map(t => t.category === oldName ? { ...t, category: category.name } : t));
      setBudgets(old => old.map(b => b.category === oldName ? { ...b, category: category.name } : b));
    }
    setSelection(undefined); setDialog(null); notify('Category saved on this browser.');
  }
  if (authPage) return <div className="min-h-screen overflow-x-clip font-sans text-sm text-ink antialiased"><AuthPages path={path} navigate={goTo} /></div>;
  const close = () => setDialog(null);
  const nowMonth = new Date().toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const firstName = profile.name.trim().split(' ').pop() || 'Chương';
  return <div className="min-h-screen overflow-x-clip font-sans text-sm text-ink antialiased">
    <AmbientShell>
      {admin && role === 'ADMIN' ? <AdminApp
        path={path} navigate={goTo} onReturn={() => goTo('/')}
        users={platformUsers} setUsers={setPlatformUsers}
      /> : <UserLayout
        page={page} profile={profile} onNavigate={navigate} search={search} setSearch={setSearch} transactions={rows} categories={categories}
        onExport={() => exportRows(filtered)} role={role} onAdmin={() => { if (role === 'ADMIN') goTo('/admin'); }}
        onAdd={() => { setSelection(undefined); setDialog({ kind: 'transaction' }); }} theme={theme} setTheme={setTheme}
        signedIn={!!session} onSignIn={() => goTo('/login')} onSignOut={() => { void signOut().then(() => goTo('/login')); }} unreadCount={notifications.unread}
      >
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="mb-2 text-xs text-muted">{new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
            <h1 className="text-[27px] font-semibold tracking-[-0.045em]">
              {page === 'Overview' ? <>{t("Good morning,") + ' '}{firstName}<span className="ml-1 text-muted">.</span></> : page === 'Budgets' ? t("Budget Management") : page === 'Reports' ? t("Reports & Analytics") : t(page)}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {page !== 'Settings' && <Select
              className="w-[230px] max-w-full" label={t("Select date range")} value={period}
              onChange={value => {
                if (value === 'Custom') setDialog({ kind: 'date' });
                else { setPeriod(value); setSelection(undefined); }
              }}
              options={['This month', 'Last month', 'This year', 'Custom'].map(p => ({
                value: p,
                label: p === 'This month' ? nowMonth : p === 'Custom' && period === p ? `${dateLabel(custom.start, locale)} – ${dateLabel(custom.end, locale)}` : t(p),
                icon: <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-muted" />,
              }))}
            />}
            {period === 'Custom' && page !== 'Settings' && <button className="min-h-11 text-xs text-muted hover:text-ink" onClick={() => setDialog({ kind: 'date' })}>{t("Edit dates")}</button>}
            {page === 'Overview' && <span className="hidden md:block"><Button onClick={() => { setSelection(undefined); setDialog({ kind: 'transaction' }); }}><Plus className="h-4 w-4" />{t("Add transaction")}</Button></span>}
          </div>
        </div>
        {(storageError || budgetStorageError || categoryStorageError) && <p role="alert" className="mb-4 rounded-lg border border-negative/30 bg-negative/10 p-4 text-sm text-negative">{t("Browser storage is unavailable. Changes will last until you reload.")}</p>}
        {page === 'Overview' && <Overview rows={filtered} allRows={rows} previous={previous} budgets={budgets} categories={categories} onNavigate={navigate} onEdit={editTransaction} hidden={hidden} setHidden={setHidden} rangeEnd={range.end} showInsight={profile.insights} />}
        {page === 'Transactions' && <Transactions rows={filtered} categories={categories} search={search} setSearch={setSearch} onAdd={() => { setSelection(undefined); setDialog({ kind: 'transaction' }); }} onEdit={editTransaction} onDelete={deleteTransaction} onExport={exportRows} />}
        {page === 'Budgets' && <Budgets budgets={budgets} rows={filtered} categories={categories}
          onAdd={() => setDialog({ kind: 'budget' })}
          onEdit={b => { setSelection({ category: b.category }); setDialog({ kind: 'budget', value: b }); }}
          onDelete={b => setDialog({
            kind: 'delete', title: 'Delete this budget?', text: t('Remove the {name} budget? Transactions will not be affected.', { name: b.category }),
            action: () => { setBudgets(old => old.filter(item => item.id !== b.id)); notify('Budget deleted.'); },
          })}
        />}
        {page === 'Categories' && <Categories rows={filtered} categories={categories}
          onAdd={() => setDialog({ kind: 'category' })}
          onEdit={c => { setSelection({ category: c.name }); setDialog({ kind: 'category', value: c }); }}
          onDelete={c => {
            if (rows.some(t => t.category === c.name) || budgets.some(b => b.category === c.name)) {
              notify('This category is in use. Reassign transactions and delete its budget first.'); return;
            }
            setDialog({ kind: 'delete', title: 'Delete category?', text: t('Remove “{name}” from your workspace?', { name: c.name }), action: () => {
              setCategories(old => old.filter(item => item.name !== c.name)); notify('Category deleted.');
            } });
          }}
        />}
        {page === 'Reports' && <Reports rows={filtered} allRows={rows} previous={previous} categories={categories} onExport={exportRows} hidden={hidden} />}
        {page === 'AI Financial Assistant' && <AssistantHome />}
        {page === 'Smart Insights' && <Insights rows={filtered} previous={previous} budgets={budgets} onNavigate={next => next === 'AI Financial Assistant' ? openAssistant() : navigate(next)} />}
        {page === 'Workspace' && <WorkspacePage profile={profile} onSave={p => { setProfile({ ...storedProfile, phone: p.phone, avatar: p.avatar, ...(session ? {} : { name: p.name, email: p.email }) }); notify('Profile saved on this browser.'); }} totals={getTotals(filtered)} previous={getTotals(previous)} hidden={hidden} setHidden={setHidden} signedIn={!!session} role={role} />}
        {page === 'Notifications' && <NotificationsPage items={notifications.items} onMarkAllRead={notifications.markAllRead} onMarkRead={notifications.markRead} onRemove={notifications.remove} onClear={notifications.clear} />}
        {page === 'Settings' && <SettingsPage profile={profile} onSave={p => { setProfile({ ...storedProfile, notifications: p.notifications, insights: p.insights }); notify('Preferences saved on this browser.'); }} onExport={() => exportRows(rows)} role={role} theme={theme} setTheme={setTheme} />}
      </UserLayout>}
    </AmbientShell>
    {dialog?.kind === 'transaction' && <TransactionForm transaction={dialog.value} categories={categories} onClose={close}
      onAnalyze={dialog.value ? () => { close(); openAssistant('Explain this selected transaction.'); } : undefined}
      onSave={t => {
        setRows(old => old.some(r => r.id === t.id) ? old.map(r => r.id === t.id ? t : r) : [t, ...old]);
        setSelection({ transaction: t, category: t.category }); close(); notify('Transaction saved on this browser.');
      }}
    />}
    {dialog?.kind === 'budget' && <BudgetForm budget={dialog.value} categories={categories} budgets={budgets} onClose={close} onSave={b => {
      setBudgets(old => old.some(r => r.id === b.id) ? old.map(r => r.id === b.id ? b : r) : [...old, b]); close(); notify('Budget saved on this browser.');
    }} />}
    {dialog?.kind === 'category' && <CategoryForm category={dialog.value} categories={categories} onClose={close} onSave={saveCategory} />}
    {dialog?.kind === 'delete' && <Modal title={dialog.title} onClose={close}>
      <p className="text-sm leading-6 text-muted">{dialog.text}</p>
      <div className="mt-6 flex justify-end gap-3"><Button secondary onClick={close}>{t("Cancel")}</Button><Button className="!bg-negative !text-on-negative" onClick={() => { dialog.action(); close(); }}>{t("Delete")}</Button></div>
    </Modal>}
    {dialog?.kind === 'date' && <Modal title={t("Choose a date range")} onClose={close}>
      <form className="space-y-5" onSubmit={e => {
        e.preventDefault(); const d = new FormData(e.currentTarget);
        const next = { start: String(d.get('start')), end: String(d.get('end')) };
        if (next.start > next.end) { notify('End date must be after the start date.'); return; }
        setCustom(next); setPeriod('Custom'); setSelection(undefined); close();
      }}>
        <Field label={t("Start date")}><input required name="start" type="date" defaultValue={custom.start} className={fieldClass} /></Field>
        <Field label={t("End date")}><input required name="end" type="date" defaultValue={custom.end} className={fieldClass} /></Field>
        <div className="flex justify-end gap-3"><Button secondary type="button" onClick={close}>{t("Cancel")}</Button><Button>{t("Apply range")}</Button></div>
      </form>
    </Modal>}
    <AmbientAIFab />
    <AmbientAIOverlay />
    {toast && <div role="status" className="fixed right-4 top-[86px] z-[60] flex max-w-[calc(100vw-32px)] items-center gap-3 glass-strong rounded-xl px-4 py-3 text-sm motion-safe:animate-[toast-in_280ms_cubic-bezier(0.22,1,0.36,1)] sm:right-5">
      <Check className="h-4 w-4 shrink-0 text-positive" /><span>{t(toast.message, toast.values)}</span><button aria-label={t("Dismiss notification")} onClick={() => setToast(undefined)} className="flex h-11 w-11 shrink-0 items-center justify-center text-muted"><X className="h-4 w-4" /></button>
    </div>}
  </div>;
}
