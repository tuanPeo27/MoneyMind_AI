import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  Sparkles, Plus, Pencil, Trash2, Wallet, Receipt, PiggyBank, TrendingUp, AlertTriangle, Lightbulb, ArrowRight,
  RotateCw, CircleCheck,
} from 'lucide-react';
import { useLanguage } from '../i18n';
import { type Transaction, type Category, type Budget, money, dateLabel, today as todayIso, localDate } from '../data';
import { Button, Card, IconButton } from '../components/ui';
import { CategoryIcon } from '../components/CategoryIcon';
import { Pagination, usePagination } from '../components/Pagination';
import { LoadingStatus, Skeleton, SkeletonText, useFadeIn } from '../components/Skeleton';
import { categoryLabel } from '../i18n/labels';
import { usedPercent } from '../lib/totals';
import { analyse, type Text } from '../lib/insights';
import { budgetTrend, summarizeBudgets, MIN_ELAPSED_FOR_FORECAST, type BudgetLine, type BudgetStatus, type BudgetSummary } from '../lib/budgets';

// recharts only loads with the charts, after the page itself has drawn.
const loadCharts = () => import('../components/charts');
const BudgetTrendChart = lazy(() => loadCharts().then(m => ({ default: m.BudgetTrendChart })));
const ExpenseDonut = lazy(() => loadCharts().then(m => ({ default: m.ExpenseDonut })));
const CHART_HEIGHT = 220;

export type BudgetsProps = {
  budgets: Budget[];
  /** Transactions in the selected period (spending against each budget). */
  rows: Transaction[];
  /** Every loaded transaction (the weekly trend can reach back before the period starts). */
  allRows: Transaction[];
  previous: Transaction[];
  categories: Category[];
  range: { start: string; end: string };
  loading?: boolean;
  failed?: boolean;
  onRetry: () => void;
  onAdd: () => void;
  onEdit: (b: Budget) => void;
  onDelete: (b: Budget) => void;
  onCreateBudget: (category: string) => void;
  onViewTransactions: (category: string) => void;
  onOpenInsights: () => void;
  onAsk: (question: string) => void;
};

const STATUS: Record<BudgetStatus, { label: string; text: string; chip: string; bar: string }> = {
  ok: { label: 'On track', text: 'text-positive', chip: 'bg-positive/10 text-positive', bar: 'var(--color-positive)' },
  watch: { label: 'Needs attention', text: 'text-caution', chip: 'bg-caution/12 text-caution', bar: 'var(--color-caution)' },
  near: { label: 'Close to the limit', text: 'text-alert', chip: 'bg-alert/12 text-alert', bar: 'var(--color-alert)' },
  over: { label: 'Over budget', text: 'text-negative', chip: 'bg-negative/10 text-negative', bar: 'var(--color-negative)' },
};
const pct = (n: number) => `${Math.round(n)}%`;
const slug = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'category';
const hover = 'transition-[transform,box-shadow] duration-200 ease-out motion-safe:hover:-translate-y-0.5 hover:shadow-lg hover:shadow-accent/10';

export function Budgets(props: BudgetsProps) {
  const { budgets, rows, allRows, previous, categories, range, loading = false, failed = false, onRetry, onAdd, onEdit, onDelete, onCreateBudget, onViewTransactions, onOpenInsights, onAsk } = props;
  const { t, locale } = useLanguage();
  const summary = useMemo(() => summarizeBudgets(budgets, rows, range, todayIso), [budgets, rows, range]);
  const [trendMode, setTrendMode] = useState<'month' | 'week'>('month');
  const [focused, setFocused] = useState<string>();
  const pager = usePagination(summary.lines, 6, `${budgets.length}|${range.start}|${range.end}`);
  const hasBudgets = budgets.length > 0;

  // Rule-based findings shared with Smart Insights: only the "largest category without a budget" one is used here.
  const date = (iso: string) => dateLabel(iso, locale);
  const uncapped = useMemo(() => analyse({ rows, previous, allRows, budgets, range, today: todayIso, fmt: { money, date } })
    .insights.find(i => i.id.startsWith('uncapped-')), [rows, previous, allRows, budgets, range]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Jump to a category's budget card (on whichever page of the grid it is) and briefly highlight it. */
  const focusCategory = (name: string) => {
    const index = summary.lines.findIndex(l => l.budget.category === name);
    if (index < 0) return;
    pager.setPage(Math.floor(index / pager.size) + 1);
    setFocused(name);
    requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(`budget-${slug(name)}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })));
  };
  useEffect(() => {
    if (!focused) return;
    const id = setTimeout(() => setFocused(undefined), 1800);
    return () => clearTimeout(id);
  }, [focused]);
  const showForecast = () => { setTrendMode('month'); document.getElementById('budget-trend')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); };

  if (failed && !hasBudgets && !rows.length) return <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
    <div><h2 className="text-[1rem] font-semibold">{t('Could not load your budgets')}</h2><p className="mt-1 text-sm text-muted">{t('Check your connection, then try again. Nothing was changed.')}</p></div>
    <Button secondary onClick={onRetry}><RotateCw className="size-4" aria-hidden="true" />{t('Try again')}</Button>
  </Card>;

  return <div className="space-y-5">
    {loading && <LoadingStatus label={t('Loading your data...')} />}
    {loading ? <InsightSkeleton /> : hasBudgets && <AIInsight summary={summary} range={range} onDetails={onOpenInsights} onAsk={() => onAsk(t('Analyse my budget this month.'))} />}
    <Kpis summary={summary} loading={loading} hasBudgets={hasBudgets} range={range} />

    {!loading && !hasBudgets
      ? <Card className="flex flex-col items-center px-6 py-12 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-brand/10 text-brand"><PiggyBank aria-hidden="true" className="size-6" /></span>
        <h2 className="mt-4 text-lg font-semibold tracking-tight">{t('Start budgeting')}</h2>
        <p className="mt-1.5 max-w-md text-sm text-muted">{t('Create category budgets to keep your spending under control.')}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button onClick={onAdd}><Plus aria-hidden="true" className="size-4" />{t('Create your first budget')}</Button>
          <Button secondary onClick={() => onAsk(t('Suggest monthly budgets for my spending categories.'))}><Sparkles aria-hidden="true" className="size-4 text-ai" />{t('Ask AI to suggest budgets')}</Button>
        </div>
      </Card>
      : <>
        <div className="grid gap-4 lg:grid-cols-2">
          <TrendCard summary={summary} allRows={allRows} range={range} mode={trendMode} setMode={setTrendMode} loading={loading} />
          <AllocationCard summary={summary} rows={rows} categories={categories} loading={loading} onSelect={focusCategory} />
        </div>
        {!loading && <Recommendations summary={summary} range={range} uncapped={uncapped ? { title: uncapped.title, category: uncapped.action.to.kind === 'create-budget' ? uncapped.action.to.category : '' } : undefined}
          onView={onViewTransactions} onCreate={onCreateBudget} onForecast={showForecast} />}
        <section aria-labelledby="budget-categories" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="budget-categories" className="text-[1rem] font-semibold tracking-[-0.02em]">{t('Budgets by category')}</h2>
              {loading ? <SkeletonText className="mt-1 h-5" bar="h-3" width="w-40" /> : <p className="mt-1 text-sm text-muted">{t('{count} budgets · sorted by what needs attention first', { count: budgets.length })}</p>}
            </div>
            <Button onClick={onAdd}><Plus aria-hidden="true" className="size-4" />{t('Add budget')}</Button>
          </div>
          {loading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map(i => <BudgetSkeleton key={i} />)}</div>
            : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{pager.items.map(line => <BudgetCard key={line.budget.id} line={line} categories={categories}
              highlighted={focused === line.budget.category} onEdit={() => onEdit(line.budget)} onDelete={() => onDelete(line.budget)} />)}</div>}
          {!loading && <Pagination pager={pager} sizes={[6, 12, 24]} className="glass rounded-2xl" />}
        </section>
      </>}
    <p className="text-xs text-muted">{t('Spending is calculated from transactions in your selected period. Budget limits apply to that period.')}</p>
  </div>;
}

/* ---------- B. MoneyMind AI insight ---------- */

function headline(s: BudgetSummary): { text: Text; tone: BudgetStatus } {
  const over = s.lines.filter(l => l.status === 'over'), attention = s.lines.filter(l => l.status === 'near' || l.status === 'watch');
  if (over.length === 1) return { text: { key: '{category} is over its budget', values: { category: over[0].budget.category } }, tone: 'over' };
  if (over.length > 1) return { text: { key: '{count} budgets are over their limit', values: { count: over.length } }, tone: 'over' };
  if (s.forecast === 'projected' && s.projected! > s.limit) return { text: { key: 'At this pace you will go over your total budget' }, tone: 'near' };
  if (attention.length === 1) return { text: { key: '{category} needs attention', values: { category: attention[0].budget.category } }, tone: attention[0].status };
  if (attention.length > 1) return { text: { key: '{count} budgets need attention', values: { count: attention.length } }, tone: 'watch' };
  return { text: { key: 'Your budget is under control' }, tone: 'ok' };
}
function forecastSentence(s: BudgetSummary, range: { start: string; end: string }, locale: string): Text {
  const end = dateLabel(range.end, locale);
  if (s.forecast === 'projected') return s.projected! <= s.limit
    ? { key: 'At your current pace you will spend about {projected} by {date}, {amount} under the limit.', values: { projected: money(s.projected!), date: end, amount: money(s.limit - s.projected!) } }
    : { key: 'At your current pace you will spend about {projected} by {date}, {amount} over the limit.', values: { projected: money(s.projected!), date: end, amount: money(s.projected! - s.limit) } };
  if (s.forecast === 'ended') return { key: 'This period has ended.' };
  if (s.forecast === 'future') return { key: 'This period has not started yet.' };
  return { key: 'A forecast appears once a quarter of the period has passed.' };
}
function AIInsight({ summary: s, range, onDetails, onAsk }: { summary: BudgetSummary; range: { start: string; end: string }; onDetails: () => void; onAsk: () => void }) {
  const { t, locale } = useLanguage();
  const { text, tone } = headline(s);
  const say = (x: Text) => t(x.key, x.values);
  const barColor = s.spent > s.limit ? 'var(--color-negative)' : s.forecast === 'projected' && s.projected! > s.limit ? 'var(--color-alert)' : undefined;
  const marker = s.forecast === 'projected' || s.forecast === 'early' ? s.elapsed! * 100 : null;
  return <Card className="relative overflow-hidden !border-accent/35 p-5 sm:p-6">
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent/[0.18] via-accent-2/[0.08] to-transparent" />
    <div className="relative">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
          <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-ai-from via-ai-to to-ai-warm text-on-ai shadow-[0_0_18px_-4px_var(--color-ai-to)]"><Sparkles aria-hidden="true" className="size-3.5" /></span>
          {t('MoneyMind AI insight')}
        </span>
        {/* Same overall status words as Smart Insights; the headline already names the category. */}
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS[tone].chip}`}>{t(tone === 'over' ? 'Needs action' : tone === 'ok' ? 'Steady' : 'Worth a look')}</span>
      </div>
      <h2 className="mt-3 text-xl font-semibold tracking-tight sm:text-[22px]">{say(text)}</h2>
      <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted">{t('You have used {used} of your total budget.', { used: usedPercent(s.used) })} {say(forecastSentence(s, range, locale))}</p>

      <div className="mt-4">
        <AnimatedBar value={s.used} color={barColor} label={t('Total budget used')} marker={marker} />
        {marker !== null && <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted"><span aria-hidden="true" className="h-3 w-0.5 rounded-full bg-ink/70" />{t('{elapsed} of the period has passed', { elapsed: pct(marker) })}</p>}
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <dl className="grid flex-1 grid-cols-2 gap-3 sm:max-w-xl sm:grid-cols-3">
          <Metric label="Budget used" value={usedPercent(s.used)} />
          <Metric label={s.left >= 0 ? 'Left' : 'Over by'} value={money(Math.abs(s.left))} tone={s.left < 0 ? 'text-negative' : ''} />
          <Metric label={s.forecast === 'ended' ? 'Actual spending' : 'End-of-period forecast'} value={s.projected !== null ? money(s.projected) : '—'} tone={s.projected !== null && s.projected > s.limit ? 'text-alert' : ''} />
        </dl>
        <div className="flex flex-wrap gap-2.5">
          <Button secondary onClick={onDetails}>{t('Detailed analysis')}<ArrowRight aria-hidden="true" className="size-4" /></Button>
          <Button onClick={onAsk}><Sparkles aria-hidden="true" className="size-4" />{t('Ask AI')}</Button>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-muted">{t('Worked out from your budgets and transactions. The assistant answers follow-up questions.')}</p>
    </div>
  </Card>;
}
function Metric({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  const { t } = useLanguage();
  return <div className="min-w-0"><dt className="truncate text-xs text-muted">{t(label)}</dt><dd className={`mt-1 truncate text-[15px] font-semibold tabular-nums sm:text-[1rem] ${tone}`}>{value}</dd></div>; // not text-base: that is the background colour token
}
/** A progress bar that fills from 0 when it first appears (and follows later changes); optional pace marker. */
function AnimatedBar({ value, color, label, marker = null, thin = false }: { value: number; color?: string; label: string; marker?: number | null; thin?: boolean }) {
  const { t } = useLanguage();
  const [shown, setShown] = useState(0);
  useEffect(() => { const id = requestAnimationFrame(() => setShown(value)); return () => cancelAnimationFrame(id); }, [value]);
  const width = Number.isFinite(shown) ? Math.min(100, Math.max(0, shown)) : 100;
  return <div className="relative">
    <div role="progressbar" aria-label={label} aria-valuenow={Number.isFinite(value) ? Math.round(value) : 100} aria-valuemin={0} aria-valuemax={100}
      className={`overflow-hidden rounded-full bg-line ${thin ? 'h-1.5' : 'h-2'}`}>
      <div className={`h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none ${color ? '' : 'bg-gradient-to-r from-accent to-accent-2'}`} style={{ width: `${width}%`, ...(color ? { backgroundColor: color } : {}) }} />
    </div>
    {marker !== null && <span title={t('Where spending would be at an even pace')} aria-hidden="true" className="absolute -top-1 h-4 w-0.5 rounded-full bg-ink/70" style={{ left: `calc(${Math.min(100, marker)}% - 1px)` }} />}
  </div>;
}

/* ---------- C. Overview cards ---------- */

function Kpis({ summary: s, loading, hasBudgets, range }: { summary: BudgetSummary; loading: boolean; hasBudgets: boolean; range: { start: string; end: string } }) {
  const { t, locale } = useLanguage();
  const share = (n: number) => s.limit > 0 ? t('{percent} of total budget', { percent: usedPercent(n / s.limit * 100) }) : '';
  // First day on which a forecast can be shown (a quarter of the period has passed).
  const from = new Date(range.start + 'T12:00:00'); from.setDate(from.getDate() + Math.ceil(s.days * MIN_ELAPSED_FOR_FORECAST) - 1);
  const forecast = !hasBudgets ? { value: '—', note: t('Add a budget to see a forecast'), tone: '' }
    : s.forecast === 'projected' ? { value: money(s.projected!), note: s.projected! <= s.limit ? t('Expected {amount} left', { amount: money(s.limit - s.projected!) }) : t('Expected {amount} over', { amount: money(s.projected! - s.limit) }), tone: s.projected! > s.limit ? 'text-alert' : '' }
      : s.forecast === 'ended' ? { value: money(s.spent), note: t('Period ended: actual spending'), tone: '' }
        : s.forecast === 'early' ? { value: '—', note: t('Available from {date}', { date: dateLabel(localDate(from), locale) }), tone: '' }
          : { value: '—', note: t('This period has not started yet.'), tone: '' };
  return <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
    <Kpi icon={Wallet} label="Total budget" value={money(s.limit)} note={t('{count} budgets', { count: s.lines.length })} loading={loading} />
    <Kpi icon={Receipt} label="Used" value={money(s.spent)} note={share(s.spent) || t('No budget yet')} loading={loading} />
    <Kpi icon={PiggyBank} label="Left" value={s.left < 0 ? `−${money(-s.left)}` : money(s.left)} tone={s.left < 0 ? 'text-negative' : ''}
      note={s.left < 0 ? t('Over the total budget') : share(s.left) || t('No budget yet')} loading={loading} />
    <Kpi icon={TrendingUp} label="End-of-period forecast" value={forecast.value} tone={forecast.tone} note={forecast.note} loading={loading} />
  </div>;
}
function Kpi({ icon: Icon, label, value, note, tone = '', loading }: { icon: typeof Wallet; label: string; value: string; note: string; tone?: string; loading: boolean }) {
  const { t } = useLanguage();
  const fade = useFadeIn(loading);
  return <Card className={`p-4 sm:p-5 ${hover}`}>
    <div className="flex items-center gap-2 sm:gap-2.5"><span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand sm:size-8"><Icon aria-hidden="true" className="size-4" /></span><p className="truncate text-xs text-muted sm:text-sm">{t(label)}</p></div>
    {loading ? <><SkeletonText className="mt-3 h-7 sm:h-8" bar="h-5 sm:h-6" width="w-28 sm:w-32" /><SkeletonText className="mt-1 h-4" bar="h-2.5" width="w-24 sm:w-28" /></>
      : <div className={fade}><p className={`mt-3 truncate text-lg font-semibold tracking-tight tabular-nums sm:text-2xl ${tone}`}>{value}</p><p className="mt-1 min-h-4 truncate text-xs text-muted">{note}</p></div>}
  </Card>;
}

/* ---------- D. Analytics ---------- */

function TrendCard({ summary, allRows, range, mode, setMode, loading }: { summary: BudgetSummary; allRows: Transaction[]; range: { start: string; end: string }; mode: 'month' | 'week'; setMode: (m: 'month' | 'week') => void; loading: boolean }) {
  const { t, locale } = useLanguage();
  const names = useMemo(() => new Set(summary.lines.map(l => l.budget.category)), [summary]);
  const data = useMemo(() => budgetTrend(mode, summary, allRows, names, range, todayIso, locale), [mode, summary, allRows, names, range, locale]);
  const legend = mode === 'month'
    ? [['bg-brand', 'Spent so far'], ['bg-muted', 'Budget pace'], ...(summary.forecast === 'projected' ? [['bg-ai-to', 'Forecast']] : [])]
    : [['bg-brand', 'Spent'], ['bg-muted', 'Daily allowance']];
  return <Card className={`flex flex-col p-4 sm:p-5 ${hover}`}>
    <div id="budget-trend" className="mb-3 flex scroll-mt-24 flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-[1rem] font-semibold tracking-[-0.02em]">{t('Spending trend')}</h2>
        <p className="mt-1 text-xs text-muted">{t(mode === 'month' ? 'Running total in budgeted categories against an even pace to the limit.' : 'Each day against the daily allowance of your budgets.')}</p>
      </div>
      <div role="tablist" aria-label={t('Trend interval')} className="flex rounded-xl bg-base/50 p-1">
        {(['week', 'month'] as const).map(m => <button key={m} type="button" role="tab" aria-selected={m === mode} onClick={() => setMode(m)}
          className={`min-h-9 rounded-lg px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${m === mode ? 'bg-surface font-medium text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>{t(m === 'week' ? 'Week' : 'Month')}</button>)}
      </div>
    </div>
    <div className="relative flex-1" style={{ minHeight: CHART_HEIGHT }}><div className="absolute inset-0">
      {loading ? <Skeleton className="block size-full !rounded-xl" />
        : data ? <Suspense fallback={<Skeleton className="block size-full !rounded-xl" />}><BudgetTrendChart data={data} mode={mode} height="100%" /></Suspense>
          : <div className="flex size-full items-center justify-center rounded-xl border border-dashed border-line text-sm text-muted">{t('This period has not started yet.')}</div>}
    </div></div>
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-hidden="true">
      {legend.map(([color, label]) => <span key={label} className="inline-flex items-center gap-1.5"><span className={`h-0.5 w-3 rounded ${color}`} />{t(label)}</span>)}
    </div>
  </Card>;
}
function AllocationCard({ summary, rows, categories, loading, onSelect }: { summary: BudgetSummary; rows: Transaction[]; categories: Category[]; loading: boolean; onSelect: (name: string) => void }) {
  const { t } = useLanguage();
  const names = new Set(summary.lines.map(l => l.budget.category));
  const spending = rows.filter(r => r.type === 'Expense' && names.has(r.category));
  return <Card className={`flex flex-col p-4 sm:p-5 ${hover}`}>
    <h2 className="text-[1rem] font-semibold tracking-[-0.02em]">{t('Budget allocation')}</h2>
    <p className="mt-1 text-xs text-muted">{t('Share of spending by budgeted category. Pick one to see its budget.')}</p>
    <div className="flex flex-1 items-center py-3">
      {loading ? <div className="flex w-full items-center gap-5"><Skeleton className="size-[170px] shrink-0 !rounded-full" /><span className="flex-1 space-y-3">{[0, 1, 2].map(i => <SkeletonText key={i} className="h-5" bar="h-3" width="w-full" />)}</span></div>
        : <Suspense fallback={<Skeleton className="mx-auto size-[170px] !rounded-full" />}><ExpenseDonut transactions={spending} categories={categories.filter(c => names.has(c.name))} size={170} onSelect={onSelect} /></Suspense>}
    </div>
  </Card>;
}

/* ---------- E. Recommendations ---------- */

type Rec = { id: string; tone: 'alert' | 'caution' | 'opportunity' | 'forecast'; label: string; icon: typeof Lightbulb; title: string; body: string; cta: string; onClick: () => void };
function Recommendations({ summary: s, range, uncapped, onView, onCreate, onForecast }: {
  summary: BudgetSummary; range: { start: string; end: string }; uncapped?: { title: Text; category: string };
  onView: (category: string) => void; onCreate: (category: string) => void; onForecast: () => void;
}) {
  const { t, locale, language } = useLanguage();
  const others: Rec[] = [];
  if (uncapped?.category) others.push({
    id: 'uncapped', tone: 'opportunity', label: 'Savings opportunity', icon: Lightbulb, title: t(uncapped.title.key, uncapped.title.values),
    body: t('A limit lets the app warn you before spending gets there.'), cta: t('Create a budget'), onClick: () => onCreate(uncapped.category),
  });
  if (s.forecast === 'projected') others.push({
    id: 'forecast', tone: 'forecast', label: 'Forecast', icon: TrendingUp,
    title: t(s.projected! <= s.limit ? 'Spending should stay under the limit' : 'Spending is heading over the limit'),
    body: t(s.projected! <= s.limit ? 'About {projected} by {date}, {amount} below your total budget.' : 'About {projected} by {date}, {amount} above your total budget.',
      { projected: money(s.projected!), date: dateLabel(range.end, locale), amount: money(Math.abs(s.limit - s.projected!)) }),
    cta: t('See the forecast'), onClick: onForecast,
  });
  const attention: Rec[] = s.lines.filter(l => l.status !== 'ok').map(l => ({
    id: l.budget.id, tone: l.status === 'over' ? 'alert' : 'caution', label: l.status === 'over' ? 'Over budget' : 'Needs attention', icon: AlertTriangle,
    title: t(l.status === 'over' ? '{category} is over its budget' : 'Spending on {category} is running high', { category: categoryLabel(l.budget.category, language) }),
    body: l.status === 'over' ? t('{spent} spent of a {limit} limit, {amount} over.', { spent: money(l.spent), limit: money(l.budget.limit), amount: money(l.spent - l.budget.limit) })
      : t('{category} has used {percent} of its limit.', { category: categoryLabel(l.budget.category, language), percent: usedPercent(l.used) }),
    cta: t('See transactions'), onClick: () => onView(l.budget.category),
  }));
  const recs = [...attention.slice(0, Math.max(1, 3 - others.length)), ...others].slice(0, 3);
  if (!recs.length) return null;
  const tones: Record<Rec['tone'], string> = { alert: 'bg-negative/10 text-negative', caution: 'bg-caution/12 text-caution', opportunity: 'bg-brand/10 text-brand', forecast: 'bg-gradient-to-r from-ai-from via-ai-to to-ai-warm text-on-ai' };
  return <section aria-labelledby="budget-recs" className="space-y-3">
    <div className="flex items-center gap-2"><Sparkles aria-hidden="true" className="size-4 text-ai" /><h2 id="budget-recs" className="text-[1rem] font-semibold tracking-[-0.02em]">{t('Recommendations from MoneyMind AI')}</h2></div>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{recs.map(r => <Card key={r.id} className={`flex flex-col p-4 sm:p-5 ${hover}`}>
      <span className={`inline-flex items-center gap-1.5 self-start rounded-full px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider ${tones[r.tone]}`}><r.icon aria-hidden="true" className="size-3" />{t(r.label)}</span>
      <h3 className="mt-3 text-[15px] font-semibold leading-snug">{r.title}</h3>
      <p className="mt-1 flex-1 text-sm leading-6 text-muted">{r.body}</p>
      <button type="button" onClick={r.onClick} className="mt-3 inline-flex min-h-11 items-center gap-1.5 self-start rounded-lg text-sm font-medium text-brand transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:opacity-70">
        {r.cta}<ArrowRight aria-hidden="true" className="size-3.5" />
      </button>
    </Card>)}</div>
  </section>;
}

/* ---------- F. Budgets by category ---------- */

function BudgetCard({ line, categories, highlighted, onEdit, onDelete }: { line: BudgetLine; categories: Category[]; highlighted: boolean; onEdit: () => void; onDelete: () => void }) {
  const { t, language } = useLanguage();
  const { budget: b, spent, left, used, status } = line;
  const meta = STATUS[status];
  const name = categoryLabel(b.category, language);
  return <div id={`budget-${slug(b.category)}`} className={`scroll-mt-24 rounded-2xl transition-shadow duration-300 ${highlighted ? 'ring-2 ring-brand ring-offset-2 ring-offset-transparent' : ''}`}>
    <Card className={`h-full p-5 ${hover}`}>
      <div className="flex items-center gap-3">
        <CategoryIcon name={b.category} icon={categories.find(c => c.name === b.category)?.icon} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold">{name}</h3>
          <span className={`mt-0.5 inline-flex items-center gap-1 text-xs font-medium ${meta.text}`}>{status === 'ok' ? <CircleCheck aria-hidden="true" className="size-3.5" /> : <AlertTriangle aria-hidden="true" className="size-3.5" />}{t(meta.label)}</span>
        </div>
        <IconButton label={t('Edit budget {name}', { name })} icon={Pencil} onClick={onEdit} />
        <IconButton label={t('Delete budget {name}', { name })} icon={Trash2} onClick={onDelete} />
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2">
        <Figure label="Spent" value={money(spent)} />
        <Figure label="Budget" value={money(b.limit)} />
        <Figure label={left >= 0 ? 'Left' : 'Over by'} value={money(Math.abs(left))} tone={left < 0 ? 'text-negative' : ''} />
      </dl>
      <div className="mt-4 flex items-center gap-3">
        <div className="flex-1"><AnimatedBar value={used} color={meta.bar} label={t('{category} budget used', { category: name })} thin /></div>
        <span className={`w-12 shrink-0 text-right text-sm font-semibold tabular-nums ${meta.text}`}>{usedPercent(used)}</span>
      </div>
    </Card>
  </div>;
}
function Figure({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  const { t } = useLanguage();
  return <div className="min-w-0"><dt className="truncate text-xs text-muted">{t(label)}</dt><dd className={`mt-0.5 truncate text-sm font-semibold tabular-nums ${tone}`}>{value}</dd></div>;
}

/* ---------- Loading ---------- */

function InsightSkeleton() {
  return <Card className="p-5 sm:p-6"><div aria-hidden="true">
    <div className="flex justify-between"><SkeletonText className="h-7" bar="h-3" width="w-44" /><Skeleton className="h-6 w-24 !rounded-full" /></div>
    <SkeletonText className="mt-3 h-8" bar="h-5" width="w-80 max-w-full" /><SkeletonText className="mt-1.5 h-6" bar="h-3" width="w-[32rem] max-w-full" />
    <Skeleton className="mt-4 h-2 w-full !rounded-full" /><SkeletonText className="mt-1.5 h-4" bar="h-2.5" width="w-32" />
    <div className="mt-4 flex flex-wrap items-end justify-between gap-4"><div className="grid flex-1 grid-cols-2 gap-3 sm:max-w-xl sm:grid-cols-3">{[0, 1, 2].map(i => <span key={i}><SkeletonText className="h-4" bar="h-2.5" width="w-20" /><SkeletonText className="mt-1 h-6" bar="h-4" width="w-24" /></span>)}</div><Skeleton className="h-11 w-56 !rounded-full" /></div>
    <SkeletonText className="mt-3 h-4" bar="h-2" width="w-72 max-w-full" />
  </div></Card>;
}
function BudgetSkeleton() {
  return <Card className="p-5"><div aria-hidden="true">
    <div className="flex h-11 items-center gap-3"><Skeleton className="size-9 shrink-0 !rounded-lg" /><span className="flex-1"><SkeletonText className="h-5" bar="h-3.5" width="w-28" /><SkeletonText className="mt-0.5 h-4" bar="h-2.5" width="w-20" /></span></div>
    <div className="mt-4 grid grid-cols-3 gap-2">{[0, 1, 2].map(i => <span key={i}><SkeletonText className="h-4" bar="h-2.5" width="w-12" /><SkeletonText className="mt-0.5 h-5" bar="h-3" width="w-20" /></span>)}</div>
    <div className="mt-4 flex items-center gap-3"><Skeleton className="h-1.5 flex-1 !rounded-full" /><SkeletonText className="h-5 w-12" bar="h-3" width="w-9" /></div>
  </div></Card>;
}

