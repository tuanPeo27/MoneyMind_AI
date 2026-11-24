import { useLanguage } from '../i18n';
import { useState } from 'react';
import { Sparkles, Check, TrendingUp, TriangleAlert, Target, ArrowRight } from 'lucide-react';
import { type Transaction, type Budget, money } from '../data';
import { Badge, Card, Empty } from '../components/ui';
import { getTotals, percentChange } from '../lib/totals';
import { useLocal } from '../hooks/useLocal';
import { LoadingStatus, Skeleton, SkeletonText, useFadeIn } from '../components/Skeleton';

/** An insight card while loading: icon and badge, title, two text lines, the metric box, the action row. */
function InsightSkeleton() {
  return <Card className="p-6"><div aria-hidden="true">
    <div className="mb-5 flex items-center justify-between"><Skeleton className="size-10 !rounded-lg" /><Skeleton className="h-[22px] w-28 !rounded-full" /></div>
    <SkeletonText className="h-6" bar="h-3.5" width="w-48" />
    <div className="mt-2 min-h-[60px] space-y-2 pt-1"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-4/5" /></div>
    <div className="my-5 rounded-lg border border-line bg-base/40 px-4 py-4"><SkeletonText className="h-8" bar="h-6" width="w-32" /><SkeletonText className="mt-1 h-4" bar="h-2.5" width="w-36" /></div>
    <div className="flex justify-between border-t border-line pt-3"><SkeletonText className="h-11" width="w-32" /><SkeletonText className="h-11" bar="h-2.5" width="w-24" /></div>
  </div></Card>;
}

// Conversations now live in the global AmbientAIProvider; insights reuse the
// same personal records and navigation callbacks as the original workspace.
export function Insights({ rows, previous, budgets, onNavigate, loading = false }: {
  rows: Transaction[]; previous: Transaction[]; budgets: Budget[]; loading?: boolean;
  onNavigate: (page: 'Budgets' | 'AI Financial Assistant' | 'Transactions') => void;
}) {
  const { t } = useLanguage();
  const fade = useFadeIn(loading);
  const [reviewed, setReviewed] = useLocal<string[]>('mm-reviewed-insights-v1', []);
  const [filter, setFilter] = useState('All insights');
  const totals = getTotals(rows), past = getTotals(previous);
  const dining = rows.filter(t => t.category === 'Ăn uống' && t.type === 'Expense').reduce((s, t) => s + t.amount, 0);
  const largest = [...rows].filter(t => t.type === 'Expense').sort((a, b) => b.amount - a.amount)[0];
  const items = [
    {
      id: 'spend', title: 'Your spending, in perspective',
      text: t(totals.expense >= past.expense ? 'Expenses are {difference}% higher than the preceding period.' : 'Expenses are {difference}% lower than the preceding period.', { difference: Math.abs(percentChange(totals.expense, past.expense)).toFixed(1) }),
      metric: money(totals.expense), detail: 'total expenses', icon: TrendingUp,
      severity: 'Spending pattern', page: 'Transactions' as const, action: 'Review transactions',
    },
    {
      id: 'save', title: 'Small changes. Meaningful savings.',
      text: 'Reducing dining expenses by 10% could boost savings without a major lifestyle change.',
      metric: money(dining * 0.1), detail: 'potential savings per period', icon: Target,
      severity: 'Opportunity', page: 'AI Financial Assistant' as const, action: 'Explore savings',
    },
    {
      id: 'budget', title: 'Keep your budgets working for you',
      text: t('{count} category budgets. Review categories near their limits and align spending with your priorities.', { count: budgets.length }),
      metric: String(budgets.filter(b => rows.filter(t => t.category === b.category && t.type === 'Expense').reduce((s, t) => s + t.amount, 0) / b.limit >= 0.85).length),
      detail: 'budgets need attention', icon: TriangleAlert,
      severity: 'Budget recommendation', page: 'Budgets' as const, action: 'Review budgets',
    },
    {
      id: 'large', title: 'A large expense worth checking',
      text: largest ? t('“{name}” is your largest expense. Confirm that it is expected and correctly categorized.', { name: largest.description }) : 'No expense transactions were found in this period.',
      metric: money(largest?.amount || 0), detail: 'largest expense this period', icon: TriangleAlert,
      severity: 'Expense alert', page: 'Transactions' as const, action: 'Check transactions',
    },
    {
      id: 'rate', title: 'Build a stronger savings habit',
      text: 'Consider automating a regular transfer to make consistent progress.',
      metric: `${totals.rate.toFixed(1)}%`, detail: 'current savings rate', icon: Target,
      severity: 'Monthly comparison', page: 'AI Financial Assistant' as const, action: 'Plan your next step',
    },
  ];
  const shown = items.filter(i => filter === 'All insights' || (filter === 'Reviewed' ? reviewed.includes(i.id) : !reviewed.includes(i.id)));
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="tablist" aria-label={t("Insight status")} className="flex rounded-lg border border-line bg-surface p-1">{['All insights', 'To review', 'Reviewed'].map(f =>
        <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={`min-h-11 rounded-md px-4 text-sm focus-visible:ring-2 focus-visible:ring-brand ${filter === f ? 'bg-line' : 'text-muted'}`}>{t(f)}</button>,
      )}</div>
      <p className="flex items-center gap-2 text-xs text-muted"><Sparkles className="h-4 w-4 text-ai" />{t("Calculated from local sample data")}</p>
    </div>
    {loading && <LoadingStatus label={t('Loading your data...')} />}
    {loading ? <div className="grid gap-5 md:grid-cols-2">{[0, 1, 2, 3].map(i => <InsightSkeleton key={i} />)}</div> : <div className={`grid gap-5 md:grid-cols-2 ${fade}`}>{shown.map(i =>
      <Card key={i.id} className="p-6 transition-all duration-300 motion-safe:hover:-translate-y-0.5">
        <div className="mb-5 flex items-center justify-between"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-line"><i.icon className="h-5 w-5 text-muted" /></span><Badge tone={i.id === 'large' ? 'negative' : 'neutral'}>{t(i.severity)}</Badge></div>
        <h2 className="text-[1rem] font-semibold">{t(i.title)}</h2>
        <p className="mt-2 min-h-[60px] text-sm leading-6 text-muted">{t(i.text)}</p>
        <div className="my-5 rounded-lg border border-line bg-base/40 px-4 py-4"><p className="text-2xl font-semibold tracking-tight">{i.metric}</p><p className="mt-1 text-xs text-muted">{t(i.detail)}</p></div>
        <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-3">
          <button className="flex min-h-11 items-center gap-2 text-sm text-brand hover:text-ink focus-visible:ring-2 focus-visible:ring-brand" onClick={() => onNavigate(i.page)}>{t(i.action)}<ArrowRight className="h-4 w-4" /></button>
          <button aria-pressed={reviewed.includes(i.id)} onClick={() => setReviewed(old => old.includes(i.id) ? old.filter(id => id !== i.id) : [...old, i.id])} className="flex min-h-11 items-center gap-2 text-xs text-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-brand"><Check className="h-4 w-4" />{reviewed.includes(i.id) ? t("Reviewed") : t("Mark reviewed")}</button>
        </div>
      </Card>,
    )}</div>}
    {!loading && !shown.length && <Card><Empty title={filter === 'Reviewed' ? t("No reviewed insights yet") : t("You’re all caught up")} text={t("Use the status tabs to explore your insights.")} /></Card>}
  </div>;
}
