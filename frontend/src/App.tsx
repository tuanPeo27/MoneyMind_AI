import { LazyMotion } from 'framer-motion';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, CalendarDays, ChevronDown, Check, X, ArrowUpRight } from 'lucide-react';
import {
  type Page, type Transaction, type Budget, type Category, today, localDate, usePeriodRange, dateLabel,
} from './data';
import { Button, Field, Modal, fieldClass } from './components/ui';
import { Select } from './components/Select';
import { PageSkeleton } from './components/Skeleton';
import { TransactionForm } from './components/transactions';
import { BalanceContext, getTotals } from './lib/totals';
import { setAmountsHidden } from './lib/currency';
import { formatPhone } from './lib/phone';
import { useNotifications } from './hooks/useNotifications';
import { useSavingsGoals } from './hooks/useSavingsGoals';
import { UserLayout, type Profile } from './components/layout/UserLayout';
import { useLocal } from './hooks/useLocal';
import { useTheme } from './hooks/useTheme';
import { useRoute, pagePaths, type DemoRole } from './routing';
import { LanguageProvider, useLanguage } from './i18n';
import { AmbientAIProvider, useAmbientAI } from './components/ambient-ai/AmbientAIProvider';
import { AmbientShell, AmbientAIOverlay, AmbientAIFab, AssistantHome } from './components/ambient-ai/AmbientAI';
import { FINANCE_CHANGED_EVENT } from './components/ambient-ai/AIActionCard';
import { type FinancialContext, type Highlight } from './components/ambient-ai/mockAssistant';
import { AuthPages, authPaths, useErrorText } from './pages/Auth';
import { useSession } from './lib/auth';
import { usersApi } from './services';
import { useWorkspaceData } from './hooks/useWorkspaceData';
import { adminNav, aiUsage } from './admin/data';
import type { AdminUserStats } from './admin/AdminPages';

// Pages are loaded on demand: the first screen (login, or one workspace page) only downloads what it shows.
const loadMotionFeatures = () => import('./lib/motionFeatures').then(module => module.default);
const loadOverview = () => import('./pages/Overview');
const loadManagement = () => import('./pages/Management');
const Overview = lazy(loadOverview);
const Transactions = lazy(() => loadManagement().then(m => ({ default: m.Transactions })));
const Budgets = lazy(() => loadManagement().then(m => ({ default: m.Budgets })));
const Categories = lazy(() => loadManagement().then(m => ({ default: m.Categories })));
const Reports = lazy(() => loadManagement().then(m => ({ default: m.Reports })));
const BudgetForm = lazy(() => loadManagement().then(m => ({ default: m.BudgetForm })));
const CategoryForm = lazy(() => loadManagement().then(m => ({ default: m.CategoryForm })));
const Insights = lazy(() => import('./pages/Intelligence').then(m => ({ default: m.Insights })));
const SettingsPage = lazy(() => import('./pages/Settings'));
const WorkspacePage = lazy(() => import('./pages/Workspace'));
const NotificationsPage = lazy(() => import('./pages/Notifications'));
const AccountsPage = lazy(() => import('./pages/Accounts'));
const SavingsPage = lazy(() => import('./pages/Savings'));
const AdminApp = lazy(() => import('./admin/AdminApp').then(m => ({ default: m.AdminApp })));

/** Once the first screen is idle, fetch the most used pages so switching to them is instant. */
function usePrefetchPages(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const prefetch = () => { void loadOverview(); void loadManagement(); void import('./pages/Accounts'); };
    // Wait for the page's own resources (load event), then for an idle moment, so this never competes with the
    // first screen. requestIdleCallback is missing in older Safari: fall back to a short timeout.
    let idleId: number | undefined, timerId: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (typeof window.requestIdleCallback === 'function') idleId = window.requestIdleCallback(prefetch, { timeout: 5000 });
      else timerId = setTimeout(prefetch, 1500);
    };
    if (document.readyState === 'complete') schedule(); else window.addEventListener('load', schedule, { once: true });
    return () => {
      window.removeEventListener('load', schedule);
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
      if (timerId !== undefined) clearTimeout(timerId);
    };
  }, [enabled]);
}

/** A function whose identity never changes but always calls the latest version (for memoized children). */
function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R) {
  const latest = useRef(fn);
  latest.current = fn;
  return useCallback((...args: A) => latest.current(...args), []);
}
/** Placeholder while a page chunk downloads: a skeleton page that reserves height so the footer does not jump. */
function PageLoading() {
  const { t } = useLanguage();
  return <PageSkeleton label={t('Loading your data...')} />;
}

type Dialog =
  | { kind: 'transaction'; value?: Transaction; draft?: Partial<Transaction> }
  | { kind: 'budget'; value?: Budget }
  | { kind: 'category'; value?: Category }
  | { kind: 'delete'; title: string; text: string; action: () => void }
  | { kind: 'date' } | null;

export default function App() {
  // `m` components render immediately; their animation features arrive in a separate chunk after the first paint.
  return <LazyMotion features={loadMotionFeatures}><LanguageProvider><AmbientAIProvider><Workspace /></AmbientAIProvider></LanguageProvider></LazyMotion>;
}
function Workspace() {
  const { t, locale } = useLanguage();
  const { theme, setTheme } = useTheme();
  const { session, signOut } = useSession();
  // Admins only use the administration area, so they never need the personal pages.
  usePrefetchPages(!session?.user.roles.includes('Admin'));
  const errorText = useErrorText();
  // The role comes from the signed-in account. The backend enforces it on every admin endpoint.
  const role: DemoRole = session?.user.roles.includes('Admin') ? 'ADMIN' : 'USER';
  // Admin accounts only use the administration area, so they never load personal finance data or notifications.
  const personalId = role === 'ADMIN' ? undefined : session?.user.id;
  // Transactions, budgets and categories live on the server. Only UI preferences stay in local storage.
  const data = useWorkspaceData(personalId);
  const { rows, budgets, categories } = data;
  // Avatar and preferences are stored per account. The old shared key leaked one user's avatar to every account.
  useEffect(() => { try { localStorage.removeItem('mm-profile-v1'); } catch { /* storage unavailable */ } }, []);
  const [storedProfile, setProfile] = useLocal<Profile>(`mm-profile-v2:${session?.user.id ?? 'guest'}`, { name: '', email: '', notifications: true, insights: true });
  const profile = useMemo<Profile>(() => session
    ? {
      ...storedProfile, name: session.user.fullName, email: session.user.email, phone: session.user.phoneNumber ? formatPhone(session.user.phoneNumber) : undefined,
      // A photo picked on this device wins; otherwise the account's own avatar (e.g. the Google profile picture).
      avatar: storedProfile.avatar || session.user.avatarUrl || undefined,
    }
    : storedProfile, [storedProfile, session]);
  // Account counts reported by the admin area (from /api/admin/users), shared with the AI assistant context.
  const [userStats, setUserStats] = useState<AdminUserStats | null>(null);
  const [platformVolume, setPlatformVolume] = useState(0);
  // One eye for every balance (Total balance, the accounts list, the Accounts page). Hidden by default, per account.
  const [hidden, setHidden] = useLocal(`mm-balance-hidden-v2:${session?.user.id ?? 'guest'}`, true);
  // Budget and savings-goal alerts created by the server pop up as a toast as soon as the next refresh sees them.
  const notifications = useNotifications(personalId, item => notify(item.message));
  const savings = useSavingsGoals(personalId);
  // A change the AI assistant saved (transaction, budget, fund...) is shown right away on every page.
  useEffect(() => {
    const reload = () => { void data.reload(); void savings.reload(); void notifications.refresh(); };
    window.addEventListener(FINANCE_CHANGED_EVENT, reload);
    return () => window.removeEventListener(FINANCE_CHANGED_EVENT, reload);
  }, [data.reload, savings.reload, notifications.refresh]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // Before any child renders: hide every amount on the personal workspace (the admin area has no eye toggle).
  setAmountsHidden(hidden && !admin);
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
  // Real balance = account opening balances + net of every transaction up to the date (not just the period's rows).
  const balances = useMemo(() => {
    // Only active accounts count: an archived account's starting balance is excluded, so are its transactions.
    const counts = (t: Transaction) => !t.accountId || data.activeAccountIds.has(t.accountId);
    const at = (date: string) => rows.reduce((s, t) => t.date <= date && counts(t) ? s + (t.type === 'Income' ? t.amount : -t.amount) : s, data.openingBalance);
    const before = new Date(range.start + 'T12:00:00'); before.setDate(before.getDate() - 1);
    return { current: at(range.end), previous: at(localDate(before)) };
  }, [rows, data.openingBalance, data.activeAccountIds, range.start, range.end]);
  const financial = useMemo<FinancialContext>(() => ({
    route: path,
    page: admin ? adminNav.find(item => item.path === path)?.label || 'Admin Overview' : page,
    period: admin ? 'Platform demo sample' : period, range,
    rows: admin ? [] : filtered, previous: admin ? [] : previous,
    budgets: admin ? [] : budgets, selection: admin ? undefined : selection,
    metrics: admin ? undefined : { ...getTotals(filtered), balance: balances.current },
    platform: admin ? {
      users: userStats?.total ?? 0, active: userStats?.active ?? 0,
      requests: aiUsage.reduce((s, d) => s + d.requests, 0),
      volume: platformVolume,
    } : undefined,
  }), [path, admin, page, period, range.start, range.end, filtered, previous, budgets, selection, userStats, platformVolume, balances]);
  useEffect(() => { setContext(financial); }, [financial, setContext]);
  // Everything except the auth pages needs a signed-in account.
  useEffect(() => {
    if (!session && !authPage) goTo('/login', true);
    else if (session && (path === '/login' || path === '/register')) goTo(role === 'ADMIN' ? '/admin' : '/', true);
  }, [session, authPage, path, role, goTo]);
  useEffect(() => {
    if (authPage || !session) return;
    // Admin accounts are confined to /admin; user accounts are kept out of it.
    if (!admin && role === 'ADMIN') goTo('/admin', true);
    else if (admin && role !== 'ADMIN') {
      goTo('/', true);
      setToast({ message: 'Administrator access is required. Returned to your dashboard.' });
    } else if (admin && !adminNav.some(item => item.path === path)) goTo('/admin', true);
    else if (!admin && !Object.values(pagePaths).includes(path)) goTo('/', true);
  }, [authPage, session, admin, role, path, goTo]);
  useEffect(() => {
    registerNavigator((target: Highlight) => {
      if (role === 'ADMIN') return; // highlights point at the personal dashboard, which admins do not have
      goTo('/');
      setDialog(null);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        document.getElementById(`ai-${target}`)?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
          block: 'center',
        });
      }));
    });
  }, [goTo, registerNavigator, role]);
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
  }, []);
  /** Run a server call; on failure show the error and report false so dialogs stay open. */
  const attempt = useCallback(async (action: () => Promise<unknown>, success?: string, values?: Record<string, string | number>) => {
    try {
      await action();
      if (success) notify(success, values);
      void notifications.refresh(); // budget alerts are created server-side when transactions change
      return true;
    } catch (e) { notify(errorText(e)); return false; }
  }, [notify, errorText, notifications.refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  function navigate(next: Page) {
    setSelection(undefined);
    goTo(pagePaths[next]);
  }
  function editTransaction(transaction: Transaction) {
    setSelection({ transaction, category: transaction.category });
    setDialog({ kind: 'transaction', value: transaction });
  }
  // Same functions with a fixed identity, so the memoized Overview does not re-render when App does
  // (for example while the AI page opens or closes).
  const navigateStable = useStableCallback(navigate);
  const editTransactionStable = useStableCallback(editTransaction);
  const quickAddManualStable = useStableCallback((draft: Partial<Transaction>) => {
    setSelection(undefined);
    setDialog({ kind: 'transaction', draft });
  });
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
      text: t('“{name}” will be permanently deleted. This cannot be undone.', { name: transaction.description }),
      action: () => {
        setSelection(undefined);
        void attempt(() => data.removeTransaction(transaction.id), 'Transaction deleted.');
      },
    });
  }
  async function saveCategory(category: Category) {
    const oldName = dialog?.kind === 'category' ? dialog.value?.name : undefined;
    if (!await attempt(() => data.saveCategory(category, oldName), 'Category saved.')) return;
    setSelection(undefined); setDialog(null);
  }
  if (authPage) return <div className="min-h-screen overflow-x-clip font-sans text-sm text-ink antialiased"><AuthPages path={path} navigate={goTo} /></div>;
  if (!session) return null; // redirecting to /login
  if (role === 'ADMIN' && !admin) return null; // redirecting to /admin
  const close = () => setDialog(null);
  // First load of the user's data: pages draw skeletons instead of empty states. An error ends it (the alert shows).
  const workspaceLoading = !data.ready && data.error == null;
  const nowMonth = new Date().toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const firstName = profile.name.trim().split(' ').pop() || 'Chương';
  return <div className="min-h-screen overflow-x-clip font-sans text-sm text-ink antialiased">
    <AmbientShell>
      {admin && role === 'ADMIN' ? <Suspense fallback={<PageLoading />}><AdminApp
        path={path} navigate={goTo} onSignOut={() => { void signOut().then(() => goTo('/login')); }}
        onStats={setUserStats} onVolume={setPlatformVolume}
      /></Suspense> : <BalanceContext.Provider value={balances}><UserLayout
        page={page} profile={profile} onNavigate={navigate} search={search} setSearch={setSearch} transactions={rows} categories={categories}
        onExport={() => exportRows(filtered)} role={role} onAdmin={() => { if (role === 'ADMIN') goTo('/admin'); }}
        onAdd={() => { setSelection(undefined); setDialog({ kind: 'transaction' }); }} theme={theme} setTheme={setTheme}
        signedIn onSignIn={() => goTo('/login')} onSignOut={() => { void signOut().then(() => goTo('/login')); }} unreadCount={notifications.unread}
      >
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="mb-2 text-xs text-muted">{new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
            <h1 className="text-[27px] font-semibold tracking-[-0.045em]">
              {page === 'Overview' ? <>{t("Good morning,") + ' '}{firstName}<span className="ml-1 text-muted">.</span></> : page === 'Budgets' ? t("Budget Management") : page === 'Reports' ? t("Reports & Analytics") : t(page)}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {page !== 'Settings' && page !== 'Accounts' && page !== 'Savings Funds' && <Select
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
            {period === 'Custom' && page !== 'Settings' && page !== 'Accounts' && page !== 'Savings Funds' && <button className="min-h-11 text-xs text-muted hover:text-ink" onClick={() => setDialog({ kind: 'date' })}>{t("Edit dates")}</button>}
          </div>
        </div>
        {data.error != null && <p role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-negative/30 bg-negative/10 p-4 text-sm text-negative"><span>{errorText(data.error)}</span><Button secondary onClick={() => void data.reload()}>{t('Try again')}</Button></p>}
        {page === 'Savings Funds' && savings.error != null && <p role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-negative/30 bg-negative/10 p-4 text-sm text-negative"><span>{errorText(savings.error)}</span><Button secondary onClick={() => void savings.reload()}>{t('Try again')}</Button></p>}
        <Suspense fallback={<PageLoading />}>
        {page === 'Overview' && <Overview rows={filtered} allRows={rows} previous={previous} budgets={budgets} categories={categories} accounts={data.activeAccounts} onNavigate={navigateStable} onEdit={editTransactionStable} onQuickAddManual={quickAddManualStable} hidden={hidden} setHidden={setHidden} rangeEnd={range.end} showInsight={profile.insights} loading={workspaceLoading} />}
        {page === 'Accounts' && <AccountsPage loading={workspaceLoading} accounts={data.activeAccounts} archived={data.archivedAccounts} hidden={hidden} setHidden={setHidden}
          onCreate={input => attempt(() => data.createAccount(input), 'Account added.')}
          onUpdate={(id, input) => attempt(() => data.updateAccount(id, input), 'Account saved.')}
          onDelete={async a => {
            // The backend archives an account that still has transactions instead of deleting it.
            const archives = a.transactions > 0;
            return attempt(() => data.removeAccount(a.id), archives ? 'Account archived. Its transactions are kept.' : 'Account deleted.');
          }}
          onRestore={a => attempt(() => data.updateAccount(a.id, { name: a.name, type: a.type }, false), 'Account restored.')} />}
        {page === 'Savings Funds' && <SavingsPage goals={savings.goals} loading={!savings.ready} hidden={hidden} accounts={data.activeAccounts}
          onSave={(id, input) => attempt(() => id ? savings.update(id, input) : savings.create(input), id ? 'Savings fund saved.' : 'Savings fund created.')}
          onContribute={async (goal, amount, accountId) => {
            // A goal that reaches its target is completed by the server, which also sends the "goal reached" notification.
            let reached = false;
            const ok = await attempt(async () => {
              reached = (await savings.contribute(goal.id, amount, accountId)).status === 'Completed';
              // Money taken from an account lowers its balance: re-read the accounts.
              if (accountId) await data.refreshAccounts();
            });
            if (ok && !reached) notify('Money added to {name}.', { name: goal.name });
            return ok;
          }}
          onStatus={(goal, status) => attempt(() => savings.setStatus(goal.id, status), status === 'Active' ? 'Savings fund reopened.' : 'Savings fund cancelled.')}
          onDelete={goal => attempt(async () => { await savings.remove(goal.id); await data.refreshAccounts(); }, 'Savings fund deleted.')} />}
        {page === 'Transactions' && <Transactions loading={workspaceLoading} onManageCategories={() => navigate('Categories')} rows={filtered} categories={categories} search={search} setSearch={setSearch} onAdd={() => { setSelection(undefined); setDialog({ kind: 'transaction' }); }} onEdit={editTransaction} onDelete={deleteTransaction} onExport={exportRows} />}
        {page === 'Budgets' && <Budgets loading={workspaceLoading} budgets={budgets} rows={filtered} categories={categories}
          onAdd={() => setDialog({ kind: 'budget' })}
          onEdit={b => { setSelection({ category: b.category }); setDialog({ kind: 'budget', value: b }); }}
          onDelete={b => setDialog({
            kind: 'delete', title: 'Delete this budget?', text: t('Remove the {name} budget? Transactions will not be affected.', { name: b.category }),
            action: () => { void attempt(() => data.removeBudget(b.id), 'Budget deleted.'); },
          })}
        />}
        {page === 'Categories' && <Categories loading={workspaceLoading} rows={filtered} categories={categories}
          onAdd={() => setDialog({ kind: 'category' })}
          onEdit={c => { setSelection({ category: c.name }); setDialog({ kind: 'category', value: c }); }}
          onDelete={c => {
            if (rows.some(t => t.category === c.name) || budgets.some(b => b.category === c.name)) {
              notify('This category is in use. Reassign transactions and delete its budget first.'); return;
            }
            setDialog({ kind: 'delete', title: 'Delete category?', text: t('Remove “{name}” from your workspace?', { name: c.name }), action: () => {
              void attempt(() => data.removeCategory(c), 'Category deleted.');
            } });
          }}
        />}
        {page === 'Reports' && <Reports loading={workspaceLoading} rows={filtered} allRows={rows} previous={previous} categories={categories} onExport={exportRows} hidden={hidden} />}
        {page === 'AI Financial Assistant' && <AssistantHome />}
        {page === 'Smart Insights' && <Insights loading={workspaceLoading} rows={filtered} previous={previous} budgets={budgets} onNavigate={next => next === 'AI Financial Assistant' ? openAssistant() : navigate(next)} />}
        {page === 'Workspace' && <WorkspacePage profile={profile} onSave={async p => {
          if (await attempt(() => usersApi.updateProfile({ fullName: p.name, phoneNumber: p.phone || null }), 'Profile saved.')) setProfile({ ...storedProfile, avatar: p.avatar });
        }} totals={getTotals(filtered)} previous={getTotals(previous)} hidden={hidden} setHidden={setHidden} signedIn role={role} />}
        {page === 'Notifications' && <NotificationsPage loading={!notifications.ready} items={notifications.items} onMarkAllRead={notifications.markAllRead} onMarkRead={notifications.markRead} onRemove={notifications.remove} onClear={notifications.clear} />}
        {page === 'Settings' && <SettingsPage profile={profile} onSave={p => { setProfile({ ...storedProfile, notifications: p.notifications, insights: p.insights }); notify('Preferences saved on this browser.'); }} onExport={() => exportRows(rows)} role={role} theme={theme} setTheme={setTheme} />}
        </Suspense>
      </UserLayout></BalanceContext.Provider>}
    </AmbientShell>
    {dialog?.kind === 'transaction' && <TransactionForm transaction={dialog.value} draft={dialog.draft} categories={categories} accounts={data.accountNames} onClose={close}
      onAnalyze={dialog.value ? () => { close(); openAssistant('Explain this selected transaction.'); } : undefined}
      onSave={async t => {
        const editing = !!dialog.value;
        let saved: Transaction | undefined;
        if (!await attempt(async () => { saved = await data.saveTransaction(t, editing); }, 'Transaction saved.')) return;
        if (saved) setSelection({ transaction: saved, category: saved.category });
        close();
      }}
    />}
    <Suspense fallback={null}>
    {dialog?.kind === 'budget' && <BudgetForm budget={dialog.value} categories={categories} budgets={budgets} onClose={close} onSave={async b => {
      const editing = !!dialog.value;
      if (await attempt(() => data.saveBudget({ ...dialog.value, ...b }, editing), 'Budget saved.')) close();
    }} />}
    {dialog?.kind === 'category' && <CategoryForm category={dialog.value} categories={categories} onClose={close} onSave={saveCategory} />}
    </Suspense>
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
