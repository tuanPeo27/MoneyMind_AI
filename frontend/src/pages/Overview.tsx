import { useLanguage } from '../i18n';
import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowUpRight, ArrowRight, Sparkles, ChevronRight, Maximize2 } from 'lucide-react';
import { m, useReducedMotion } from 'framer-motion';
import { type Transaction, type Budget, type Category, money, dateLabel } from '../data';
import { percent } from '../lib/currency';
import { getTotals, percentChange, usedPercent } from '../lib/totals';
import type { WalletAccount } from '../hooks/useWorkspaceData';
import { AccountIcon, accountTypes } from './Accounts';
import { Card, Progress, SectionHead, Empty, IconButton } from '../components/ui';
import { ExpandedCard } from '../components/ExpandedCard';
import { TrendChart, ExpenseDonut, monthlyData } from '../components/charts';
import type { Highlight } from '../components/ambient-ai/mockAssistant';
import { CategoryIcon } from '../components/CategoryIcon';
import { HighlightCard, MORPH_SPRING } from '../components/ambient-ai/AmbientAI';
import { SummaryCards } from '../components/SummaryCards';
export { SummaryCards } from '../components/SummaryCards';
import { LoadingStatus, Skeleton, SkeletonText, useFadeIn } from '../components/Skeleton';
import { useAmbientAIView } from '../components/ambient-ai/AmbientAIProvider';
import { getSession } from '../services';
import { QuickEntry } from '../components/ambient-ai/QuickEntry';

// Moved to lib/totals (used by App without loading this chunk); re-exported for existing imports.
export { BalanceContext, getTotals, percentChange, type Totals } from '../lib/totals';
export function BudgetList({ budgets, rows, categories, onView }: { budgets: Budget[]; rows: Transaction[]; categories: Category[]; onView: () => void }) {
  const { t } = useLanguage();
  const sorted = budgets.map(b => ({
    ...b, spent: rows.filter(t => t.type === 'Expense' && t.category === b.category).reduce((s, t) => s + t.amount, 0),
  })).sort((a, b) => b.spent / b.limit - a.spent / a.limit).slice(0, 3);
  return <Card className="flex h-full flex-col p-5">
    <SectionHead title={t("Budget progress")} action={<button aria-label={t("View all budgets")} className="flex min-h-11 w-11 items-center justify-end text-muted hover:text-ink" onClick={onView}><ArrowUpRight className="h-4 w-4" /></button>} />
    <div className="flex-1 space-y-6">{sorted.map(b => {
      const value = b.spent / b.limit * 100;
      return <div key={b.id}><div className="mb-2.5 flex items-center justify-between gap-2 text-sm"><span className="flex items-center gap-2"><CategoryIcon name={b.category} icon={categories.find(c => c.name === b.category)?.icon} small />{b.category}{value >= 85 && <span className="h-1.5 w-1.5 rounded-full bg-negative" />}</span><span className={value >= 85 ? 'text-negative' : 'text-muted'}>{usedPercent(value)}</span></div><Progress label={`${b.category} budget used`} value={value} color={value >= 85 ? 'var(--color-negative)' : undefined} /><div className="mt-2 flex justify-between gap-2 text-xs text-muted"><span>{money(b.spent)}</span><span>{t('of')} {money(b.limit)}</span></div></div>;
    })}{!sorted.length && <Empty title={t("No budgets yet")} text={t("Give your spending a plan.")} />}</div>
    <button onClick={onView} className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-line text-sm text-muted transition-colors hover:bg-line hover:text-ink focus-visible:ring-2 focus-visible:ring-brand">{t("Manage budgets")}<ArrowRight className="h-3.5 w-3.5" /></button>
  </Card>;
}
const slideOfHighlight: Partial<Record<NonNullable<Highlight>, number>> = { cashflow: 0, expenses: 1, budgets: 2, transactions: 3 };
/** Placeholder for one carousel card's body, with the same height as the real one (chart sizes follow `compact`). */
function SlideSkeleton({ id, compact }: { id: string; compact: boolean }) {
  if (id === 'cashflow') return <>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><Skeleton className="h-11 w-40 !rounded-xl" /><SkeletonText className="h-4" bar="h-2.5" width="w-48" /></div>
    <Skeleton className="w-full !rounded-xl" style={{ height: compact ? 230 : 340 }} />
  </>;
  if (id === 'expenses') {
    const size = compact ? 210 : 300;
    return <div className="flex min-h-[220px] w-full flex-col items-center justify-center gap-4 py-4 sm:flex-row md:min-h-[360px]">
      {/* The donut ring (outer radius 46% of the size, inner 35%): a circle masked to a ring, so the glass card shows through the hole. */}
      <span className="relative shrink-0" style={{ width: size, height: size }}>
        <Skeleton className="absolute !rounded-full" style={{ inset: size * 0.04, ...ringMask }} />
      </span>
      <div className="w-full min-w-0 flex-1 space-y-1">{[0, 1, 2, 3].map(i => <div key={i} className="flex items-center justify-between gap-2 px-3 py-2">
        <SkeletonText className="h-5" width={i ? 'w-16' : 'w-24'} /><span><SkeletonText className="h-4" width="w-14" /><SkeletonText className="mt-0.5 h-4" bar="h-2.5" width="w-10" /></span>
      </div>)}</div>
    </div>;
  }
  if (id === 'budgets') return <div className="min-h-[220px] py-2 md:min-h-[360px]"><div className="grid gap-x-12 gap-y-7 md:grid-cols-2">{[0, 1, 2, 3].map(i => <div key={i}>
    <div className="mb-2.5 flex items-center justify-between gap-2"><span className="flex items-center gap-2"><Skeleton className="size-7 !rounded-lg" /><SkeletonText className="h-5" width="w-20" /></span><SkeletonText className="h-5" width="w-8" /></div>
    <Skeleton className="h-1.5 w-full !rounded-full" />
    <div className="mt-2 flex justify-between gap-2"><SkeletonText className="h-4" bar="h-2.5" width="w-16" /><SkeletonText className="h-4" bar="h-2.5" width="w-20" /></div>
  </div>)}</div></div>;
  return <div className="min-h-[220px] py-2 md:min-h-[360px]"><div className="divide-y divide-line/80">{[0, 1, 2, 3, 4].map(i => <div key={i} className="flex min-h-[68px] items-center gap-4 py-3">
    <Skeleton className="size-9 shrink-0 !rounded-lg" />
    <span className="min-w-0 flex-1"><SkeletonText className="h-5" width={i % 2 ? 'w-28' : 'w-40'} /><SkeletonText className="mt-1 h-4" bar="h-2.5" width="w-32" /></span>
    <SkeletonText className="h-5" width="w-20" />
  </div>)}</div><div className="mt-4 h-11" /></div>;
}
const ringMask = { mask: 'radial-gradient(circle closest-side, transparent 76%, #000 76.5%)', WebkitMask: 'radial-gradient(circle closest-side, transparent 76%, #000 76.5%)' };
/** memo: the Overview stays still while the AI page opens and closes over it (all props from App are stable). */
export default memo(function Overview({ rows, allRows, previous, budgets, categories, accounts = [], onNavigate, onEdit, onQuickAddManual, hidden = false, setHidden, rangeEnd, showInsight = true, loading = false }: {
  rows: Transaction[]; allRows: Transaction[]; previous: Transaction[]; budgets: Budget[]; categories: Category[];
  /** True during the first load of the user's data: skeletons instead of empty states. */
  loading?: boolean;
  /** Active accounts with their current balance, for the short list under the summary cards. */
  accounts?: WalletAccount[];
  onNavigate: (page: 'Transactions' | 'Budgets' | 'Smart Insights' | 'AI Financial Assistant' | 'Accounts') => void;
  onEdit: (t: Transaction) => void;
  /** Opens the manual form prefilled from a quick entry the AI could not handle. */
  onQuickAddManual?: (draft: Partial<Transaction>) => void;
  hidden?: boolean; setHidden?: (value: boolean) => void; rangeEnd?: string; showInsight?: boolean;
}) {
  const { t, locale } = useLanguage();
  const { openAssistant, highlight, clearHighlight } = useAmbientAIView();
  const fade = useFadeIn(loading);
  const [chartPeriod, setChartPeriod] = useState('Monthly');
  const [index, setIndex] = useState(0), [cardW, setCardW] = useState(760);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabPill = useRef<HTMLSpanElement>(null);
  const tabList = useRef<HTMLDivElement>(null);
  const dotPill = useRef<HTMLSpanElement>(null);
  const dots = useRef<(HTMLButtonElement | null)[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const indexRef = useRef(0), frame = useRef(0);
  const COUNT = 4;
  const [expanded, setExpanded] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  // No depth effect here (unlike the AI page): shrinking <main> to 94% while a card is expanded made the closing
  // morph aim at the shrunken card, then the card jumped to full size as <main> scaled back. The blurred backdrop
  // of ExpandedCard already separates the surface from the page.
  const compact = cardW < 520;
  const uid = useId();
  const totals = getTotals(rows), past = getTotals(previous);
  const end = rangeEnd ? new Date(rangeEnd + 'T12:00:00') : new Date();
  const trends = monthlyData(allRows, end);
  const weekly = Array.from({ length: 6 }, (_, i) => {
    const to = new Date(end); to.setDate(to.getDate() - (5 - i) * 7);
    const from = new Date(to); from.setDate(from.getDate() - 6);
    const list = allRows.filter(t => new Date(t.date + 'T12:00:00') >= from && new Date(t.date + 'T12:00:00') <= to);
    const t = getTotals(list);
    return { name: to.toLocaleDateString(locale, { day: 'numeric', month: 'short' }), income: t.income, expense: t.expense, savings: t.savings, date: to.getTime() };
  });
  const series = chartPeriod === 'Monthly' ? trends : weekly;
  const dining = rows.filter(t => t.category === 'Ăn uống' && t.type === 'Expense').reduce((s, t) => s + t.amount, 0);
  const oldDining = previous.filter(t => t.category === 'Ăn uống' && t.type === 'Expense').reduce((s, t) => s + t.amount, 0);
  const diningChange = percentChange(dining, oldDining);
  const recent = [...rows].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const expenses = rows.filter(t => t.type === 'Expense');
  const budgetRows = budgets.map(b => ({ ...b, spent: expenses.filter(t => t.category === b.category).reduce((s, t) => s + t.amount, 0) }));
  const shownBudgets = [...budgetRows].sort((a, b) => b.spent / b.limit - a.spent / a.limit).slice(0, 6);

  // Center-mode carousel: every card is scaled, faded and tilted by its distance from the scroller's centre.
  const applyFocus = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const mid = el.scrollLeft + el.clientWidth / 2;
    let best = 0, bestDistance = Infinity;
    const centers: number[] = [];
    cards.current.forEach((card, i) => {
      if (!card) return;
      centers[i] = card.offsetLeft + card.offsetWidth / 2;
      const dist = centers[i] - mid;
      const d = Math.min(1, Math.abs(dist) / (card.offsetWidth + 24));
      card.style.transform = `scale(${1 - 0.15 * d}) rotateY(${(dist < 0 ? 1 : -1) * 18 * d}deg)`;
      card.style.opacity = String(1 - 0.5 * d);
      if (Math.abs(dist) < bestDistance) { bestDistance = Math.abs(dist); best = i; }
    });
    if (best !== indexRef.current) { indexRef.current = best; setIndex(best); }
    // Sliding pill: a fractional position (e.g. 1.4 = 40% of the way from card 1 to card 2) drives both indicators,
    // so they glide with the scroll instead of jumping when the active index changes.
    let from = 0, frac = 0;
    for (let i = 0; i < centers.length - 1; i++) {
      if (mid >= centers[i] && mid <= centers[i + 1]) { from = i; frac = (mid - centers[i]) / (centers[i + 1] - centers[i] || 1); break; }
      if (mid > centers[i + 1]) { from = i + 1; frac = 0; }
    }
    const to = Math.min(centers.length - 1, from + 1);
    // Small dead zone at both ends: when the carousel rests a pixel or two off-centre (scroll snapping rounds to
    // whole pixels) the pill still sits exactly on its tab instead of leaning toward the next one.
    const f = Math.min(1, Math.max(0, (frac - 0.06) / 0.88));
    const a = tabs.current[from], b = tabs.current[to], pill = tabPill.current;
    if (a && b && pill) {
      const left = a.offsetLeft + (b.offsetLeft - a.offsetLeft) * f;
      const width = a.offsetWidth + (b.offsetWidth - a.offsetWidth) * f;
      pill.style.transform = `translateX(${left}px)`;
      pill.style.width = `${width}px`;
      pill.style.opacity = '1';
      // On narrow screens the tab bar is wider than the viewport: keep the pill centred in it, frame by frame,
      // so the active label is never cut off. The browser clamps scrollLeft at both ends.
      const list = tabList.current;
      if (list && list.scrollWidth > list.clientWidth) list.scrollLeft = left + width / 2 - list.clientWidth / 2;
    }
    // Dots: the active dot widens to the pill's size and the others keep 8px, so neighbours are pushed aside
    // instead of being covered. The two dots involved share the extra 16px, so the row's total width never changes.
    const GAP = 8, DOT = 8, EXTRA = 16;
    const widths = dots.current.map((_, i) => DOT + EXTRA * (i === from ? 1 - f : i === to && to !== from ? f : 0));
    dots.current.forEach((d, i) => { if (d) d.style.width = `${widths[i]}px`; });
    const x = (i: number) => widths.slice(0, i).reduce((s, w) => s + w + GAP, 0);
    const dot = dotPill.current;
    if (dot) {
      const stretch = Math.sin(Math.PI * f) * 6; // a slight liquid stretch mid-way
      const left = x(from) + (x(to) - x(from)) * f;
      const width = widths[from] + (widths[to] - widths[from]) * f;
      dot.style.transform = `translateX(${left - stretch / 2}px)`;
      dot.style.width = `${width + stretch}px`;
    }  }, []);
  const go = useCallback((target: number, instantly = false) => {
    const el = scroller.current, next = Math.max(0, Math.min(COUNT - 1, target)), card = cards.current[next];
    if (!el || !card) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: card.offsetLeft + card.offsetWidth / 2 - el.clientWidth / 2, behavior: instantly || reduce ? 'auto' : 'smooth' });
  }, []);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => { setCardW(Math.round(Math.min(860, Math.max(260, el.clientWidth * (el.clientWidth < 640 ? 0.88 : 0.72))))); };
    measure();
    const observer = new ResizeObserver(() => { measure(); cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(() => { go(indexRef.current, true); applyFocus(); }); });
    observer.observe(el);
    // Tab widths change with the language and once web fonts load; keep the pill measured against them.
    const tabObserver = new ResizeObserver(() => applyFocus());
    if (tabList.current) tabObserver.observe(tabList.current);
    return () => { observer.disconnect(); tabObserver.disconnect(); cancelAnimationFrame(frame.current); };
  }, [applyFocus, go]);
  useLayoutEffect(() => { go(indexRef.current, true); applyFocus(); }, [cardW, applyFocus, go]);
  // Cards change only by clicking: the tab bar, the dots, or one of the faded side cards (plus the keyboard).
  // The mouse wheel scrolls the page, and the strip itself is overflow-hidden so trackpad / touch swipes do nothing.
  // Left / Right arrow keys anywhere on the page (except while typing or inside a dialog).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"], [role="tab"], [role="combobox"], [role="listbox"]') || document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      go(indexRef.current + (e.key === 'ArrowRight' ? 1 : -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);
  // When the AI points at a card, bring that card to the centre without animating.
  useEffect(() => {
    const target = highlight ? slideOfHighlight[highlight] : undefined;
    if (target !== undefined) go(target, true);
  }, [highlight, go]);
  const slides: { id: string; label: string; target: NonNullable<Highlight>; onInspect: () => void; node: ReactNode }[] = [
    { id: 'cashflow', label: 'Cash flow', target: 'cashflow', onInspect: () => onNavigate('Transactions'), node: <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label={t("Cash flow interval")} className="flex rounded-xl bg-base/50 p-1">{['Monthly', 'Weekly'].map(p => <button key={p} role="tab" aria-selected={p === chartPeriod} onClick={() => setChartPeriod(p)} className={`min-h-9 rounded-lg px-3 text-xs transition-colors ${p === chartPeriod ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>{t(p)}</button>)}</div>
        <div className="flex gap-4 text-xs text-muted"><span>{chartPeriod === 'Monthly' ? t("Last 6 months") : t("Last 6 weeks")}</span><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-positive" />{t("Income")}</span><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-negative" />{t("Expenses")}</span></div>
      </div>
      <TrendChart data={series} height={compact ? 230 : 340} />
    </> },
    { id: 'expenses', label: 'Expense breakdown', target: 'expenses', onInspect: () => onNavigate('Transactions'), node: <div className="flex min-h-[220px] md:min-h-[360px] items-center py-4"><ExpenseDonut transactions={rows} categories={categories} size={compact ? 210 : 300} /></div> },
    { id: 'budgets', label: 'Budget progress', target: 'budgets', onInspect: () => onNavigate('Budgets'), node: <div className="min-h-[220px] md:min-h-[360px] py-2">
      <div className="grid gap-x-12 gap-y-7 md:grid-cols-2">{shownBudgets.map(b => {
        const value = b.spent / b.limit * 100;
        return <div key={b.id}><div className="mb-2.5 flex items-center justify-between gap-2 text-sm"><span className="flex items-center gap-2"><CategoryIcon name={b.category} icon={categories.find(c => c.name === b.category)?.icon} small />{b.category}{value >= 85 && <span className="h-1.5 w-1.5 rounded-full bg-negative" />}</span><span className={value >= 85 ? 'text-negative' : 'text-muted'}>{usedPercent(value)}</span></div><Progress label={`${b.category} budget used`} value={value} color={value >= 85 ? 'var(--color-negative)' : undefined} /><div className="mt-2 flex justify-between gap-2 text-xs text-muted"><span>{money(b.spent)}</span><span>{t('of')} {money(b.limit)}</span></div></div>;
      })}</div>
      {!shownBudgets.length && <Empty title={t("No budgets yet")} text={t("Give your spending a plan.")} />}
      <button onClick={() => onNavigate('Budgets')} className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-xl text-sm font-medium text-brand hover:underline focus-visible:ring-2 focus-visible:ring-brand">{t("Manage budgets")}<ArrowRight className="h-3.5 w-3.5" /></button>
    </div> },
    { id: 'transactions', label: 'Recent transactions', target: 'transactions', onInspect: () => onNavigate('Transactions'), node: <div className="min-h-[220px] md:min-h-[360px] py-2">
      <div className="divide-y divide-line/80">{recent.map(t => <button key={t.id} onClick={() => onEdit(t)} className="flex min-h-[68px] w-full items-center gap-4 py-3 text-left transition-colors hover:bg-brand/5 focus-visible:ring-2 focus-visible:ring-brand"><CategoryIcon name={t.category} icon={categories.find(c => c.name === t.category)?.icon} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{t.description}</span><span className="mt-1 block text-xs text-muted">{t.category}<span className="mx-1.5">·</span>{dateLabel(t.date, locale)}</span></span><span className={`shrink-0 text-sm font-medium tabular-nums ${t.type === 'Income' ? 'text-positive' : 'text-ink'}`}>{t.type === 'Income' ? '+' : '−'}{money(t.amount)}</span></button>)}</div>
      {!recent.length && <Empty title={t("No transactions in this period")} />}
      <button onClick={() => onNavigate('Transactions')} className="mt-4 inline-flex min-h-11 items-center gap-1 rounded-xl text-sm font-medium text-brand hover:underline focus-visible:ring-2 focus-visible:ring-brand">{t("View all")}<ChevronRight className="h-3.5 w-3.5" /></button>
    </div> },
  ];
  const th = 'px-3 py-2.5 text-left text-xs font-medium text-muted';
  const td = 'px-3 py-3 tabular-nums';
  const spendByCategory = Object.entries(expenses.reduce<Record<string, number>>((acc, tx) => ({ ...acc, [tx.category]: (acc[tx.category] || 0) + tx.amount }), {})).sort((x, y) => y[1] - x[1]);
  const details: Record<string, ReactNode> = {
    cashflow: <div className="space-y-6">
      <div role="tablist" aria-label={t("Cash flow interval")} className="flex w-fit rounded-xl bg-base/50 p-1">{['Monthly', 'Weekly'].map(p => <button key={p} role="tab" aria-selected={p === chartPeriod} onClick={() => setChartPeriod(p)} className={`min-h-9 rounded-lg px-3 text-xs transition-colors ${p === chartPeriod ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>{t(p)}</button>)}</div>
      <TrendChart data={series} height={Math.max(260, Math.min(460, Math.round(window.innerHeight * 0.45)))} />
      <div className="overflow-x-auto rounded-2xl border border-line"><table className="w-full text-sm"><thead className="border-b border-line"><tr><th className={th}>{t('Period')}</th><th className={th}>{t('Income')}</th><th className={th}>{t('Expenses')}</th><th className={th}>{t('Net cash flow')}</th></tr></thead>
        <tbody className="divide-y divide-line">{series.map(d => <tr key={d.name}><td className={td}>{d.name}</td><td className={`${td} text-positive`}>{money(d.income)}</td><td className={`${td} text-negative`}>{money(d.expense)}</td><td className={`${td} font-medium`}>{money(d.savings)}</td></tr>)}</tbody></table></div>
    </div>,
    expenses: <div className="space-y-6">
      <ExpenseDonut transactions={rows} categories={categories} size={340} />
      <div className="overflow-x-auto rounded-2xl border border-line"><table className="w-full text-sm"><thead className="border-b border-line"><tr><th className={th}>{t('Categories')}</th><th className={th}>{t('Total spent')}</th><th className={th}>%</th></tr></thead>
        <tbody className="divide-y divide-line">{spendByCategory.map(([name, amount]) => <tr key={name}><td className={td}>{name}</td><td className={td}>{money(amount)}</td><td className={td}>{percent(amount, totals.expense)}</td></tr>)}</tbody></table></div>
    </div>,
    budgets: <div className="grid gap-x-12 gap-y-7 md:grid-cols-2">{budgetRows.map(b => { const value = b.spent / b.limit * 100;
      return <div key={b.id}><div className="mb-2.5 flex items-center justify-between gap-2 text-sm"><span className="flex items-center gap-2"><CategoryIcon name={b.category} icon={categories.find(c => c.name === b.category)?.icon} small />{b.category}</span><span className={value >= 85 ? 'text-negative' : 'text-muted'}>{usedPercent(value)}</span></div><Progress label={`${b.category} budget used`} value={value} color={value >= 85 ? 'var(--color-negative)' : undefined} /><div className="mt-2 flex justify-between gap-2 text-xs text-muted"><span>{money(b.spent)}</span><span>{t('of')} {money(b.limit)}</span></div></div>; })}
      {!budgetRows.length && <Empty title={t("No budgets yet")} text={t("Give your spending a plan.")} />}</div>,
    transactions: <div className="overflow-x-auto rounded-2xl border border-line"><table className="w-full text-sm"><thead className="border-b border-line"><tr><th className={th}>{t('Date')}</th><th className={th}>{t('Transaction')}</th><th className={th}>{t('Category')}</th><th className={`${th} text-right`}>{t('Amount')}</th></tr></thead>
      <tbody className="divide-y divide-line">{[...rows].sort((x, y) => y.date.localeCompare(x.date)).slice(0, 20).map(tx => <tr key={tx.id}><td className={`${td} whitespace-nowrap text-muted`}>{dateLabel(tx.date, locale)}</td><td className="px-3 py-3">{tx.description}</td><td className="px-3 py-3 text-muted">{tx.category}</td><td className={`${td} text-right font-medium ${tx.type === 'Income' ? 'text-positive' : ''}`}>{tx.type === 'Income' ? '+' : '−'}{money(tx.amount)}</td></tr>)}</tbody></table>{!rows.length && <Empty title={t("No transactions in this period")} />}</div>,
  };  const open = slides.find(s => s.id === expanded);
  function onTabKey(event: KeyboardEvent) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'Home' ? -index : event.key === 'End' ? slides.length - 1 - index : 0;
    if (!step) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(slides.length - 1, index + step));
    go(next); tabs.current[next]?.focus();
  }
  return <div className="space-y-5">
    {onQuickAddManual && <QuickEntry onManual={onQuickAddManual} />}
    {loading && <LoadingStatus label={t('Loading your data...')} />}
    <SummaryCards totals={totals} previous={past} hidden={hidden} onToggleHidden={setHidden} loading={loading} layout="stack" />
    <AccountsStrip accounts={accounts} hidden={hidden} onManage={() => onNavigate('Accounts')} loading={loading} />
    <section aria-label={t("Overview sections")}>
      <div ref={tabList} role="tablist" aria-label={t("Overview sections")} onKeyDown={onTabKey} className="relative isolate mx-auto mb-5 flex w-fit max-w-full gap-1 overflow-x-auto rounded-2xl bg-surface p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* Position and width are written by applyFocus on every scroll frame. */}
        <span ref={tabPill} aria-hidden="true" style={{ opacity: 0 }} className="pointer-events-none absolute inset-y-1 left-0 -z-10 rounded-xl bg-gradient-to-br from-accent to-accent-2 shadow-md shadow-accent/30 will-change-transform" />
        {slides.map((s, i) =>
        <button key={s.id} ref={el => { tabs.current[i] = el; }} role="tab" id={`${uid}-tab-${s.id}`} aria-selected={i === index} aria-controls={`${uid}-panel-${s.id}`} tabIndex={i === index ? 0 : -1} onClick={() => go(i)}
          className={`min-h-9 shrink-0 rounded-xl px-3.5 text-sm font-medium transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${i === index ? 'text-on-accent' : 'text-muted hover:text-ink'}`}>{t(s.label)}</button>)}</div>
      <div ref={scroller} onScroll={() => { cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(applyFocus); }}
        style={{ ['--card-w' as string]: `${cardW}px`, perspective: '1400px', paddingInline: 'calc(50% - var(--card-w) / 2)' }}
        className="relative flex items-stretch gap-6 overflow-hidden py-3 sm:py-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {slides.map((s, i) => <div key={s.id} ref={el => { cards.current[i] = el; }} role="tabpanel" id={`${uid}-panel-${s.id}`} aria-labelledby={`${uid}-tab-${s.id}`} aria-hidden={i !== index}
          onClick={() => { if (i !== index) go(i); }}
          className={`relative flex w-[var(--card-w)] flex-none will-change-transform ${i === index ? '' : 'cursor-pointer'}`}>
          <m.div layoutId={`card-${s.id}`} style={{ borderRadius: 24 }} transition={reduceMotion ? { duration: 0 } : MORPH_SPRING} className="glass relative w-full p-4 sm:p-6">
            <span aria-hidden="true" className={`pointer-events-none absolute -inset-px rounded-3xl shadow-[0_0_48px_-10px_color-mix(in_oklab,var(--color-accent)_70%,transparent)] ring-1 ring-accent/50 transition-opacity duration-500 ${i === index ? 'opacity-100' : 'opacity-0'}`} />
            <m.div className="relative" animate={{ opacity: expanded === s.id ? 0 : 1 }} transition={{ duration: 0.1 }} {...(i === index ? {} : ({ inert: '' } as object))}>
              <div className="mb-4 flex items-center justify-between gap-2"><h3 className="text-[1rem] font-semibold tracking-tight">{t(s.label)}</h3>
                {i === index && <IconButton icon={Maximize2} label={t('Expand')} onClick={() => setExpanded(s.id)} />}</div>
              <HighlightCard target={s.target} onInspect={s.onInspect}>{loading ? <SlideSkeleton id={s.id} compact={compact} /> : <div className={fade}>{s.node}</div>}</HighlightCard>
            </m.div>
          </m.div>
        </div>)}
      </div>
      <ExpandedCard id={expanded} title={open ? t(open.label) : ''} closeLabel={t('Close')} onClose={() => setExpanded(null)}>{expanded ? details[expanded] : null}</ExpandedCard>
      <div className="mt-2 flex justify-center" aria-hidden="true"><div className="relative flex items-center gap-2">
        {slides.map((s, i) => <button key={s.id} ref={el => { dots.current[i] = el; }} type="button" tabIndex={-1} onClick={() => go(i)} className="h-2 w-2 shrink-0 rounded-full bg-ink/25 transition-colors hover:bg-ink/45" />)}
        <span ref={dotPill} className="pointer-events-none absolute left-0 top-0 h-2 w-6 rounded-full bg-gradient-to-r from-accent to-accent-2 shadow-[0_0_14px_2px_color-mix(in_oklab,var(--color-accent)_55%,transparent)] will-change-transform" />
      </div></div>
    </section>    {showInsight && <div className="glass flex flex-wrap items-center gap-4 rounded-2xl px-5 py-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-ai-from via-ai-to to-ai-warm text-on-ai shadow-md shadow-ai-from/30"><Sparkles className="h-4 w-4" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1"><p className="mb-1 text-xs font-medium text-ai">{t("A SMALL INSIGHT")}</p><p className="text-sm">{oldDining ? t(diningChange >= 0 ? 'Dining expenses increased {change}% this period.' : 'Dining expenses decreased {change}% this period.', { change: Math.abs(diningChange).toFixed(0) }) : t("A clearer picture starts with your spending.")} <span className="ml-1 text-muted">{money(dining)}</span></p></div>
      <button onClick={() => openAssistant('Why did my dining expenses change this month?')} className="flex min-h-11 items-center gap-2 rounded-xl bg-gradient-to-br from-ai-from via-ai-to to-ai-warm text-on-ai px-4 text-sm font-medium shadow-md shadow-ai-from/30 transition-[filter] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ai-from focus-visible:ring-offset-2">{t("Analyze with AI")}<ArrowUpRight className="h-4 w-4" /></button>
    </div>}
    {highlight && <div className="flex justify-end"><button onClick={clearHighlight} className="min-h-11 text-sm text-muted hover:text-ink">{t("Clear AI highlight & return to normal view")}</button></div>}
  </div>;
});
const STRIP_LIMIT = 8;
/**
 * One tile per account (name, type, balance), largest balance first. Follows the Total balance eye: hiding it
 * hides every amount here too.
 */
function AccountsStrip({ accounts, hidden, onManage, loading = false }: { accounts: WalletAccount[]; hidden: boolean; onManage: () => void; loading?: boolean }) {
  const { t } = useLanguage();
  const fade = useFadeIn(loading);
  const shown = [...accounts].sort((a, b) => b.balance - a.balance).slice(0, STRIP_LIMIT);
  // The skeleton draws as many tiles as the last visit showed (stored per user), so the strip keeps its height when
  // the real tiles arrive: on a phone each tile is its own row and a wrong count pushed everything below (CLS).
  const countKey = `mm-overview-account-tiles:${getSession()?.user.id ?? 'guest'}`;
  const [tiles] = useState(() => Math.min(STRIP_LIMIT, Math.max(1, Number(localStorage.getItem(countKey)) || 1)));
  useEffect(() => { if (!loading) localStorage.setItem(countKey, String(Math.max(1, shown.length))); }, [loading, shown.length, countKey]);
  return <section aria-labelledby="overview-accounts">
    <div className="mb-2.5 flex items-center justify-between gap-3 px-1">
      <h2 id="overview-accounts" className="text-sm font-semibold tracking-tight">{t('Your accounts')}</h2>
      <button type="button" onClick={onManage} className="inline-flex min-h-9 items-center gap-1 rounded-lg text-xs font-medium text-brand hover:underline focus-visible:ring-2 focus-visible:ring-brand">
        {accounts.length > STRIP_LIMIT ? t('View all {count}', { count: accounts.length }) : t('Manage accounts')}<ChevronRight className="size-3.5" aria-hidden="true" />
      </button>
    </div>
    {/* Same number of tiles as last time (at least one: every user has the default wallet); heights match a real tile. */}
    {loading ? <ul aria-hidden="true" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{Array.from({ length: tiles }, (_, i) => <li key={i} className="glass rounded-2xl px-4 py-3.5">
      <span className="flex items-center gap-3"><Skeleton className="size-8 shrink-0 !rounded-xl" /><span className="min-w-0 flex-1"><SkeletonText className="h-5" width="w-24" /><SkeletonText className="h-4" bar="h-2.5" width="w-16" /></span></span>
      <Skeleton className="mt-3 h-[18px] w-28" />
    </li>)}</ul>
    : shown.length ? <ul className={`grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${fade}`}>{shown.map(a =>
      <li key={a.id}><button type="button" onClick={onManage} title={a.name}
        className="glass block w-full rounded-2xl px-4 py-3.5 text-left transition-[transform,box-shadow] duration-300 motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
        <span className="flex items-center gap-3">
          <AccountIcon type={a.type} small />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{a.name}</span>
            <span className="block truncate text-xs text-muted">{t(accountTypes[a.type]?.label ?? a.type)}</span>
          </span>
        </span>
        {/* Balance on its own line so a long amount never squeezes the account name. */}
        <span className={`mt-3 block truncate text-lg font-semibold leading-none tracking-[-0.03em] tabular-nums ${!hidden && a.balance < 0 ? 'text-negative' : ''}`}>{money(a.balance)}</span>
      </button></li>)}</ul>
      : <Card className="px-4 py-3.5"><p className="text-sm text-muted">{t('No accounts yet')}</p></Card>}
  </section>;
}
