import { localDate, type Transaction } from '../data';

// Pure cash-flow helpers for the Transactions page (no chart library here, so they stay out of the recharts chunk).

export type FlowWindow = '7d' | '30d' | '6m';
export type FlowPoint = { key: string; label: string; income: number; expense: number; net: number };

const at = (iso: string) => new Date(iso + 'T12:00:00');
const dayMs = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((at(b).getTime() - at(a).getTime()) / dayMs);

/** Income, expense and net per day (7 / 30 days) or per month (6 months), ending on `end` (inclusive). */
export function cashFlowSeries(rows: Transaction[], window: FlowWindow, end: string, locale: string): FlowPoint[] {
  const last = at(end);
  const point = (key: string, label: string): FlowPoint => ({ key, label, income: 0, expense: 0, net: 0 });
  const points = window === '6m'
    ? Array.from({ length: 6 }, (_, i) => {
      const d = new Date(last.getFullYear(), last.getMonth() - 5 + i, 1);
      return point(localDate(d).slice(0, 7), d.toLocaleDateString(locale, { month: 'short' }));
    })
    : Array.from({ length: window === '7d' ? 7 : 30 }, (_, i) => {
      const d = new Date(last); d.setDate(last.getDate() - ((window === '7d' ? 7 : 30) - 1 - i));
      return point(localDate(d), window === '7d'
        ? d.toLocaleDateString(locale, { weekday: 'short' })
        : d.toLocaleDateString(locale, { day: 'numeric', month: 'numeric' }));
    });
  const index = new Map(points.map((p, i) => [p.key, i]));
  for (const t of rows) {
    if (t.date > end) continue;
    const i = index.get(window === '6m' ? t.date.slice(0, 7) : t.date);
    if (i === undefined) continue;
    if (t.type === 'Income') points[i].income += t.amount; else points[i].expense += t.amount;
  }
  for (const p of points) p.net = p.income - p.expense;
  return points;
}

/**
 * Small trend lines for the summary cards: income and expense per bucket, and the running net, over the selected
 * period up to today (days that have not happened yet would otherwise pull every line down to zero).
 * Buckets are days up to 31 days, weeks up to ~4 months, months beyond that.
 */
export function periodSparks(rows: Transaction[], range: { start: string; end: string }, today: string) {
  const end = range.end < today ? range.end : today;
  if (end < range.start) return null;
  const days = daysBetween(range.start, end) + 1;
  const first = at(range.start);
  const bucketOf = days <= 31 ? (d: string) => daysBetween(range.start, d)
    : days <= 124 ? (d: string) => Math.floor(daysBetween(range.start, d) / 7)
      : (d: string) => { const x = at(d); return (x.getFullYear() - first.getFullYear()) * 12 + x.getMonth() - first.getMonth(); };
  const count = bucketOf(end) + 1;
  if (count < 2) return null;
  const income = new Array<number>(count).fill(0), expense = new Array<number>(count).fill(0);
  for (const t of rows) {
    if (t.date < range.start || t.date > end) continue;
    const i = bucketOf(t.date);
    if (t.type === 'Income') income[i] += t.amount; else expense[i] += t.amount;
  }
  let running = 0;
  const net = income.map((v, i) => (running += v - expense[i]));
  return { income, expense, net };
}

/** Rows (already sorted) split into consecutive runs of the same date, with each day's income and expense. */
export function groupByDay(rows: Transaction[]) {
  const groups: { date: string; rows: Transaction[]; income: number; expense: number }[] = [];
  for (const t of rows) {
    let g = groups[groups.length - 1];
    if (!g || g.date !== t.date) { g = { date: t.date, rows: [], income: 0, expense: 0 }; groups.push(g); }
    g.rows.push(t);
    if (t.type === 'Income') g.income += t.amount; else g.expense += t.amount;
  }
  return groups;
}
