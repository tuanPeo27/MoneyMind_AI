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
const ChartSlot = ({ height }: { height: number }) => <div aria-hidden="true" className="animate-pulse rounded-xl bg-line/30 motion-reduce:animate-none" style={{ height }} />;
import { getTotals, percentChange } from '../lib/totals';
import { SummaryCards } from './Overview';
import { FormSelect, Select } from '../components/Select';
import { AmountInput } from '../components/AmountInput';
import { Pagination, usePagination } from '../components/Pagination';
import { accountLabel, categoryLabel } from '../i18n/labels';

export function Transactions({ rows, categories, search, setSearch, onAdd, onEdit, onDelete, onExport, onManageCategories }: { rows: Transaction[]; categories: Category[]; search: string; setSearch: (s: string) => void; onAdd: () => void; onEdit: (t: Transaction) => void; onDelete: (t: Transaction) => void; onExport: (rows: Transaction[]) => void; onManageCategories: () => void }) {
  const { t, language } = useLanguage();
  const [type, setType] = useState('All types'), [category, setCategory] = useState('All categories');
  const [sort, setSort] = useState({ key: 'date', ascending: false });
  const filtered = rows.filter(row => {
    const searchable = `${row.description} ${row.category} ${row.account} ${categoryLabel(row.category, language)} ${accountLabel(row.account, language)}`.toLocaleLowerCase();
    return (!search || searchable.includes(search.trim().toLocaleLowerCase()))
      && (type === 'All types' || row.type === type)
      && (category === 'All categories' || row.category === category);
  }).sort((a, b) => {
    const difference = sort.key === 'amount' ? a.amount - b.amount : a.date.localeCompare(b.date);
    return sort.ascending ? difference : -difference;
  });
  const totals = getTotals(filtered);
  const pager = usePagination(filtered, 10, `||||`);
  return <div className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-3">{[
      { label: 'Money in', value: totals.income, color: 'text-positive' },
      { label: 'Money out', value: totals.expense, color: 'text-negative' },
      { label: 'Net cash flow', value: totals.savings, color: 'text-ink' },
    ].map(item => <Card key={item.label} className="p-5"><p className="text-sm text-muted">{t(item.label)}</p><p className={`mt-3 text-2xl font-semibold tracking-tight tabular-nums ${item.color}`}>{money(item.value)}</p></Card>)}</div>
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-[190px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted" aria-hidden="true" />
          <input value={search} onChange={e => setSearch(e.target.value)} aria-label={t('Search transactions')} placeholder={t('Search transactions...')} className={`${fieldClass} pl-10`} />
        </div>
        <Select label={t('Filter transaction type')} value={type} onChange={setType} className="w-full sm:w-[145px]" options={['All types', 'Income', 'Expense'].map(value => ({ value, label: t(value) }))} />
        <Select label={t('Filter category')} value={category} onChange={setCategory} className="w-full sm:w-[190px]" options={[
          { value: 'All categories', label: t('All categories') },
          ...categories.map(item => ({ value: item.name, label: categoryLabel(item.name, language), icon: <CategoryIcon name={item.name} icon={item.icon} small /> })),
        ]} />
        {/* Categories has no tab in the phone taskbar: this is the way there from Transactions. */}
        <Button secondary onClick={onManageCategories}><Shapes aria-hidden="true" className="size-4" />{t('Categories')}</Button>
        <Button secondary onClick={() => onExport(filtered)}><Download aria-hidden="true" className="size-4" />{t('Export')}</Button>
        <Button onClick={onAdd}><Plus aria-hidden="true" className="size-4" />{t('Add transaction')}</Button>
      </div>
      <TransactionTable rows={pager.items} categories={categories} onEdit={onEdit} onDelete={onDelete} onSort={key => setSort({ key, ascending: sort.key === key ? !sort.ascending : false })} />
      <Pagination pager={pager} sizes={[10, 20, 50]} className="border-t border-line" />
      <p className="border-t border-line px-5 py-3 text-xs text-muted">{t('Showing {count} of {total} transactions', { count: filtered.length, total: rows.length })} · {t('All amounts in VND · Stored on this browser')}</p>
    </Card>
  </div>;
}
export function Budgets({ budgets, rows, categories, onAdd, onEdit, onDelete }: { budgets: Budget[]; rows: Transaction[]; categories: Category[]; onAdd: () => void; onEdit: (b: Budget) => void; onDelete: (b: Budget) => void }) {
  const { t } = useLanguage();
  const items = budgets.map(b => ({ ...b, spent: rows.filter(t => t.category === b.category && t.type === 'Expense').reduce((s, t) => s + t.amount, 0) }));
  const pager = usePagination(items, 6, items.length);
  const limit = items.reduce((s, b) => s + b.limit, 0), spent = items.reduce((s, b) => s + b.spent, 0), utilization = limit ? spent / limit * 100 : 0;
  return <div className="space-y-6"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[{ label: 'Total budget', value: money(limit) }, { label: 'Total spent', value: money(spent) }, { label: 'Remaining budget', value: money(limit - spent) }, { label: 'Budget utilization', value: `${utilization.toFixed(1)}%` }].map(s => <Card key={s.label} className="p-5"><p className="text-sm text-muted">{t(s.label)}</p><p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{s.value}</p></Card>)}</div><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">{t("Your category budgets")}</h2><p className="mt-1 text-sm text-muted">{t("Give every đồng a purpose. Keep your spending on track.")}</p></div><Button onClick={onAdd}><Plus className="h-4 w-4" />{t("Add budget")}</Button></div><div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{pager.items.map(b => {
    const used = b.spent / b.limit * 100, warning = used >= 85;
    return <Card key={b.id} className="p-5"><div className="mb-5 flex items-center gap-3"><CategoryIcon name={b.category} icon={categories.find(c => c.name === b.category)?.icon} /><h3 className="flex-1 text-[1rem] font-semibold">{b.category}</h3><IconButton label={t('Edit budget {name}', { name: b.category })} icon={Pencil} onClick={() => onEdit(b)} /><IconButton label={t('Delete budget {name}', { name: b.category })} icon={Trash2} onClick={() => onDelete(b)} /></div><div className="mb-3 flex items-baseline justify-between gap-2"><span className="text-2xl font-semibold tracking-tight">{money(b.spent)}</span><span className="text-sm text-muted">{Math.round(used)}%</span></div><Progress value={used} label={`${b.category} utilization`} color={warning ? 'var(--color-negative)' : undefined} /><div className="mt-3 flex justify-between text-xs text-muted"><span>{t('of')} {money(b.limit)}</span><span>{t('{amount} left', { amount: money(b.limit - b.spent) })}</span></div><div className="mt-6 border-t border-line pt-4"><Badge tone={warning ? 'negative' : 'positive'}>{used > 100 ? t("Over budget") : warning ? t("Approaching limit") : t("On track")}</Badge></div></Card>;
  })}</div><Pagination pager={pager} sizes={[6, 12, 24]} className="glass rounded-2xl" />{!items.length && <Card><Empty title={t("Your budget starts here")} text={t("Create a category budget to take control of your spending.")} /></Card>}<p className="text-xs text-muted">{t("Spending is calculated from transactions in your selected period. Budget limits apply to that period.")}</p></div>;
}
export function BudgetForm({ budget, categories, budgets, onClose, onSave }: { budget?: Budget; categories: Category[]; budgets: Budget[]; onClose: () => void; onSave: (b: Budget) => void }) {
  const { t, language, currency } = useLanguage();
  const available = categories.filter(c => c.type === 'Expense' && !budgets.some(b => b.category === c.name && b.id !== budget?.id));
  return <Modal title={budget ? t("Edit budget") : t("Create a budget")} onClose={onClose}><form className="space-y-5" onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); onSave({ id: budget?.id || crypto.randomUUID(), category: String(data.get('category')), limit: Number(data.get('limit')) }); }}><p className="text-sm leading-6 text-muted">{t("Set a realistic spending limit for a category. We’ll calculate your progress from your transactions.")}</p><Field label={t("Category")}><FormSelect name="category" label={t("Category")} defaultValue={budget?.category || available[0]?.name} placeholder={t("No categories available")} options={available.map(c => ({ value: c.name, label: categoryLabel(c.name, language), icon: <CategoryIcon name={c.name} icon={c.icon} small /> }))} /></Field><Field label={t("Budget limit ({currency})", { currency })}><AmountInput name="limit" required defaultValue={budget?.limit} /></Field>{!available.length && <p className="text-sm text-negative">{t("Every expense category already has a budget.")}</p>}<div className="flex justify-end gap-3 border-t border-line pt-5"><Button secondary type="button" onClick={onClose}>{t("Cancel")}</Button><Button disabled={!available.length}>{t("Save budget")}</Button></div></form></Modal>;
}
export function Categories({ categories, rows, onAdd, onEdit, onDelete }: { categories: Category[]; rows: Transaction[]; onAdd: () => void; onEdit: (c: Category) => void; onDelete: (c: Category) => void }) {
  const { t } = useLanguage();
  const [filter, setFilter] = useState('All');
  const shown = categories.filter(c => filter === 'All' || c.type === filter);
  const pager = usePagination(shown, 9, filter);
  return <div className="space-y-5"><div className="flex items-center justify-between gap-4"><div role="tablist" aria-label={t("Category type")} className="flex rounded-lg border border-line bg-surface p-1">{['All', 'Expense', 'Income'].map(f => <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={`min-h-11 rounded-md px-5 text-sm ${filter === f ? 'bg-line text-ink' : 'text-muted hover:text-ink'}`}>{t(f)}</button>)}</div><Button onClick={onAdd}><Plus className="h-4 w-4" />{t("New category")}</Button></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{pager.items.map(c => <Card className="p-5" key={c.name}><div className="flex items-center gap-3"><CategoryIcon name={c.name} icon={c.icon} /><div className="flex-1"><h2 className="text-[1rem] font-semibold">{c.name}</h2><p className="mt-1 text-xs text-muted">{t(c.type === 'Income' ? 'Income category' : 'Expense category')}</p></div>{!c.isSystem && <><IconButton icon={Pencil} label={t('Edit {name}', { name: c.name })} onClick={() => onEdit(c)} /><IconButton icon={Trash2} label={t('Delete {name}', { name: c.name })} onClick={() => onDelete(c)} /></>}</div><div className="mt-5 flex justify-between border-t border-line pt-4"><span className="text-sm text-muted">{t('{count} transactions', { count: rows.filter(row => row.category === c.name).length })}</span><span className="text-sm font-medium tabular-nums">{money(rows.filter(t => t.category === c.name).reduce((s, t) => s + t.amount, 0))}</span></div></Card>)}</div><Pagination pager={pager} sizes={[9, 18, 36]} className="glass rounded-2xl" /></div>;
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
export function Reports({ rows, allRows, previous, categories, onExport, hidden = false }: {
  rows: Transaction[]; allRows: Transaction[]; previous: Transaction[]; categories: Category[];
  onExport: (r: Transaction[]) => void; hidden?: boolean;
}) {
  const { t } = useLanguage();
  const totals = getTotals(rows), p = getTotals(previous), trends = monthlyData(allRows);
  return <div className="space-y-5">
    <SummaryCards totals={totals} previous={p} hidden={hidden} />
    <div className="grid gap-5 xl:grid-cols-2">
      <Card className="p-5">
        <SectionHead title={t("Income & expense trends")} subtitle={t("Your last six months at a glance.")} />
        <div className="mb-3 flex gap-4 text-xs text-muted">
          <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-sm bg-positive" />{t("Income")}</span>
          <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-sm bg-negative" />{t("Expenses")}</span>
        </div>
        <Suspense fallback={<ChartSlot height={225} />}><TrendChart data={trends} /></Suspense>
      </Card>
      <Card className="p-5"><SectionHead title={t("Monthly cash flow")} subtitle={t("Track how much you keep each month.")} /><Suspense fallback={<ChartSlot height={225} />}><TrendChart data={trends} line /></Suspense></Card>
      <Card className="p-5"><SectionHead title={t("Spending by category")} subtitle={t("Selected period breakdown")} /><Suspense fallback={<ChartSlot height={210} />}><ExpenseDonut transactions={rows} categories={categories} /></Suspense></Card>
      <Card className="p-5">
        <SectionHead title={t("Period comparison")} subtitle={t("Selected period vs. the preceding equivalent period")} />
        <div className="space-y-5">{[
          { name: 'Income', current: totals.income, prev: p.income },
          { name: 'Expenses', current: totals.expense, prev: p.expense },
          { name: 'Net savings', current: totals.savings, prev: p.savings },
        ].map(r => <div key={r.name} className="flex justify-between gap-3 border-b border-line pb-4">
          <div><p className="text-sm">{t(r.name)}</p><p className="mt-1 text-xs text-muted">{t("Previously") + ' '}{money(r.prev)}</p></div>
          <div className="text-right"><p className="text-sm font-semibold">{money(r.current)}</p><p className={`mt-1 text-xs ${(r.name === 'Expenses' ? r.current <= r.prev : r.current >= r.prev) ? 'text-positive' : 'text-negative'}`}>{percentChange(r.current, r.prev).toFixed(1)}%</p></div>
        </div>)}
          <div className="flex justify-between"><span className="text-sm text-muted">{t("Savings rate")}</span><span className="text-lg font-semibold text-positive">{totals.rate.toFixed(1)}%</span></div>
        </div>
      </Card>
    </div>
    <div className="flex justify-end"><Button secondary onClick={() => onExport(rows)}><Download className="h-4 w-4" />{t("Export financial report")}</Button></div>
  </div>;
}
