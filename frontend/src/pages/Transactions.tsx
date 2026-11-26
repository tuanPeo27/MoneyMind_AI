import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import {
  Search, Download, Pencil, Trash2, ArrowUpRight, ArrowDownLeft, ArrowUp, ArrowDown, ArrowDownUp, Shapes, X, Plus,
  AlertTriangle, Sparkles, Wallet, ChevronRight, ReceiptText, RotateCw,
} from 'lucide-react';
import { useLanguage } from '../i18n';
import { type Transaction, type Category, money, dateLabel, today as todayIso, localDate } from '../data';
import { Button, Card, Badge, Change, IconButton, Modal, fieldClass } from '../components/ui';
import { CategoryIcon } from '../components/CategoryIcon';
import { Select } from '../components/Select';
import { Pagination, usePagination } from '../components/Pagination';
import { LoadingStatus, Skeleton, SkeletonText, useFadeIn } from '../components/Skeleton';
import { accountLabel, categoryLabel } from '../i18n/labels';
import { getTotals, percentChange } from '../lib/totals';
import { cashFlowSeries, groupByDay, periodSparks, type FlowWindow } from '../lib/cashflow';
import { unusualExpenses, type UnusualExpense } from '../lib/insights';

// recharts only loads with the cash-flow chart, after the page itself has drawn.
const CashFlowChart = lazy(() => import('../components/charts').then(m => ({ default: m.CashFlowChart })));
const CHART_HEIGHT = 200;
/** Insights need a few expenses in the period, otherwise "largest" and "top category" say nothing. */
const MIN_EXPENSES = 3;

type Sort = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc';
type TypeFilter = 'All' | 'Income' | 'Expense';

export type TransactionsProps = {
  /** Transactions in the selected period. */
  rows: Transaction[];
  /** Every loaded transaction (the cash-flow chart and the "usual amount" history reach outside the period). */
  allRows: Transaction[];
  /** The period before the selected one, for the comparisons on the summary cards. */
  previous: Transaction[];
  categories: Category[];
  /** Active account names (accounts that only appear on transactions are added from the rows). */
  accounts: string[];
  range: { start: string; end: string };
  loading?: boolean;
  failed?: boolean;
  onRetry: () => void;
  search: string;
  setSearch: (s: string) => void;
  onAdd: () => void;
  onEdit: (t: Transaction) => void;
  onDelete: (t: Transaction) => void;
  onExport: (rows: Transaction[]) => void;
  onManageCategories: () => void;
  /** Open the AI assistant with a question; with a transaction, the assistant also gets it as the selection. */
  onAsk: (question: string, transaction?: Transaction) => void;
};

const signed = (t: Pick<Transaction, 'type' | 'amount'>) => `${t.type === 'Income' ? '+' : '−'}${money(t.amount)}`;
const amountTone = (type: Transaction['type']) => type === 'Income' ? 'text-positive' : 'text-ink';

export function Transactions(props: TransactionsProps) {
  const { rows, allRows, previous, categories, accounts, range, loading = false, failed = false, onRetry, search, setSearch, onAdd, onEdit, onDelete, onExport, onManageCategories, onAsk } = props;
  const { t, language } = useLanguage();
  const [type, setType] = useState<TypeFilter>('All');
  const [category, setCategory] = useState('All categories');
  const [account, setAccount] = useState('All accounts');
  const [sort, setSort] = useState<Sort>('date-desc');
  const [detail, setDetail] = useState<Transaction>();

  const query = search.trim().toLocaleLowerCase();
  const filtered = useMemo(() => rows.filter(row => {
    if (type !== 'All' && row.type !== type) return false;
    if (category !== 'All categories' && row.category !== category) return false;
    if (account !== 'All accounts' && row.account !== account) return false;
    if (!query) return true;
    return `${row.description} ${row.notes} ${row.category} ${row.account} ${categoryLabel(row.category, language)} ${accountLabel(row.account, language)}`.toLocaleLowerCase().includes(query);
  }).sort((a, b) => {
    const [key, direction] = sort.split('-');
    const dir = direction === 'asc' ? 1 : -1;
    // Ties: newest first for equal amounts, larger first inside the same day.
    if (key === 'amount') return (a.amount - b.amount) * dir || b.date.localeCompare(a.date);
    return a.date.localeCompare(b.date) * dir || b.amount - a.amount;
  }), [rows, type, category, account, query, sort, language]);

  const pager = usePagination(filtered, 20, `${query}|${type}|${category}|${account}|${sort}|${range.start}|${range.end}`);
  const unusual = useMemo(() => new Map(unusualExpenses(rows, allRows).map(u => [u.t.id, u])), [rows, allRows]);
  const accountNames = useMemo(() => [...new Set([...accounts, ...rows.map(r => r.account)])], [accounts, rows]);
  const shownCategories = categories.filter(c => type === 'All' || c.type === type);
  const filters: { key: string; label: string; clear: () => void }[] = [
    ...(query ? [{ key: 'search', label: `“${search.trim()}”`, clear: () => setSearch('') }] : []),
    ...(type !== 'All' ? [{ key: 'type', label: t(type), clear: () => setType('All') }] : []),
    ...(category !== 'All categories' ? [{ key: 'category', label: categoryLabel(category, language), clear: () => setCategory('All categories') }] : []),
    ...(account !== 'All accounts' ? [{ key: 'account', label: accountLabel(account, language), clear: () => setAccount('All accounts') }] : []),
  ];
  const clearFilters = () => { setSearch(''); setType('All'); setCategory('All categories'); setAccount('All accounts'); };
  const shown = getTotals(filtered);
  const grouped = sort.startsWith('date');
  const empty = !loading && !failed && !allRows.length;

  return <div className="space-y-5">
    {loading && <LoadingStatus label={t('Loading your data...')} />}
    {failed && !rows.length
      ? <Card className="flex flex-wrap items-center justify-between gap-4 p-5" >
        <div><h2 className="text-[1rem] font-semibold">{t('Could not load your transactions')}</h2><p className="mt-1 text-sm text-muted">{t('Check your connection, then try again. Nothing was changed.')}</p></div>
        <Button secondary onClick={onRetry}><RotateCw className="size-4" aria-hidden="true" />{t('Try again')}</Button>
      </Card>
      : <>
        <Overview rows={rows} previous={previous} range={range} loading={loading} />
        {!empty && <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
          <CashFlow allRows={allRows} rangeEnd={range.end} loading={loading} wide={!loading && rows.filter(r => r.type === 'Expense').length < MIN_EXPENSES} />
          <QuickInsights rows={rows} unusual={unusual} categories={categories} loading={loading} onOpen={setDetail}
            onCategory={name => { setType('All'); setCategory(name); document.getElementById('transaction-list')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }}
            onAsk={() => onAsk(t('Review my transactions this period: what stands out, and what should I check?'))} />
        </div>}
      </>}

    {!(failed && !rows.length) && <Card className="overflow-hidden">
      <div id="transaction-list" className="scroll-mt-24 space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-[1_1_260px]">
            <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted" aria-hidden="true" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} aria-label={t('Search transactions')} placeholder={t('Search by name, note, category or account')} className={`${fieldClass} pl-10`} />
          </div>
          <TypeTabs value={type} onChange={value => {
            setType(value);
            // A category of the other type would hide every row.
            if (value !== 'All' && categories.find(c => c.name === category)?.type !== value) setCategory('All categories');
          }} />
          <Button secondary onClick={() => onExport(filtered)} disabled={!filtered.length} title={t('Export the {count} transactions shown as CSV', { count: filtered.length })}>
            <Download aria-hidden="true" className="size-4" />{t('Export CSV')}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:flex lg:flex-wrap lg:items-center">
          <Select label={t('Filter category')} value={category} onChange={setCategory} className="lg:w-[200px]" options={[
            { value: 'All categories', label: t('All categories'), icon: <Shapes aria-hidden="true" className="size-4 shrink-0 text-muted" /> },
            ...shownCategories.map(c => ({ value: c.name, label: categoryLabel(c.name, language), icon: <CategoryIcon name={c.name} icon={c.icon} small /> })),
          ]} />
          <Select label={t('Filter account')} value={account} onChange={setAccount} className="lg:w-[190px]" options={[
            { value: 'All accounts', label: t('All accounts'), icon: <Wallet aria-hidden="true" className="size-4 shrink-0 text-muted" /> },
            ...accountNames.map(name => ({ value: name, label: accountLabel(name, language), icon: <Wallet aria-hidden="true" className="size-4 shrink-0 text-muted" /> })),
          ]} />
          <Select label={t('Sort transactions')} value={sort} onChange={value => setSort(value as Sort)} className="lg:w-[190px]" options={([
            ['date-desc', 'Newest first'], ['date-asc', 'Oldest first'], ['amount-desc', 'Highest amount'], ['amount-asc', 'Lowest amount'],
          ] as const).map(([value, label]) => ({ value, label: t(label), icon: <ArrowDownUp aria-hidden="true" className="size-4 shrink-0 text-muted" /> }))} />
          <button type="button" onClick={onManageCategories} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            <Shapes aria-hidden="true" className="size-4" />{t('Manage categories')}
          </button>
          <div className="col-span-2 text-xs text-muted lg:ml-auto">
            {loading ? <SkeletonText className="h-4" bar="h-2.5" width="w-56" />
              : <p aria-live="polite" className="tabular-nums">
                {t('{count} transactions', { count: filtered.length })}
                {filtered.length > 0 && <><span className="mx-1.5">·</span>{t('In')} <span className="text-positive">+{money(shown.income)}</span><span className="mx-1.5">·</span>{t('Out')} <span className="text-ink">−{money(shown.expense)}</span></>}
              </p>}
          </div>
        </div>
        {filters.length > 0 && <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            {filters.map(f => <button key={f.key} type="button" onClick={f.clear} aria-label={t('Remove filter {name}', { name: f.label })}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-ink transition-colors hover:border-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              <span className="max-w-[180px] truncate">{f.label}</span><X aria-hidden="true" className="size-3.5 text-muted" />
            </button>)}
            {filters.length > 1 && <button type="button" onClick={clearFilters} className="min-h-9 rounded-lg px-1 font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{t('Clear filters')}</button>}
        </div>}
      </div>

      {loading ? <TableSkeleton />
        : empty ? <EmptyState icon={ReceiptText} title={t('No transactions yet')} text={t('Add your first income or expense to start tracking your cash flow.')}
          action={<Button onClick={onAdd}><Plus aria-hidden="true" className="size-4" />{t('Add transaction')}</Button>} />
          : !rows.length ? <EmptyState icon={ReceiptText} title={t('No transactions in this period')} text={t('Pick another period at the top of the page, or add a transaction.')}
            action={<Button secondary onClick={onAdd}><Plus aria-hidden="true" className="size-4" />{t('Add transaction')}</Button>} />
            : !filtered.length ? <EmptyState icon={Search} title={t('No transactions match your filters')} text={t('Try another search, or clear the filters to see the whole period.')}
              action={<Button secondary onClick={clearFilters}>{t('Clear filters')}</Button>} />
              : <TransactionList rows={pager.items} grouped={grouped} sort={sort} setSort={setSort} categories={categories} unusual={unusual}
                onOpen={setDetail} onEdit={onEdit} onDelete={onDelete} />}
      {!loading && <Pagination pager={pager} sizes={[20, 50, 100]} className="border-t border-line" />}
    </Card>}

    {detail && <TransactionDetail transaction={detail} categories={categories} rows={rows} unusual={unusual.get(detail.id)} onClose={() => setDetail(undefined)}
      onEdit={() => { setDetail(undefined); onEdit(detail); }}
      onDelete={() => { setDetail(undefined); onDelete(detail); }}
      onAsk={() => { setDetail(undefined); onAsk(t('Explain this selected transaction.'), detail); }} />}
  </div>;
}

/* ---------- B. Summary cards ---------- */

function Overview({ rows, previous, range, loading }: { rows: Transaction[]; previous: Transaction[]; range: { start: string; end: string }; loading: boolean }) {
  const now = getTotals(rows), before = getTotals(previous);
  const hasPrevious = previous.length > 0;
  const sparks = useMemo(() => periodSparks(rows, range, todayIso), [rows, range]);
  return <div className="grid gap-4 md:grid-cols-3">
    <Stat label="Total income" value={money(now.income)} tone="text-positive" loading={loading} spark={sparks?.income} color="var(--color-positive)"
      change={hasPrevious ? <ChangeLine now={now.income} before={before.income} /> : null} />
    <Stat label="Total expenses" value={money(now.expense)} tone="text-ink" loading={loading} spark={sparks?.expense} color="var(--color-negative)"
      change={hasPrevious ? <ChangeLine now={now.expense} before={before.expense} inverse /> : null} />
    <Stat label="Net cash flow" value={`${now.savings > 0 ? '+' : now.savings < 0 ? '−' : ''}${money(Math.abs(now.savings))}`} tone={now.savings >= 0 ? 'text-ink' : 'text-negative'}
      loading={loading} spark={sparks?.net} color="var(--color-brand)"
      change={hasPrevious ? <NetChange now={now.savings} before={before.savings} /> : null}
      note={now.income > 0 ? <SavingsRate rate={now.rate} /> : undefined} />
  </div>;
}
/** Percent change; when the previous value is 0 a percentage means nothing, so the previous amount is shown. */
function ChangeLine({ now, before, inverse = false }: { now: number; before: number; inverse?: boolean }) {
  const { t } = useLanguage();
  if (!before) return now ? <span>{t('Previous period: {amount}', { amount: money(0) })}</span> : <span>{t('Unchanged from previous period')}</span>;
  const change = percentChange(now, before);
  if (Math.abs(change) < 0.05) return <span>{t('Unchanged from previous period')}</span>;
  return <><Change value={change} inverse={inverse} /><Compared /></>;
}
function Compared() { const { t } = useLanguage(); return <span>{t('vs. previous period')}</span>; }
function SavingsRate({ rate }: { rate: number }) { const { t } = useLanguage(); return <span>{t('Savings rate {rate}', { rate: `${Math.round(rate)}%` })}</span>; }
/** Net can be negative in either period, so a percentage would mislead: show the difference in money instead. */
function NetChange({ now, before }: { now: number; before: number }) {
  const { t } = useLanguage();
  const d = now - before;
  if (Math.abs(d) < 1) return <span>{t('Unchanged from previous period')}</span>;
  return <><span className={`inline-flex items-center gap-0.5 font-medium ${d > 0 ? 'text-positive' : 'text-negative'}`}>
    {d > 0 ? <ArrowUpRight aria-hidden="true" className="size-3.5" /> : <ArrowDown aria-hidden="true" className="size-3.5" />}{money(Math.abs(d))}
  </span><Compared /></>;
}
function Stat({ label, value, tone, change, note, spark, color, loading }: { label: string; value: string; tone: string; change: ReactNode; note?: ReactNode; spark?: number[]; color: string; loading: boolean }) {
  const { t } = useLanguage();
  const fade = useFadeIn(loading);
  return <Card className="flex flex-col p-4 sm:p-5">
    <p className="text-sm text-muted">{t(label)}</p>
    {loading ? <><SkeletonText className="mt-2 h-8" bar="h-6" width="w-36" /><SkeletonText className="mt-1.5 h-5" bar="h-3" width="w-40" /><Skeleton className="mt-3 hidden h-9 w-full !rounded-lg sm:block" /></>
      : <div className={fade}>
        <p className={`mt-2 text-2xl font-semibold tracking-tight tabular-nums ${tone}`}>{value}</p>
        <p className="mt-1.5 flex min-h-5 flex-wrap items-center gap-x-1.5 text-xs text-muted">
          {change ?? <span>{t('No data for the previous period')}</span>}{note && <><span aria-hidden="true">·</span>{note}</>}
        </p>
        <Sparkline values={spark} color={color} />
      </div>}
  </Card>;
}
/** A tiny trend line (inline SVG, no chart library). Flat data or a single point draws nothing but keeps the space. */
function Sparkline({ values, color }: { values?: number[]; color: string }) {
  // Hidden on phones, where the three cards stack and the list should come sooner.
  const box = <div aria-hidden="true" className="mt-3 hidden h-9 w-full sm:block" />;
  if (!values || values.length < 2 || values.every(v => v === values[0])) return box;
  const min = Math.min(0, ...values), max = Math.max(...values), span = max - min || 1;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${34 - ((v - min) / span) * 30}`);
  return <svg aria-hidden="true" viewBox="0 0 100 36" preserveAspectRatio="none" className="mt-3 hidden h-9 w-full overflow-visible sm:block">
    <polygon points={`0,36 ${points.join(' ')} 100,36`} fill={color} opacity={0.1} />
    <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
  </svg>;
}

/* ---------- C. Cash flow chart ---------- */

function CashFlow({ allRows, rangeEnd, loading, wide }: { allRows: Transaction[]; rangeEnd: string; loading: boolean; wide: boolean }) {
  const { t, locale } = useLanguage();
  const [span, setSpan] = useState<FlowWindow>('30d');
  // Ends with the selected period, but never in the future (no empty bars for days still to come).
  const end = rangeEnd < todayIso ? rangeEnd : todayIso;
  const data = useMemo(() => cashFlowSeries(allRows, span, end, locale), [allRows, span, end, locale]);
  const totals = data.reduce((s, p) => ({ income: s.income + p.income, expense: s.expense + p.expense }), { income: 0, expense: 0 });
  const hasData = totals.income > 0 || totals.expense > 0;
  // The chart grows with the card, so it fills the row when the insights panel next to it is taller.
  const slot = (node: ReactNode) => <div className="relative flex-1" style={{ minHeight: CHART_HEIGHT }}><div className="absolute inset-0">{node}</div></div>;
  return <Card className={`flex flex-col p-4 sm:p-5 ${wide ? 'lg:col-span-2' : ''}`}>
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-[1rem] font-semibold tracking-[-0.02em]">{t('Cash flow')}</h2>
        {loading ? <SkeletonText className="mt-1 h-5" bar="h-3" width="w-48" />
          : <p className="mt-1 text-xs tabular-nums text-muted">{t('Up to {date}', { date: dateLabel(end, locale) })}<span className="mx-1.5">·</span><span className="text-positive">+{money(totals.income)}</span><span className="mx-1.5">·</span>−{money(totals.expense)}</p>}
      </div>
      <div role="tablist" aria-label={t('Cash flow interval')} className="flex rounded-xl bg-base/50 p-1">
        {(['7d', '30d', '6m'] as const).map(w => <button key={w} type="button" role="tab" aria-selected={w === span} onClick={() => setSpan(w)}
          className={`min-h-9 rounded-lg px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${w === span ? 'bg-surface font-medium text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
          {t(w === '7d' ? '7 days' : w === '30d' ? '30 days' : '6 months')}
        </button>)}
      </div>
    </div>
    {slot(loading ? <Skeleton className="block size-full !rounded-xl" />
      : hasData ? <Suspense fallback={<Skeleton className="block size-full !rounded-xl" />}><CashFlowChart data={data} height="100%" /></Suspense>
        : <div className="flex size-full items-center justify-center rounded-xl border border-dashed border-line text-sm text-muted">{t('No income or expenses in this window.')}</div>)}
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-hidden="true">
      <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-positive" />{t('Income')}</span>
      <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-negative" />{t('Expense')}</span>
    </div>
  </Card>;
}

/* ---------- E. Transaction insights ---------- */

function QuickInsights({ rows, unusual, categories, loading, onOpen, onCategory, onAsk }: {
  rows: Transaction[]; unusual: Map<string, UnusualExpense>; categories: Category[]; loading: boolean;
  onOpen: (t: Transaction) => void; onCategory: (name: string) => void; onAsk: () => void;
}) {
  const { t, language } = useLanguage();
  const expenses = rows.filter(r => r.type === 'Expense');
  if (loading) return <Card className="p-4 sm:p-5"><div aria-hidden="true">
    <SkeletonText className="h-6" bar="h-3.5" width="w-36" /><SkeletonText className="mt-1 h-4" bar="h-2.5" width="w-44" />
    {[0, 1, 2].map(i => <div key={i} className="mt-3 flex items-center gap-3"><Skeleton className="size-9 shrink-0 !rounded-lg" /><span className="flex-1"><SkeletonText className="h-4" bar="h-2.5" width="w-24" /><SkeletonText className="mt-1 h-5" bar="h-3" width="w-36" /></span></div>)}
  </div></Card>;
  if (expenses.length < MIN_EXPENSES) return null;
  const total = expenses.reduce((s, r) => s + r.amount, 0);
  const largest = expenses.reduce((a, b) => b.amount > a.amount ? b : a);
  const byCategory = new Map<string, { amount: number; count: number }>();
  for (const r of expenses) { const c = byCategory.get(r.category) ?? { amount: 0, count: 0 }; c.amount += r.amount; c.count += 1; byCategory.set(r.category, c); }
  const [topName, top] = [...byCategory].sort((a, b) => b[1].amount - a[1].amount)[0];
  const odd = [...unusual.values()][0];
  const share = (n: number) => `${Math.round(n / total * 100)}%`;
  const iconOf = (name: string) => categories.find(c => c.name === name)?.icon;
  return <Card className="flex flex-col p-4 sm:p-5">
    <h2 className="text-[1rem] font-semibold tracking-[-0.02em]">{t('Transaction insights')}</h2>
    <p className="mt-1 text-xs text-muted">{t('Worked out from your transactions in this period.')}</p>
    <ul className="mt-2 flex-1 divide-y divide-line/80">
      <InsightRow icon={<CategoryIcon name={largest.category} icon={iconOf(largest.category)} />} label={t('Largest expense')}
        title={largest.description} detail={`${money(largest.amount)} · ${share(largest.amount)} ${t('of spending')}`} onClick={() => onOpen(largest)} />
      <InsightRow icon={<CategoryIcon name={topName} icon={iconOf(topName)} />} label={t('Top spending category')}
        title={categoryLabel(topName, language)} detail={`${money(top.amount)} · ${share(top.amount)} ${t('of spending')} · ${t('{count} transactions', { count: top.count })}`} onClick={() => onCategory(topName)} />
      {odd && <InsightRow icon={<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-alert/10 text-alert"><AlertTriangle aria-hidden="true" className="size-4" /></span>}
        label={t('Unusual transaction')} title={odd.t.description}
        detail={t('{times}× your usual {category} expense', { times: (odd.t.amount / odd.usual).toFixed(1), category: categoryLabel(odd.t.category, language) })} onClick={() => onOpen(odd.t)} />}
    </ul>
    <button type="button" onClick={onAsk} className="mt-2 inline-flex min-h-11 items-center gap-2 self-start rounded-xl text-sm font-medium text-ai hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ai">
      <Sparkles aria-hidden="true" className="size-4" />{t('Ask AI about these transactions')}
    </button>
  </Card>;
}
function InsightRow({ icon, label, title, detail, onClick }: { icon: ReactNode; label: string; title: string; detail: string; onClick: () => void }) {
  return <li><button type="button" onClick={onClick} className="group flex w-full items-center gap-3 rounded-lg py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
    {icon}
    <span className="min-w-0 flex-1">
      <span className="block text-xs text-muted">{label}</span>
      <span className="block truncate text-sm font-medium">{title}</span>
      <span className="block text-xs leading-5 tabular-nums text-muted">{detail}</span>
    </span>
    <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
  </button></li>;
}

/* ---------- D. Transaction list ---------- */

function useDayLabel() {
  const { t, locale } = useLanguage();
  const yesterday = new Date(todayIso + 'T12:00:00'); yesterday.setDate(yesterday.getDate() - 1);
  const y = localDate(yesterday), year = todayIso.slice(0, 4);
  return (date: string) => date === todayIso ? t('Today') : date === y ? t('Yesterday')
    : new Date(date + 'T12:00:00').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', ...(date.slice(0, 4) !== year ? { year: 'numeric' } : {}) });
}
function DayTotal({ income, expense }: { income: number; expense: number }) {
  return <span className="tabular-nums">{income > 0 && <span className="text-positive">+{money(income)}</span>}{income > 0 && expense > 0 && <span className="mx-1.5">·</span>}{expense > 0 && <span>−{money(expense)}</span>}</span>;
}

function TransactionList({ rows, grouped, sort, setSort, categories, unusual, onOpen, onEdit, onDelete }: {
  rows: Transaction[]; grouped: boolean; sort: Sort; setSort: (s: Sort) => void; categories: Category[]; unusual: Map<string, UnusualExpense>;
  onOpen: (t: Transaction) => void; onEdit: (t: Transaction) => void; onDelete: (t: Transaction) => void;
}) {
  const { t, language, locale } = useLanguage();
  const dayLabel = useDayLabel();
  const groups = grouped ? groupByDay(rows) : [{ date: '', rows, income: 0, expense: 0 }];
  const iconOf = (name: string) => categories.find(c => c.name === name)?.icon;
  const sortButton = (key: 'date' | 'amount', label: string) => {
    const active = sort.startsWith(key), asc = sort.endsWith('asc');
    const Icon = !active ? ArrowDownUp : asc ? ArrowUp : ArrowDown;
    return <button type="button" onClick={() => setSort(`${key}-${active && !asc ? 'asc' : 'desc'}` as Sort)}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${active ? 'text-ink' : ''}`}>
      {t(label)}<Icon aria-hidden="true" className="size-3.5" />
    </button>;
  };
  const ariaSort = (key: string) => sort.startsWith(key) ? (sort.endsWith('asc') ? 'ascending' : 'descending') : undefined;
  const flag = (row: Transaction) => unusual.has(row.id) && <span title={t('Unusually large for {category}', { category: categoryLabel(row.category, language) })} className="shrink-0 text-alert">
    <AlertTriangle aria-label={t('Unusually large for {category}', { category: categoryLabel(row.category, language) })} className="size-3.5" />
  </span>;

  return <>
    {/* Tablet and desktop: a table. Account and type columns appear from 1024 px. */}
    <table className="hidden w-full text-left text-sm md:table">
      <thead className="border-y border-line bg-base/50 text-xs text-muted">
        <tr>
          <th scope="col" className="px-5 py-2 font-medium">{t('Transaction')}</th>
          <th scope="col" className="px-3 py-2 font-medium">{t('Category')}</th>
          <th scope="col" className="hidden px-3 py-2 font-medium lg:table-cell">{t('Account')}</th>
          <th scope="col" aria-sort={ariaSort('date')} className="px-3 py-1 font-medium">{sortButton('date', 'Date')}</th>
          <th scope="col" className="hidden px-3 py-2 font-medium lg:table-cell">{t('Type')}</th>
          <th scope="col" aria-sort={ariaSort('amount')} className="px-3 py-1 text-right font-medium">{sortButton('amount', 'Amount')}</th>
          <th scope="col" className="w-[104px] px-3 py-2"><span className="sr-only">{t('Actions')}</span></th>
        </tr>
      </thead>
      {groups.map(g => <tbody key={g.date || 'all'} className="divide-y divide-line/70">
        {grouped && <tr className="bg-base/35">
          <th colSpan={7} scope="colgroup" className="px-5 py-2 text-left text-xs font-medium text-muted">
            <span className="flex items-center justify-between gap-3"><span className="text-ink/90">{dayLabel(g.date)}</span><DayTotal income={g.income} expense={g.expense} /></span>
          </th>
        </tr>}
        {g.rows.map(row => <tr key={row.id} onClick={() => onOpen(row)} className="group cursor-pointer transition-colors hover:bg-brand/[0.06]">
          <td className="max-w-[320px] px-5 py-2">
            <button type="button" onClick={e => { e.stopPropagation(); onOpen(row); }} className="flex min-h-11 max-w-full items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              <CategoryIcon name={row.category} icon={iconOf(row.category)} />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5"><span className="truncate font-medium">{row.description}</span>{flag(row)}</span>
                {row.notes && <span className="block truncate text-xs text-muted">{row.notes}</span>}
              </span>
            </button>
          </td>
          <td className="px-3 py-2"><Badge>{categoryLabel(row.category, language)}</Badge></td>
          <td className="hidden max-w-[160px] truncate px-3 py-2 text-muted lg:table-cell">{accountLabel(row.account, language)}</td>
          <td className="whitespace-nowrap px-3 py-2 text-muted">{dateLabel(row.date, locale)}</td>
          <td className="hidden px-3 py-2 lg:table-cell"><TypeLabel type={row.type} /></td>
          <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums ${amountTone(row.type)}`}>{signed(row)}</td>
          <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
            <div className="flex justify-end opacity-70 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <IconButton label={t('Edit {name}', { name: row.description })} icon={Pencil} onClick={() => onEdit(row)} />
              <IconButton label={t('Delete {name}', { name: row.description })} icon={Trash2} onClick={() => onDelete(row)} />
            </div>
          </td>
        </tr>)}
      </tbody>)}
    </table>

    {/* Phone: a list; tapping a row opens its details, where edit and delete are. */}
    <div className="border-t border-line md:hidden">
      {groups.map(g => <section key={g.date || 'all'} aria-label={grouped ? dayLabel(g.date) : undefined}>
        {grouped && <h3 className="flex items-center justify-between gap-3 bg-base/35 px-4 py-2 text-xs font-medium text-muted"><span className="text-ink/90">{dayLabel(g.date)}</span><DayTotal income={g.income} expense={g.expense} /></h3>}
        <ul className="divide-y divide-line/70">{g.rows.map(row => <li key={row.id}>
          <button type="button" onClick={() => onOpen(row)} className="flex min-h-16 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-brand/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand">
            <CategoryIcon name={row.category} icon={iconOf(row.category)} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5"><span className="truncate text-sm font-medium">{row.description}</span>{flag(row)}</span>
              <span className="block truncate text-xs text-muted">{categoryLabel(row.category, language)}<span className="mx-1">·</span>{accountLabel(row.account, language)}{!grouped && <><span className="mx-1">·</span>{dateLabel(row.date, locale)}</>}</span>
            </span>
            <span className={`shrink-0 text-sm font-semibold tabular-nums ${amountTone(row.type)}`}>{signed(row)}</span>
          </button>
        </li>)}</ul>
      </section>)}
    </div>
  </>;
}
function TypeLabel({ type }: { type: Transaction['type'] }) {
  const { t } = useLanguage();
  return <span className={`inline-flex items-center gap-1.5 text-xs ${type === 'Income' ? 'text-positive' : 'text-muted'}`}>
    {type === 'Income' ? <ArrowDownLeft aria-hidden="true" className="size-3.5" /> : <ArrowUpRight aria-hidden="true" className="size-3.5" />}{t(type)}
  </span>;
}
function TypeTabs({ value, onChange }: { value: TypeFilter; onChange: (v: TypeFilter) => void }) {
  const { t } = useLanguage();
  return <div role="radiogroup" aria-label={t('Filter transaction type')} className="flex rounded-xl bg-base/50 p-1">
    {(['All', 'Income', 'Expense'] as const).map(v => <button key={v} type="button" role="radio" aria-checked={v === value} onClick={() => onChange(v)}
      className={`min-h-9 rounded-lg px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${v === value ? 'bg-surface font-medium text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>{t(v)}</button>)}
  </div>;
}
function TableSkeleton() {
  return <div aria-hidden="true" className="border-t border-line">
    <div className="hidden h-11 border-b border-line bg-base/50 md:block" />
    {Array.from({ length: 8 }, (_, i) => <div key={i} className="flex min-h-16 items-center gap-3 border-b border-line/70 px-4 py-2.5 md:px-5">
      <Skeleton className="size-9 shrink-0 !rounded-lg" />
      <span className="flex-1"><Skeleton className={`h-3 ${i % 3 ? 'w-32' : 'w-44'}`} /><Skeleton className="mt-2 h-2.5 w-24 md:hidden" /></span>
      <Skeleton className="hidden h-5 w-20 !rounded-full md:block" />
      <Skeleton className="hidden h-3 w-20 md:block" />
      <Skeleton className="h-3 w-20" />
      <div className="hidden w-[88px] md:block" />
    </div>)}
  </div>;
}
function EmptyState({ icon: Icon, title, text, action }: { icon: typeof Search; title: string; text: string; action?: ReactNode }) {
  return <div className="flex flex-col items-center border-t border-line px-6 py-14 text-center">
    <span className="flex size-11 items-center justify-center rounded-xl bg-brand/10 text-brand"><Icon aria-hidden="true" className="size-5" /></span>
    <p className="mt-4 text-[1rem] font-medium">{title}</p>
    <p className="mt-1.5 max-w-sm text-sm text-muted">{text}</p>
    {action && <div className="mt-5">{action}</div>}
  </div>;
}

/* ---------- Detail dialog ---------- */

function TransactionDetail({ transaction: tx, categories, rows, unusual, onClose, onEdit, onDelete, onAsk }: {
  transaction: Transaction; categories: Category[]; rows: Transaction[]; unusual?: UnusualExpense;
  onClose: () => void; onEdit: () => void; onDelete: () => void; onAsk: () => void;
}) {
  const { t, language, locale } = useLanguage();
  const same = rows.filter(r => r.category === tx.category && r.type === tx.type);
  const sameTotal = same.reduce((s, r) => s + r.amount, 0);
  const item = (label: string, value: ReactNode, wide = false) => <div className={wide ? 'col-span-2' : ''}><dt className="text-xs text-muted">{t(label)}</dt><dd className="mt-1 text-sm">{value}</dd></div>;
  return <Modal title={t('Transaction details')} onClose={onClose} footer={
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button secondary onClick={onDelete} className="!text-negative"><Trash2 aria-hidden="true" className="size-4" />{t('Delete')}</Button>
      <div className="flex flex-wrap items-center gap-2.5">
        <Button secondary onClick={onAsk}><Sparkles aria-hidden="true" className="size-4 text-ai" />{t('Ask AI')}</Button>
        <Button onClick={onEdit}><Pencil aria-hidden="true" className="size-4" />{t('Edit')}</Button>
      </div>
    </div>
  }>
    <div className="flex items-center gap-3">
      <CategoryIcon name={tx.category} icon={categories.find(c => c.name === tx.category)?.icon} />
      <div className="min-w-0"><p className="break-words text-[1rem] font-semibold">{tx.description}</p><TypeLabel type={tx.type} /></div>
    </div>
    <p className={`mt-4 text-3xl font-semibold tracking-tight tabular-nums ${amountTone(tx.type)}`}>{signed(tx)}</p>
    <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border border-line bg-base/30 p-4">
      {item('Category', categoryLabel(tx.category, language))}
      {item('Account', accountLabel(tx.account, language))}
      {item('Date', new Date(tx.date + 'T12:00:00').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), true)}
      {tx.notes && item('Notes', <span className="whitespace-pre-line break-words">{tx.notes}</span>, true)}
    </dl>
    {unusual && <p className="mt-4 flex gap-2.5 rounded-xl border border-alert/30 bg-alert/10 p-3.5 text-sm leading-6">
      <AlertTriangle aria-hidden="true" className="mt-1 size-4 shrink-0 text-alert" />
      <span>{t('{times}× your usual {category} expense (median of the previous {count} expenses in this category).', { times: (tx.amount / unusual.usual).toFixed(1), category: categoryLabel(tx.category, language), count: unusual.count })}</span>
    </p>}
    {same.length > 1 && <p className="mt-4 text-sm text-muted">{t('{category} this period: {count} transactions, {amount} in total.', { category: categoryLabel(tx.category, language), count: same.length, amount: money(sameTotal) })}</p>}
  </Modal>;
}
