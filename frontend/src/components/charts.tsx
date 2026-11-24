import { displayCurrency, percent } from '../lib/currency';
import { useLanguage } from '../i18n';
import { useId, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, AreaChart, Area, PieChart, Pie, Cell, Sector } from 'recharts';
import type { PieSectorDataItem } from 'recharts/types/polar/Pie';
import { money, compact, type Transaction, type Category } from '../data';

const tooltip = { backgroundColor: 'var(--color-popover)', border: '1px solid var(--color-line)', borderRadius: 8, color: 'var(--color-ink)', fontSize: 12 };
export { monthlyData } from '../lib/chartData';
import type { monthlyData } from '../lib/chartData';
export function TrendChart({ data, line = false, height = 225 }: { data: ReturnType<typeof monthlyData>; line?: boolean; height?: number }) {
  const id = useId();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const axes = <>
    <CartesianGrid stroke="var(--color-line)" vertical={false} strokeDasharray="3 5" />
    <XAxis dataKey="name" tick={{ fill: 'var(--color-muted)', fontSize: 12 }} axisLine={false} tickLine={false} dy={8} />
    <YAxis tickFormatter={compact} tick={{ fill: 'var(--color-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
    <Tooltip animationDuration={150} contentStyle={tooltip} itemStyle={{ color: 'var(--color-ink)' }} formatter={(v: number) => money(v)} cursor={{ fill: 'var(--color-line)', fillOpacity: 0.4 }} />
  </>;
  return <div className="w-full min-w-0" style={{ height }} role="img" aria-label={`${line ? 'Cash flow' : 'Income and expenses'}: ${data.map(d => `${d.name}, income ${money(d.income)}, expenses ${money(d.expense)}`).join('; ')}`}>
    <ResponsiveContainer width="100%" height="100%">{line
      ? <AreaChart data={data} margin={{ top: 12, right: 8, left: -14, bottom: 0 }}>{axes}<defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.18} /><stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0} /></linearGradient></defs><Area type="monotone" dataKey="savings" name="Net cash flow" stroke="var(--color-brand)" fill={`url(#${id})`} strokeWidth={2} isAnimationActive={!reduced} activeDot={{ r: 4, strokeWidth: 3, stroke: 'var(--color-popover)' }} /></AreaChart>
      : <BarChart data={data} barGap={5} margin={{ top: 12, right: 0, left: -14, bottom: 0 }}>{axes}<Bar dataKey="income" name="Income" fill="var(--color-positive)" fillOpacity={0.85} radius={[3, 3, 0, 0]} maxBarSize={height > 300 ? 34 : 20} isAnimationActive={!reduced} /><Bar dataKey="expense" name="Expenses" fill="var(--color-negative)" fillOpacity={0.85} radius={[3, 3, 0, 0]} maxBarSize={20} isAnimationActive={!reduced} /></BarChart>}
    </ResponsiveContainer>
  </div>;
}
export function ExpenseDonut({ transactions, categories, size = 174 }: { transactions: Transaction[]; categories: Category[]; size?: number }) {
  const { t } = useLanguage();
  const [active, setActive] = useState<number | null>(null);
  const values = categories.filter(c => c.type === 'Expense').map(c => ({ name: c.name, value: transactions.filter(t => t.type === 'Expense' && t.category === c.name).reduce((s, t) => s + t.amount, 0) })).filter(c => c.value > 0).sort((a, b) => b.value - a.value);
  const data = [...values.slice(0, 4), ...(values.length > 4 ? [{ name: 'Other', value: values.slice(4).reduce((s, c) => s + c.value, 0) }] : [])];
  const total = data.reduce((s, c) => s + c.value, 0);
  const colors = ['var(--color-brand)', 'var(--color-chart-secondary)', 'var(--color-chart-tertiary)', 'var(--color-positive)', 'var(--color-negative)'];
  const current = active !== null ? data[active] : undefined;
  // The hovered slice grows outward; the legend row (and center label) follow the same index in both directions.
  const renderActive = (props: PieSectorDataItem) => <Sector {...props} outerRadius={(props.outerRadius ?? 80) + size * 0.04} innerRadius={(props.innerRadius ?? 61) - 1} />;
  return <div className={size > 200 ? 'flex w-full flex-col items-center justify-center gap-8 md:flex-row md:gap-16' : 'flex w-full flex-col items-center justify-center gap-4 sm:flex-row lg:flex-col xl:flex-row xl:gap-3'} onMouseLeave={() => setActive(null)}>
    <div role="img" aria-label={`Expenses ${money(total)}. ${data.map(c => `${c.name}: ${money(c.value)}`).join(', ')}`} className="relative shrink-0 [&_.recharts-surface]:overflow-visible [&_.recharts-wrapper]:!overflow-visible" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={total ? data : [{ name: 'No expenses', value: 1 }]} dataKey="value" innerRadius={size * 0.35} outerRadius={size * 0.46} paddingAngle={3} stroke="none" startAngle={90} endAngle={-270}
        activeIndex={total && active !== null ? active : undefined} activeShape={renderActive}
        onMouseEnter={(_, index) => { if (total) setActive(index); }} onMouseLeave={() => setActive(null)}
        isAnimationActive={!window.matchMedia('(prefers-reduced-motion: reduce)').matches}>{(total ? data : [null]).map((c, i) => <Cell key={c?.name || 'empty'} fill={total ? colors[i] : 'var(--color-line)'} fillOpacity={active === null || active === i ? 1 : 0.35} className={total && i === 0 ? 'donut-top-glow' : undefined} style={{ transition: 'fill-opacity 200ms ease-out', outline: 'none', ...(total && i === 0 ? { '--glow': colors[0] } as React.CSSProperties : {}) }} />)}</Pie></PieChart></ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        <span className="max-w-full truncate text-xs text-muted">{current ? current.name : t("Total spent")}</span>
        <span className="mt-1 font-semibold tracking-tight transition-transform duration-200" style={{ fontSize: size > 200 ? 38 : 25, transform: current ? 'scale(1.06)' : undefined }}>{compact(current ? current.value : total)}</span>
        <span className="mt-0.5 text-xs text-muted">{current ? percent(current.value, total) : displayCurrency()}</span>
      </div>
    </div>
    <div className="w-full min-w-0 flex-1 space-y-1">{data.map((c, i) => {
      const on = active === i, dim = active !== null && !on, top = i === 0 && !!total && active === null;
      return <div key={c.name} tabIndex={0} onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
        style={on ? { backgroundColor: `color-mix(in oklab, ${colors[i]} 16%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${colors[i]} 45%, transparent), 0 10px 26px -14px ${colors[i]}` } : top ? { backgroundImage: `radial-gradient(120% 160% at 0% 50%, color-mix(in oklab, ${colors[0]} 30%, transparent), transparent 72%)`, '--glow': colors[0] } as React.CSSProperties : undefined}
        className={`flex origin-left cursor-default items-center justify-between gap-2 rounded-xl px-3 py-2 outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out focus-visible:ring-2 focus-visible:ring-brand motion-reduce:transition-none ${on ? 'scale-[1.07] opacity-100' : 'scale-100'} ${dim ? 'opacity-45' : ''} ${top ? 'donut-top-row' : ''} ${size > 250 ? 'py-3' : ''}`}>
        <span className={`flex min-w-0 items-center gap-2 text-sm transition-colors ${on ? 'font-semibold text-ink' : 'text-muted'}`}><span className={`shrink-0 rounded-full transition-all duration-200 ${on ? 'h-2.5 w-2.5' : 'h-1.5 w-1.5'}`} style={{ backgroundColor: colors[i] }} /><span className="truncate">{c.name}</span>{i === 0 && total > 0 && <span className="shrink-0 rounded-full bg-gradient-to-r from-[#8B5CF6] to-[#EC4899] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">{t("Highest")}</span>}</span>
        <div className="shrink-0 text-right"><p className={`text-xs tabular-nums ${on ? 'font-semibold' : 'font-medium'}`}>{money(c.value)}</p><p className="mt-0.5 text-xs tabular-nums text-muted">{percent(c.value, total)}</p></div>
      </div>;
    })}{!total && <p className="text-sm text-muted">{t("No expenses in this period.")}</p>}</div>
  </div>;
}