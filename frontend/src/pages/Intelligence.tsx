import { lazy, Suspense, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, ArrowUp, CircleAlert, Clock, Lightbulb, MessageCircleQuestion, Plus, Sparkles, TriangleAlert, TrendingUp, type LucideIcon } from 'lucide-react';
import { useLanguage } from '../i18n';
import { type Budget, type Category, type Page, type Transaction, money, dateLabel, today } from '../data';
import { Button, Card, Change } from '../components/ui';
import { LoadingStatus, Skeleton, SkeletonText, useFadeIn } from '../components/Skeleton';
import { analyse, MIN_TRANSACTIONS, type Insight, type InsightAction, type Severity, type Text } from '../lib/insights';
import { percentChange } from '../lib/totals';
import { monthlyData } from '../lib/chartData';
import { WeeklySummary } from '../components/ambient-ai/WeeklySummary';

// recharts only loads with this page's charts, and only when there is data to draw.
const loadCharts = () => import('../components/charts');
const TrendChart = lazy(() => loadCharts().then(m => ({ default: m.TrendChart })));
const ExpenseDonut = lazy(() => loadCharts().then(m => ({ default: m.ExpenseDonut })));

const SEVERITY: Record<Severity, { label: string; icon: LucideIcon; tone: string }> = {
  alert: { label: 'Warning', icon: TriangleAlert, tone: 'text-alert bg-alert/10' },
  caution: { label: 'Attention', icon: CircleAlert, tone: 'text-caution bg-caution/10' },
  opportunity: { label: 'Opportunity', icon: Lightbulb, tone: 'text-brand bg-brand/10' },
  trend: { label: 'Trend', icon: TrendingUp, tone: 'text-chart-tertiary bg-chart-tertiary/10' },
};
const STATUS = {
  action: { label: 'Needs action', tone: 'text-alert bg-alert/10 ring-alert/25' },
  watch: { label: 'Worth a look', tone: 'text-caution bg-caution/10 ring-caution/25' },
  ok: { label: 'Steady', tone: 'text-brand bg-brand/10 ring-brand/25' },
} as const;
const SUGGESTED = [
  'Where did I spend the most this month?',
  'Forecast my balance at the end of the month.',
  'How can I save more?',
  'Help me make a savings plan.',
];
/** Findings shown before "Show more". */
const FIRST_FINDINGS = 5;

/**
 * Smart Insights: a briefing of the selected period, the findings that need attention (each with its evidence, cause,
 * impact and a link to act on it), the trend charts that have data, and a way to ask the AI assistant.
 * Findings come from rules over the user's own data (lib/insights.ts); the AI assistant is the only generative part.
 */
export function Insights({ rows, allRows, previous, budgets, categories, range, loading = false, failed = false, updatedAt, onNavigate, onViewTransactions, onEditTransaction, onCreateBudget, onAsk }: {
  rows: Transaction[]; allRows: Transaction[]; previous: Transaction[]; budgets: Budget[]; categories: Category[];
  range: { start: string; end: string };
  loading?: boolean; failed?: boolean; updatedAt?: Date | null;
  onNavigate: (page: Page) => void;
  onViewTransactions: (search: string) => void;
  onEditTransaction: (transaction: Transaction) => void;
  onCreateBudget: (category: string) => void;
  onAsk: (question?: string) => void;
}) {
  const { t, locale } = useLanguage();
  const fade = useFadeIn(loading);
  const [showAll, setShowAll] = useState(false);
  const say = (text: Text) => t(text.key, text.values);
  const date = (iso: string) => dateLabel(iso, locale);
  const a = analyse({ rows, previous, allRows, budgets, range, today, fmt: { money, date } });
  const act = (to: InsightAction) => {
    if (to.kind === 'transactions') onViewTransactions(to.search);
    else if (to.kind === 'edit') onEditTransaction(to.transaction);
    else if (to.kind === 'budgets') onNavigate('Budgets');
    else if (to.kind === 'create-budget') onCreateBudget(to.category);
    else onNavigate(to.page);
  };

  if (loading) return <div className="space-y-6"><LoadingStatus label={t('Loading your data...')} /><BriefingSkeleton />{[0, 1, 2].map(i => <InsightSkeleton key={i} />)}</div>;
  const shown = showAll ? a.insights : a.insights.slice(0, FIRST_FINDINGS);
  const updated = updatedAt ? updatedAt.toLocaleString(locale, updatedAt.toDateString() === new Date().toDateString()
    ? { hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : null;

  return <div className={`space-y-6 ${fade}`}>
    {/* A. Financial briefing */}
    {failed && !rows.length
      ? <Card className="p-6"><p className="font-medium">{t('Your data could not be loaded')}</p><p className="mt-1 text-sm text-muted">{t('Use “Try again” above. Nothing is analysed until your data loads.')}</p></Card>
      : !a.enough
        ? <Card className="p-6 sm:p-8">
          <span aria-hidden="true" className="mb-4 flex size-11 items-center justify-center rounded-xl bg-brand/10 text-brand"><Sparkles className="size-5" /></span>
          <h2 className="text-lg font-semibold tracking-tight">{t('Not enough data for an analysis yet')}</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted">{t('Add at least {count} transactions in this period to see your briefing and findings. Findings only appear when your own data supports them.', { count: MIN_TRANSACTIONS })}</p>
          <div className="mt-5"><Button onClick={() => onNavigate('Transactions')}><Plus className="size-4" aria-hidden="true" />{t('Add a transaction')}</Button></div>
        </Card>
        : <Card className="relative overflow-hidden p-5 sm:p-7">
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{t('Financial briefing')}</p>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              <span className={`rounded-full px-2.5 py-1 font-semibold ring-1 ${STATUS[a.status].tone}`}>{t(STATUS[a.status].label)}</span>
              {updated && <span className="flex items-center gap-1.5"><Clock className="size-3.5" aria-hidden="true" />{t('Updated {time}', { time: updated })}</span>}
            </div>
          </div>
          <h2 className="mt-4 text-[22px] font-semibold leading-tight tracking-[-0.03em] sm:text-[26px]">{say(a.headline)}</h2>
          <dl className="mt-6 grid gap-3 sm:grid-cols-3">
            <Stat label="Income" value={money(a.totals.income)} change={a.hasPrevious ? percentChange(a.totals.income, a.previous.income) : null} />
            <Stat label="Expenses" value={money(a.totals.expense)} change={a.hasPrevious ? percentChange(a.totals.expense, a.previous.expense) : null} inverse />
            <Stat label="Amount saved" value={money(a.totals.savings)} note={a.totals.income > 0 ? t('{rate} of income', { rate: `${Math.round(a.totals.rate)}%` }) : undefined}
              change={a.hasPrevious && a.previous.savings ? percentChange(a.totals.savings, a.previous.savings) : null} />
          </dl>
          {!a.hasPrevious && <p className="mt-3 text-xs text-muted">{t('No data for the previous period to compare with.')}</p>}
          <div className="mt-6 border-t border-line pt-5">
            <p className="mb-2 text-sm font-medium">{t('Key points')}</p>
            {a.insights.length
              ? <ul className="space-y-1">{a.insights.slice(0, 3).map(i => { const { icon: Icon, tone } = SEVERITY[i.severity]; return <li key={i.id}>
                <a href={`#insight-${i.id}`} onClick={e => { e.preventDefault(); document.getElementById(`insight-${i.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); setShowAll(s => s || a.insights.indexOf(i) >= FIRST_FINDINGS); }}
                  className="group flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm hover:bg-line/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                  <span aria-hidden="true" className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${tone}`}><Icon className="size-3.5" /></span>
                  <span className="min-w-0 flex-1">{say(i.title)}</span>
                  <ArrowRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </a></li>; })}</ul>
              : <p className="text-sm text-muted">{t('No issues found in this period: no budget over its limit, no unusual expense and no spending above income.')}</p>}
          </div>
        </Card>}

    {/* B. Priority findings */}
    {a.enough && a.insights.length > 0 && <section aria-labelledby="insights-priority" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <div><h2 id="insights-priority" className="text-[1rem] font-semibold tracking-tight">{t('Priority findings')}</h2>
          <p className="mt-1 text-sm text-muted">{t('Worked out from your transactions and budgets in this period, most important first.')}</p></div>
        <span className="text-xs text-muted">{t('{count} findings', { count: a.insights.length })}</span>
      </div>
      {shown.map(i => <InsightCard key={i.id} insight={i} say={say} onAction={() => act(i.action.to)} onAsk={() => onAsk(say(i.ask))} />)}
      {a.insights.length > FIRST_FINDINGS && !showAll && <button type="button" onClick={() => setShowAll(true)} className="mx-auto flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-brand hover:underline focus-visible:ring-2 focus-visible:ring-brand">{t('Show {count} more', { count: a.insights.length - FIRST_FINDINGS })}</button>}
    </section>}

    {/* C. Trends */}
    {a.enough && <Trends allRows={allRows} rows={rows} categories={categories} end={range.end} />}

    {/* Last week, written by the AI from the user's numbers (generated server-side every Monday). */}
    <WeeklySummary />

    {/* D. Ask the AI assistant */}
    <AskAI onAsk={onAsk} />
  </div>;
}

function Stat({ label, value, change, inverse = false, note }: { label: string; value: string; change: number | null; inverse?: boolean; note?: string }) {
  const { t } = useLanguage();
  return <div className="rounded-xl border border-line bg-base/30 px-4 py-3.5">
    <dt className="text-xs text-muted">{t(label)}</dt>
    <dd className="mt-1.5 text-lg font-semibold tabular-nums tracking-tight">{value}</dd>
    <dd className="mt-1 flex min-h-4 flex-wrap items-center gap-x-2 text-xs text-muted">{change !== null && (Math.abs(change) < 0.05 ? <span>{t('Unchanged from previous period')}</span> : <><Change value={change} inverse={inverse} /><span>{t('vs. previous period')}</span></>)}{note && <span>{note}</span>}</dd>
  </div>;
}

function InsightCard({ insight: i, say, onAction, onAsk }: { insight: Insight; say: (text: Text) => string; onAction: () => void; onAsk: () => void }) {
  const { t } = useLanguage();
  const { label, icon: Icon, tone } = SEVERITY[i.severity];
  return <Card className="scroll-mt-24 p-5" >
    <article id={`insight-${i.id}`} aria-labelledby={`insight-${i.id}-title`}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${tone}`}><Icon className="size-[18px]" /></span>
        <div className="min-w-0 flex-1">
          <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tone}`}>{t(label)}</span>
          <h3 id={`insight-${i.id}-title`} className="mt-1.5 text-[1rem] font-semibold leading-snug">{say(i.title)}</h3>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-line bg-base/30 px-4 py-3 sm:grid-cols-3">
        {i.evidence.map(e => <div key={e.label} className="min-w-0"><dt className="text-xs text-muted">{t(e.label)}</dt><dd className="mt-0.5 truncate text-sm font-semibold tabular-nums">{e.value}</dd></div>)}
      </dl>
      <div className="mt-4 grid gap-4 text-sm leading-6 md:grid-cols-2">
        <Detail label="Why">{say(i.why)}</Detail>
        <Detail label="Impact">{say(i.impact)}</Detail>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Button secondary onClick={onAction}>{t(i.action.label)}<ArrowRight className="size-4" aria-hidden="true" /></Button>
        <button type="button" onClick={onAsk} className="flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-ai hover:bg-ai-from/10 focus-visible:ring-2 focus-visible:ring-ai-from"><Sparkles className="size-4" aria-hidden="true" />{t('Ask AI about this')}</button>
      </div>
    </article>
  </Card>;
}
function Detail({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useLanguage();
  return <div><p className="text-xs font-medium uppercase tracking-wide text-muted">{t(label)}</p><p className="mt-1 text-ink">{children}</p></div>;
}

/** Only the charts that have data: two or more months for the monthly charts, spending for the breakdown. */
function Trends({ allRows, rows, categories, end }: { allRows: Transaction[]; rows: Transaction[]; categories: Category[]; end: string }) {
  const { t } = useLanguage();
  const months = monthlyData(allRows, new Date(end + 'T12:00:00'));
  const activeMonths = months.filter(m => m.income || m.expense).length;
  const spending = rows.some(r => r.type === 'Expense');
  if (activeMonths < 2 && !spending) return null;
  const slot = (height: number) => <Skeleton className="w-full !rounded-xl" style={{ height }} />;
  return <section aria-labelledby="insights-trends" className="space-y-3">
    <div className="px-1"><h2 id="insights-trends" className="text-[1rem] font-semibold tracking-tight">{t('Financial trends')}</h2>
      <p className="mt-1 text-sm text-muted">{t('Only charts with data in your account are shown.')}</p></div>
    <div className="grid gap-4 lg:grid-cols-2">
      {activeMonths >= 2 && <Card className="p-5"><h3 className="text-sm font-semibold">{t('Income and expenses by month')}</h3>
        <div className="mb-3 mt-1 flex gap-4 text-xs text-muted"><span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-positive" />{t('Income')}</span><span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-negative" />{t('Expenses')}</span></div>
        <Suspense fallback={slot(225)}><TrendChart data={months} /></Suspense></Card>}
      {spending && <Card className="p-5"><h3 className="mb-3 text-sm font-semibold">{t('Spending by category')}</h3>
        <Suspense fallback={slot(210)}><ExpenseDonut transactions={rows} categories={categories} /></Suspense></Card>}
      {activeMonths >= 2 && <Card className="p-5 lg:col-span-2"><h3 className="text-sm font-semibold">{t('Savings by month')}</h3>
        <p className="mb-3 mt-1 text-xs text-muted">{t('Income minus expenses for each month.')}</p>
        <Suspense fallback={slot(225)}><TrendChart data={months} line /></Suspense></Card>}
    </div>
  </section>;
}

function AskAI({ onAsk }: { onAsk: (question?: string) => void }) {
  const { t } = useLanguage();
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); const q = text.trim(); if (q) { onAsk(q); setText(''); } };
  return <Card className="p-5 sm:p-6">
    <section aria-labelledby="insights-ask">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-ai-from via-ai-to to-ai-warm text-on-ai"><MessageCircleQuestion className="size-5" /></span>
        <div><h2 id="insights-ask" className="text-[1rem] font-semibold tracking-tight">{t('Ask MoneyMind AI')}</h2>
          <p className="mt-1 text-sm text-muted">{t('Answers use your accounts, transactions and budgets. Not financial advice.')}</p></div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">{SUGGESTED.map(q => <button key={q} type="button" onClick={() => onAsk(t(q))}
        className="min-h-11 rounded-xl border border-line bg-base/30 px-3.5 text-left text-sm text-muted transition-colors hover:border-ai-to/40 hover:text-ink focus-visible:ring-2 focus-visible:ring-ai-from">{t(q)}</button>)}</div>
      <form onSubmit={submit} className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-base/30 py-1.5 pl-4 pr-1.5 focus-within:border-ai-to/50 focus-within:ring-2 focus-within:ring-ai-to/15">
        <input value={text} onChange={e => setText(e.target.value)} maxLength={1500} aria-label={t('Ask your financial assistant')} placeholder={t('Ask anything about your money...')}
          className="min-h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted" />
        <button type="submit" disabled={!text.trim()} aria-label={t('Send message')} className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-ai-from via-ai-to to-ai-warm text-on-ai disabled:cursor-not-allowed disabled:bg-none disabled:bg-ink/10 disabled:text-ink/50 focus-visible:ring-2 focus-visible:ring-ai-from"><ArrowUp className="size-4" aria-hidden="true" /></button>
      </form>
    </section>
  </Card>;
}

function BriefingSkeleton() {
  return <Card className="p-5 sm:p-7"><div aria-hidden="true">
    <div className="flex justify-between"><SkeletonText className="h-4" bar="h-2.5" width="w-32" /><Skeleton className="h-6 w-24 !rounded-full" /></div>
    <SkeletonText className="mt-4 h-8" bar="h-6" width="w-3/4" />
    <div className="mt-6 grid gap-3 sm:grid-cols-3">{[0, 1, 2].map(i => <div key={i} className="rounded-xl border border-line px-4 py-3.5"><SkeletonText className="h-4" bar="h-2.5" width="w-16" /><SkeletonText className="mt-1.5 h-7" bar="h-5" width="w-28" /><SkeletonText className="mt-1 h-4" bar="h-2.5" width="w-24" /></div>)}</div>
    <div className="mt-6 space-y-2 border-t border-line pt-5">{[0, 1, 2].map(i => <SkeletonText key={i} className="h-11" width={i === 1 ? 'w-2/3' : 'w-1/2'} />)}</div>
  </div></Card>;
}
function InsightSkeleton() {
  return <Card className="p-5"><div aria-hidden="true">
    <div className="flex gap-3"><Skeleton className="size-10 shrink-0 !rounded-xl" /><div className="flex-1"><Skeleton className="h-5 w-20" /><SkeletonText className="mt-1.5 h-6" bar="h-4" width="w-2/3" /></div></div>
    <Skeleton className="mt-4 h-[66px] w-full !rounded-xl" />
    <div className="mt-4 grid gap-4 md:grid-cols-2"><div><SkeletonText className="h-4" bar="h-2.5" width="w-12" /><Skeleton className="mt-2 h-3 w-full" /><Skeleton className="mt-2 h-3 w-4/5" /></div><div><SkeletonText className="h-4" bar="h-2.5" width="w-16" /><Skeleton className="mt-2 h-3 w-full" /></div></div>
    <div className="mt-4 flex gap-2 border-t border-line pt-4"><Skeleton className="h-11 w-40 !rounded-full" /><Skeleton className="h-11 w-32 !rounded-xl" /></div>
  </div></Card>;
}
