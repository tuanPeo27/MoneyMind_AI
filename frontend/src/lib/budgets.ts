import { localDate, type Budget, type Transaction } from '../data';

// Pure budget figures for the Budgets page: per-category status, totals and an end-of-period forecast.
// No chart library here, so the page can compute everything before recharts arrives.

/** ok = on track, watch = past the alert threshold, near = 90%+ or on pace to go over, over = past the limit. */
export type BudgetStatus = 'ok' | 'watch' | 'near' | 'over';
export type BudgetLine = { budget: Budget; spent: number; left: number; used: number; status: BudgetStatus; projected: number | null };
/**
 * projected: today is inside the period and at least 25% of it has passed (the same rule as Smart Insights' budget
 * pace), so spending so far is extrapolated. ended: the period is over, the "forecast" is the actual total.
 * early: too little of the period has passed to extrapolate. future: the period has not started.
 */
export type ForecastState = 'projected' | 'ended' | 'early' | 'future';
export type BudgetSummary = {
  lines: BudgetLine[]; limit: number; spent: number; left: number; used: number;
  /** Share of the period that has passed (0–1), null when the period has not started. */
  elapsed: number | null; days: number; daysPassed: number;
  forecast: ForecastState; projected: number | null;
};

export const MIN_ELAPSED_FOR_FORECAST = 0.25;
const NEAR_PERCENT = 90;
const dayMs = 86_400_000;
const at = (iso: string) => new Date(iso + 'T12:00:00');
const daysBetween = (a: string, b: string) => Math.round((at(b).getTime() - at(a).getTime()) / dayMs);
const ORDER: Record<BudgetStatus, number> = { over: 0, near: 1, watch: 2, ok: 3 };

export function summarizeBudgets(budgets: Budget[], rows: Transaction[], range: { start: string; end: string }, today: string): BudgetSummary {
  const days = daysBetween(range.start, range.end) + 1;
  const daysPassed = today < range.start ? 0 : today > range.end ? days : daysBetween(range.start, today) + 1;
  const elapsed = today < range.start ? null : daysPassed / days;
  const forecast: ForecastState = elapsed === null ? 'future' : today > range.end ? 'ended' : elapsed >= MIN_ELAPSED_FOR_FORECAST ? 'projected' : 'early';
  const spentBy = new Map<string, number>();
  for (const t of rows) if (t.type === 'Expense') spentBy.set(t.category, (spentBy.get(t.category) ?? 0) + t.amount);

  const lines = budgets.map(budget => {
    const spent = spentBy.get(budget.category) ?? 0;
    const used = budget.limit > 0 ? spent / budget.limit * 100 : spent > 0 ? Infinity : 0;
    const projected = forecast === 'projected' ? spent / elapsed! : forecast === 'ended' ? spent : null;
    const status: BudgetStatus = spent > budget.limit ? 'over'
      : used >= NEAR_PERCENT || (forecast === 'projected' && projected! > budget.limit && spent > 0) ? 'near'
        : used >= (budget.alertThreshold ?? 80) ? 'watch' : 'ok';
    return { budget, spent, left: budget.limit - spent, used, status, projected };
  }).sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.used - a.used);

  const limit = lines.reduce((s, l) => s + l.budget.limit, 0), spent = lines.reduce((s, l) => s + l.spent, 0);
  return {
    lines, limit, spent, left: limit - spent, used: limit > 0 ? spent / limit * 100 : 0,
    elapsed, days, daysPassed, forecast,
    // An extrapolation: rounded to 1.000 ₫ so it does not read as an exact figure.
    projected: forecast === 'projected' ? Math.round(spent / elapsed! / 1000) * 1000 : forecast === 'ended' ? spent : null,
  };
}

export type TrendPoint = { key: string; label: string; actual?: number; pace: number; forecast?: number };

/**
 * Spending in the budgeted categories against the budget.
 * month: running total for each day of the period, the even pace that would land exactly on the limit, and (while
 *   the period runs) the forecast from today to the end at the current daily rate.
 * week: each of the last 7 days (ending today, or the period's end) against the daily allowance (limit / days).
 * Returns null when the period has not started.
 */
export function budgetTrend(mode: 'month' | 'week', summary: BudgetSummary, allRows: Transaction[], categories: Set<string>, range: { start: string; end: string }, today: string, locale: string): TrendPoint[] | null {
  if (summary.elapsed === null) return null;
  const last = today < range.end ? today : range.end;
  const daily = new Map<string, number>();
  for (const t of allRows) if (t.type === 'Expense' && categories.has(t.category)) daily.set(t.date, (daily.get(t.date) ?? 0) + t.amount);

  if (mode === 'week') {
    const allowance = summary.limit / summary.days;
    return Array.from({ length: 7 }, (_, i) => {
      const d = at(last); d.setDate(d.getDate() - (6 - i));
      const key = localDate(d);
      return { key, label: d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric' }), actual: daily.get(key) ?? 0, pace: allowance };
    });
  }

  const points: TrendPoint[] = [];
  const rate = summary.forecast === 'projected' ? summary.spent / summary.daysPassed : 0;
  let running = 0;
  for (let i = 0; i < summary.days; i++) {
    const d = at(range.start); d.setDate(d.getDate() + i);
    const key = localDate(d);
    const point: TrendPoint = { key, label: d.toLocaleDateString(locale, { day: 'numeric', month: 'numeric' }), pace: summary.limit * (i + 1) / summary.days };
    if (key <= last) { running += daily.get(key) ?? 0; point.actual = running; }
    // The forecast starts at today's actual total so the two lines join.
    if (summary.forecast === 'projected' && key >= today) point.forecast = summary.spent + rate * daysBetween(today, key);
    points.push(point);
  }
  return points;
}
