import { useLanguage } from '../i18n';
import { lazy, Suspense, useState, type FormEvent } from 'react';
import { Search, Plus, ArrowDownUp, Download, Pencil, Trash2, ArrowUpRight, SlidersHorizontal, Check, FolderOpen, Shapes } from 'lucide-react';
import { type Transaction, type Category, type Budget, money } from '../data';
import { Button, Card, Badge, Empty, Field, Modal, Progress, IconButton, fieldClass, SectionHead } from '../components/ui';
import { TransactionTable } from '../components/transactions';
import { CategoryIcon, CategoryIconPicker, getCategoryIcon, type CategoryIconId } from '../components/CategoryIcon';
import { monthlyData } from '../lib/chartData';
// recharts (~110 KB gzip) only loads when Reports is opened, not with Transactions / Budgets / Categories.
const loadCharts = () => import('../components/charts');
const TrendChart = lazy(() => loadCharts().then(m => ({ default: m.TrendChart })));
const ExpenseDonut = lazy(() => loadCharts().then(m => ({ default: m.ExpenseDonut })));
/** Same height as the chart, so the card does not jump when it arrives. */
const ChartSlot = ({ height }: { height: number }) => <Skeleton className="w-full !rounded-xl" style={{ height }} />;
import { getTotals, percentChange, usedPercent } from '../lib/totals';
import { SummaryCards } from '../components/SummaryCards';
import { FormSelect, Select } from '../components/Select';
import { AmountInput } from '../components/AmountInput';
import { Pagination, usePagination } from '../components/Pagination';
import { SegmentedTabs } from '../components/SegmentedTabs';
import { LoadingStatus, Skeleton, SkeletonText, useFadeIn } from '../components/Skeleton';
import { accountLabel, categoryLabel } from '../i18n/labels';

/** A category card while loading: icon, name and type, then the transaction count and total. */
function CategorySkeleton() {
  return <Card className="p-5"><div aria-hidden="true">
    <div className="flex min-h-11 items-center gap-3"><Skeleton className="size-9 shrink-0 !rounded-lg" /><span className="flex-1"><SkeletonText className="h-6" bar="h-3.5" width="w-28" /><SkeletonText className="mt-1 h-4" bar="h-2.5" width="w-24" /></span></div>
    <div className="mt-5 flex justify-between border-t border-line pt-4"><SkeletonText className="h-5" width="w-24" /><SkeletonText className="h-5" width="w-20" /></div>
  </div></Card>;
}
export function BudgetForm({ budget, category, categories, budgets, onClose, onSave }: { budget?: Budget; category?: string; categories: Category[]; budgets: Budget[]; onClose: () => void; onSave: (b: Budget) => void }) {
  const { t, language, currency } = useLanguage();
  const available = categories.filter(c => c.type === 'Expense' && !budgets.some(b => b.category === c.name && b.id !== budget?.id));
  return <Modal title={budget ? t("Edit budget") : t("Create a budget")} onClose={onClose}><form className="space-y-5" onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); onSave({ id: budget?.id || crypto.randomUUID(), category: String(data.get('category')), limit: Number(data.get('limit')) }); }}><p className="text-sm leading-6 text-muted">{t("Set a realistic spending limit for a category. We’ll calculate your progress from your transactions.")}</p><Field label={t("Category")}><FormSelect name="category" label={t("Category")} defaultValue={budget?.category || (category && available.some(c => c.name === category) ? category : available[0]?.name)} placeholder={t("No categories available")} options={available.map(c => ({ value: c.name, label: categoryLabel(c.name, language), icon: <CategoryIcon name={c.name} icon={c.icon} small /> }))} /></Field><Field label={t("Budget limit ({currency})", { currency })}><AmountInput name="limit" required defaultValue={budget?.limit} /></Field>{!available.length && <p className="text-sm text-negative">{t("Every expense category already has a budget.")}</p>}<div className="flex justify-end gap-3 border-t border-line pt-5"><Button secondary type="button" onClick={onClose}>{t("Cancel")}</Button><Button disabled={!available.length}>{t("Save budget")}</Button></div></form></Modal>;
}
export function Categories({ categories, rows, onAdd, onEdit, onDelete, loading = false }: { categories: Category[]; rows: Transaction[]; onAdd: () => void; onEdit: (c: Category) => void; onDelete: (c: Category) => void; loading?: boolean }) {
  const { t } = useLanguage();
  const fade = useFadeIn(loading);
  const [filter, setFilter] = useState('All');
  const shown = categories.filter(c => filter === 'All' || c.type === filter);
  const pager = usePagination(shown, 9, filter);
  return <div className="space-y-5"><div className="flex items-center justify-between gap-4"><SegmentedTabs label={t("Category type")} value={filter} onChange={setFilter} options={['All', 'Expense', 'Income'].map(f => ({ value: f, label: t(f) }))} /><Button onClick={onAdd}><Plus className="h-4 w-4" />{t("New category")}</Button></div>{loading && <LoadingStatus label={t('Loading your data...')} />}{loading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map(i => <CategorySkeleton key={i} />)}</div> : <div className={`grid gap-4 md:grid-cols-2 xl:grid-cols-3 ${fade}`}>{pager.items.map(c => <Card className="p-5" key={c.name}><div className="flex items-center gap-3"><CategoryIcon name={c.name} icon={c.icon} /><div className="flex-1"><h2 className="text-[1rem] font-semibold">{c.name}</h2><p className="mt-1 text-xs text-muted">{t(c.type === 'Income' ? 'Income category' : 'Expense category')}</p></div>{!c.isSystem && <><IconButton icon={Pencil} label={t('Edit {name}', { name: c.name })} onClick={() => onEdit(c)} /><IconButton icon={Trash2} label={t('Delete {name}', { name: c.name })} onClick={() => onDelete(c)} /></>}</div><div className="mt-5 flex justify-between border-t border-line pt-4"><span className="text-sm text-muted">{t('{count} transactions', { count: rows.filter(row => row.category === c.name).length })}</span><span className="text-sm font-medium tabular-nums">{money(rows.filter(t => t.category === c.name).reduce((s, t) => s + t.amount, 0))}</span></div></Card>)}</div>}{!loading && <Pagination pager={pager} sizes={[9, 18, 36]} className="glass rounded-2xl" />}</div>;
}
export function CategoryForm({ category, categories, onClose, onSave }: { category?: Category; categories: Category[]; onClose: () => void; onSave: (c: Category) => void }) {
  const { t } = useLanguage();
  const [error, setError] = useState('');
  const [name, setName] = useState(category?.name ?? '');
  const [chosen, setChosen] = useState<CategoryIconId | undefined>(() => category ? getCategoryIcon(category.name, category.icon) : undefined);
  const icon = chosen ?? getCategoryIcon(name);
  return <Modal title={category ? t("Edit category") : t("New category")} onClose={onClose}>
    <form className="space-y-5" onSubmit={e => {
      e.preventDefault();
      const trimmed = name.trim();
      if (!trimmed || categories.some(c => c.name.toLowerCase() === trimmed.toLowerCase() && c.name !== category?.name)) return setError('Please use a unique category name.');
      const type = new FormData(e.currentTarget).get('type') === 'Income' ? 'Income' : 'Expense';
      onSave({ name: trimmed, type: category?.type ?? type, color: category?.color ?? '#3B82F6', icon });
    }}>
      <Field label={t("Category name")}><input required name="name" maxLength={40} value={name} onChange={e => setName(e.target.value)} placeholder={t("e.g. Sức khỏe")} className={fieldClass} /></Field>
      <Field label={t("Type")}><FormSelect name="type" label={t("Type")} defaultValue={category?.type || 'Expense'} disabled={!!category} options={[{ value: 'Expense', label: t("Expense") }, { value: 'Income', label: t("Income") }]} /></Field>
      <CategoryIconPicker value={icon} onChange={setChosen} />
      {error && <p role="alert" className="text-sm text-negative">{t(error)}</p>}
      <div className="flex justify-end gap-3"><Button secondary type="button" onClick={onClose}>{t("Cancel")}</Button><Button>{t("Save category")}</Button></div>
    </form>
  </Modal>;
}
export function Reports({ rows, allRows, previous, categories, onExport, hidden = false, loading = false }: {
  rows: Transaction[]; allRows: Transaction[]; previous: Transaction[]; categories: Category[];
  onExport: (r: Transaction[]) => void; hidden?: boolean; loading?: boolean;
}) {
  const { t } = useLanguage();
  const fade = useFadeIn(loading);
  const totals = getTotals(rows), p = getTotals(previous), trends = monthlyData(allRows);
  return <div className="space-y-5">
    <SummaryCards totals={totals} previous={p} hidden={hidden} loading={loading} />
    <div className="grid gap-5 xl:grid-cols-2">
      <Card className="p-5">
        <SectionHead title={t("Income & expense trends")} subtitle={t("Your last six months at a glance.")} />
        <div className="mb-3 flex gap-4 text-xs text-muted">
          <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-sm bg-positive" />{t("Income")}</span>
          <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-sm bg-negative" />{t("Expenses")}</span>
        </div>
        {loading ? <ChartSlot height={225} /> : <div className={fade}><Suspense fallback={<ChartSlot height={225} />}><TrendChart data={trends} /></Suspense></div>}
      </Card>
      <Card className="p-5"><SectionHead title={t("Monthly cash flow")} subtitle={t("Track how much you keep each month.")} />{loading ? <ChartSlot height={225} /> : <div className={fade}><Suspense fallback={<ChartSlot height={225} />}><TrendChart data={trends} line /></Suspense></div>}</Card>
      <Card className="p-5"><SectionHead title={t("Spending by category")} subtitle={t("Selected period breakdown")} />{loading ? <ChartSlot height={210} /> : <div className={fade}><Suspense fallback={<ChartSlot height={210} />}><ExpenseDonut transactions={rows} categories={categories} /></Suspense></div>}</Card>
      <Card className="p-5">
        <SectionHead title={t("Period comparison")} subtitle={t("Selected period vs. the preceding equivalent period")} />
        <div className="space-y-5">{[
          { name: 'Income', current: totals.income, prev: p.income },
          { name: 'Expenses', current: totals.expense, prev: p.expense },
          { name: 'Net savings', current: totals.savings, prev: p.savings },
        ].map(r => <div key={r.name} className="flex justify-between gap-3 border-b border-line pb-4">
          <div><p className="text-sm">{t(r.name)}</p>{loading ? <SkeletonText className="mt-1 h-4" bar="h-2.5" width="w-28" /> : <p className={`mt-1 text-xs text-muted ${fade}`}>{t("Previously") + ' '}{money(r.prev)}</p>}</div>
          {loading ? <div className="flex flex-col items-end"><SkeletonText className="h-5" width="w-24" /><SkeletonText className="mt-1 h-4" bar="h-2.5" width="w-10" /></div> : <div className={`text-right ${fade}`}><p className="text-sm font-semibold">{money(r.current)}</p><p className={`mt-1 text-xs ${(r.name === 'Expenses' ? r.current <= r.prev : r.current >= r.prev) ? 'text-positive' : 'text-negative'}`}>{percentChange(r.current, r.prev).toFixed(1)}%</p></div>}
        </div>)}
          <div className="flex justify-between"><span className="text-sm text-muted">{t("Savings rate")}</span>{loading ? <SkeletonText className="h-7" bar="h-4" width="w-14" /> : <span className={`text-lg font-semibold text-positive ${fade}`}>{totals.rate.toFixed(1)}%</span>}</div>
        </div>
      </Card>
    </div>
    <div className="flex justify-end"><Button secondary onClick={() => onExport(rows)}><Download className="h-4 w-4" />{t("Export financial report")}</Button></div>
  </div>;
}
