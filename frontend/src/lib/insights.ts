import type { Budget, Transaction } from '../data';
import { getTotals, percentChange, type Totals } from './totals';

/**
 * Rule-based analysis behind the Smart Insights page. Every finding is computed from the user's own transactions
 * and budgets in the selected period (and the period before it). Nothing is estimated by a language model and no
 * figure is invented: a rule that lacks the data it needs produces no finding at all.
 */
export type Severity = 'alert' | 'caution' | 'opportunity' | 'trend';
/** A translation key (English source text) plus already formatted values. */
export type Text = { key: string; values?: Record<string, string | number> };
export type InsightAction =
  | { kind: 'transactions'; search: string }
  | { kind: 'edit'; transaction: Transaction }
  | { kind: 'budgets' }
  | { kind: 'create-budget'; category: string }
  | { kind: 'page'; page: 'Reports' | 'Savings Funds' };
export type Insight = {
  id: string; severity: Severity; title: Text;
  /** Figures the finding rests on, shown as label / value pairs. */
  evidence: { label: string; value: string }[];
  why: Text; impact: Text;
  action: { label: string; to: InsightAction };
  /** Question sent to the AI assistant ("Ask AI about this"), with this finding's figures in it. */
  ask: Text;
  /** VND at stake, to order findings of the same severity. */
  weight: number;
};
export type Analysis = {
  enough: boolean; hasPrevious: boolean;
  totals: Totals; previous: Totals;
  status: 'action' | 'watch' | 'ok';
  headline: Text;
  insights: Insight[];
};
export type Formatters = { money: (vnd: number) => string; date: (iso: string) => string };

/** Fewer transactions than this in the period: no briefing or findings, only an empty state. */
export const MIN_TRANSACTIONS = 3;
const SEVERITY_ORDER: Record<Severity, number> = { alert: 0, caution: 1, opportunity: 2, trend: 3 };
const pct = (n: number) => `${Math.round(n)}%`;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const dayMs = 86_400_000;
const dayOf = (iso: string) => new Date(iso + 'T12:00:00').getTime();
/** Category name as a safe id fragment (used in element ids and #links): "Ăn uống" -> "an-uong". */
const slug = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'category';

function byCategory(rows: Transaction[]) {
  const map = new Map<string, { amount: number; count: number; largest?: Transaction }>();
  for (const t of rows) {
    if (t.type !== 'Expense') continue;
    const entry = map.get(t.category) ?? { amount: 0, count: 0 };
    entry.amount += t.amount; entry.count += 1;
    if (!entry.largest || t.amount > entry.largest.amount) entry.largest = t;
    map.set(t.category, entry);
  }
  return map;
}

export type UnusualExpense = { t: Transaction; usual: number; count: number };
/**
 * Unusually large expenses in `rows`: at least 3x the median of the same category's expenses in the 180 days before
 * it (needs 5+ of them, taken from `allRows`), and at least 10% of the period's spending. Largest ratio first.
 * Shared by Smart Insights and the Transactions page so both flag the same transactions.
 */
export function unusualExpenses(rows: Transaction[], allRows: Transaction[]): UnusualExpense[] {
  const expense = rows.reduce((s, t) => t.type === 'Expense' ? s + t.amount : s, 0);
  const history = new Map<string, { id: string; day: number; amount: number }[]>();
  for (const h of allRows) if (h.type === 'Expense') {
    const list = history.get(h.category) ?? [];
    list.push({ id: h.id, day: dayOf(h.date), amount: h.amount });
    history.set(h.category, list);
  }
  const found: UnusualExpense[] = [];
  for (const t of rows) {
    if (t.type !== 'Expense' || t.amount < expense * 0.1) continue;
    const day = dayOf(t.date);
    const earlier = (history.get(t.category) ?? []).filter(h => h.id !== t.id && h.day < day && day - h.day <= 180 * dayMs).map(h => h.amount);
    if (earlier.length < 5) continue;
    const usual = median(earlier);
    if (usual > 0 && t.amount >= usual * 3) found.push({ t, usual, count: earlier.length });
  }
  return found.sort((a, b) => b.t.amount / b.usual - a.t.amount / a.usual);
}

export function analyse({ rows, previous, allRows, budgets, range, today, fmt }: {
  rows: Transaction[]; previous: Transaction[]; allRows: Transaction[]; budgets: Budget[];
  range: { start: string; end: string }; today: string; fmt: Formatters;
}): Analysis {
  const totals = getTotals(rows), prev = getTotals(previous);
  const enough = rows.length >= MIN_TRANSACTIONS;
  const hasPrevious = previous.length >= MIN_TRANSACTIONS;
  const cats = byCategory(rows), prevCats = byCategory(previous);
  const insights: Insight[] = [];
  const { money, date } = fmt;

  if (enough) {
    // Share of the period that has passed, only when today falls inside it (for budget pace).
    const start = dayOf(range.start), end = dayOf(range.end), now = dayOf(today);
    const elapsed = now >= start && now <= end ? (Math.floor((now - start) / dayMs) + 1) / (Math.floor((end - start) / dayMs) + 1) : null;

    for (const b of budgets) {
      const spent = cats.get(b.category)?.amount ?? 0;
      if (b.limit <= 0) continue;
      const used = spent / b.limit * 100;
      const c = cats.get(b.category);
      // 1. Over budget.
      if (spent > b.limit) {
        insights.push({
          id: `over-${slug(b.category)}`, severity: 'alert', weight: spent - b.limit,
          title: { key: '{category} is over its budget', values: { category: b.category } },
          evidence: [{ label: 'Spent', value: money(spent) }, { label: 'Budget', value: money(b.limit) }, { label: 'Over by', value: money(spent - b.limit) }],
          why: c?.largest
            ? { key: '{count} {category} transactions this period. The largest is “{name}” ({amount}) on {date}.', values: { count: c.count, category: b.category, name: c.largest.description, amount: money(c.largest.amount), date: date(c.largest.date) } }
            : { key: 'Spending in {category} passed the limit you set.', values: { category: b.category } },
          impact: { key: '{amount} over the limit, {percent} of the budget used.', values: { amount: money(spent - b.limit), percent: used > 999 ? '>999%' : pct(used) } },
          action: { label: 'Review transactions', to: { kind: 'transactions', search: b.category } },
          ask: { key: 'My {category} spending is {amount} over budget this period. What can I cut back on?', values: { category: b.category, amount: money(spent - b.limit) } },
        });
        continue;
      }
      // 2. Close to the limit, or on pace to pass it before the period ends.
      const threshold = b.alertThreshold ?? 80;
      const projected = elapsed && elapsed >= 0.25 ? spent / elapsed : null;
      const onPaceToExceed = projected !== null && projected > b.limit;
      if (spent > 0 && (used >= threshold || onPaceToExceed)) {
        insights.push({
          id: `near-${slug(b.category)}`, severity: 'caution', weight: onPaceToExceed ? projected! - b.limit : b.limit - spent,
          title: onPaceToExceed && used < threshold
            ? { key: '{category} is on pace to go over budget', values: { category: b.category } }
            : { key: '{category} has used {percent} of its budget', values: { category: b.category, percent: pct(used) } },
          evidence: [{ label: 'Spent', value: money(spent) }, { label: 'Budget', value: money(b.limit) }, { label: 'Left', value: money(b.limit - spent) }],
          why: projected !== null
            ? { key: '{elapsed} of the period has passed and {used} of the budget is spent. At this pace you would spend about {projected} by {date}.', values: { elapsed: pct(elapsed! * 100), used: pct(used), projected: money(projected), date: date(range.end) } }
            : { key: 'Only {amount} is left in this budget for the period.', values: { amount: money(b.limit - spent) } },
          impact: onPaceToExceed
            ? { key: 'Projected to go over by about {amount}.', values: { amount: money(projected! - b.limit) } }
            : { key: 'You can spend {amount} more before reaching the limit.', values: { amount: money(b.limit - spent) } },
          action: { label: 'Open budgets', to: { kind: 'budgets' } },
          ask: { key: 'I have used {percent} of my {category} budget. How should I pace the rest of the period?', values: { percent: pct(used), category: b.category } },
        });
      }
    }

    // 3. Unusually large expenses: at least 3x the median of the same category's last 180 days (5+ earlier expenses),
    //    and at least 10% of the period's spending.
    const unusual = unusualExpenses(rows, allRows).slice(0, 2);
    for (const { t, usual, count } of unusual) insights.push({
      id: `unusual-${t.id}`, severity: 'alert', weight: t.amount - usual,
      title: { key: 'Unusually large {category} expense', values: { category: t.category } },
      evidence: [{ label: 'Amount', value: money(t.amount) }, { label: 'Usual amount', value: money(usual) }, { label: 'Date', value: date(t.date) }],
      why: { key: '“{name}” is {times}× your usual {category} expense (median of the previous {count} expenses in this category).', values: { name: t.description, times: (t.amount / usual).toFixed(1), category: t.category, count } },
      impact: { key: 'This one expense is {share} of your spending this period.', values: { share: pct(t.amount / totals.expense * 100) } },
      action: { label: 'Check this transaction', to: { kind: 'edit', transaction: t } },
      ask: { key: 'Is the {amount} expense “{name}” on {date} unusual for me?', values: { amount: money(t.amount), name: t.description, date: date(t.date) } },
    });

    // 4. Spending above income, or no income recorded at all.
    const top = [...cats].sort((a, b) => b[1].amount - a[1].amount)[0];
    if (totals.expense > 0 && totals.income === 0) insights.push({
      id: 'no-income', severity: 'caution', weight: totals.expense,
      title: { key: 'No income recorded this period' },
      evidence: [{ label: 'Income', value: money(0) }, { label: 'Expenses', value: money(totals.expense) }],
      why: { key: 'There are {count} expenses this period but no income transaction.', values: { count: rows.filter(t => t.type === 'Expense').length } },
      impact: { key: 'If you did receive income, add it so the balance and savings figures are right.' },
      action: { label: 'Review transactions', to: { kind: 'transactions', search: '' } },
      ask: { key: 'I recorded {amount} of expenses and no income this period. How does that affect my balance?', values: { amount: money(totals.expense) } },
    });
    else if (totals.expense > totals.income) insights.push({
      id: 'deficit', severity: 'alert', weight: totals.expense - totals.income,
      title: { key: 'You spent more than you earned this period' },
      evidence: [{ label: 'Income', value: money(totals.income) }, { label: 'Expenses', value: money(totals.expense) }, { label: 'Gap', value: money(totals.expense - totals.income) }],
      why: top
        ? { key: 'Your largest spending category is {category}: {amount}, {share} of all spending.', values: { category: top[0], amount: money(top[1].amount), share: pct(top[1].amount / totals.expense * 100) } }
        : { key: 'Expenses passed income this period.' },
      impact: { key: 'Your balance went down by {amount} over the period.', values: { amount: money(totals.expense - totals.income) } },
      action: { label: 'Review transactions', to: { kind: 'transactions', search: '' } },
      ask: { key: 'I spent {amount} more than I earned this period. Where can I cut back first?', values: { amount: money(totals.expense - totals.income) } },
    });

    // 5. Largest category without a budget (25%+ of spending, 3+ expenses).
    const budgeted = new Set(budgets.map(b => b.category));
    const uncapped = [...cats].filter(([name, c]) => !budgeted.has(name) && c.count >= 3 && totals.expense > 0 && c.amount / totals.expense >= 0.25)
      .sort((a, b) => b[1].amount - a[1].amount)[0];
    if (uncapped) {
      const [name, c] = uncapped;
      insights.push({
        id: `uncapped-${slug(name)}`, severity: 'opportunity', weight: c.amount,
        title: { key: '{category} takes {share} of your spending and has no budget', values: { category: name, share: pct(c.amount / totals.expense * 100) } },
        evidence: [{ label: 'Spent', value: money(c.amount) }, { label: 'Share of spending', value: pct(c.amount / totals.expense * 100) }, { label: 'Transactions', value: String(c.count) }],
        why: { key: 'It is your largest spending category without a limit.' },
        impact: { key: 'A budget for {category} lets the app warn you before spending passes the amount you choose.', values: { category: name } },
        action: { label: 'Create a budget', to: { kind: 'create-budget', category: name } },
        ask: { key: 'I spent {amount} on {category} this period. Help me set a realistic monthly budget for it.', values: { amount: money(c.amount), category: name } },
      });
    }

    // 6. Money left over (10%+ of income kept), when nothing above calls for attention first.
    if (totals.income > 0 && totals.savings > 0 && totals.rate >= 10) insights.push({
      id: 'surplus', severity: 'opportunity', weight: totals.savings,
      title: { key: 'You kept {amount} of your income this period', values: { amount: money(totals.savings) } },
      evidence: [{ label: 'Income', value: money(totals.income) }, { label: 'Expenses', value: money(totals.expense) }, { label: 'Savings rate', value: pct(totals.rate) }],
      why: { key: 'Income was higher than spending by {amount}.', values: { amount: money(totals.savings) } },
      impact: { key: 'Moving part of it into a savings fund keeps it apart from day-to-day spending.' },
      action: { label: 'Open savings funds', to: { kind: 'page', page: 'Savings Funds' } },
      ask: { key: 'I kept {amount} this period. Help me plan how much to put into savings.', values: { amount: money(totals.savings) } },
    });

    if (hasPrevious) {
      // 7. Categories up 30%+ on the previous period (10%+ of spending), the two largest increases.
      const rising = [...cats].map(([name, c]) => ({ name, c, p: prevCats.get(name) }))
        .filter(x => x.p && x.p.amount > 0 && totals.expense > 0 && x.c.amount >= totals.expense * 0.1 && percentChange(x.c.amount, x.p.amount) >= 30)
        .sort((a, b) => (b.c.amount - b.p!.amount) - (a.c.amount - a.p!.amount)).slice(0, 2);
      for (const { name, c, p } of rising) insights.push({
        id: `rising-${slug(name)}`, severity: 'trend', weight: c.amount - p!.amount,
        title: { key: '{category} spending is up {percent} on the previous period', values: { category: name, percent: pct(percentChange(c.amount, p!.amount)) } },
        evidence: [{ label: 'This period', value: money(c.amount) }, { label: 'Previous period', value: money(p!.amount) }, { label: 'Difference', value: money(c.amount - p!.amount) }],
        why: { key: '{count} transactions this period against {previousCount} before; the average went from {previousAverage} to {average}.', values: { count: c.count, previousCount: p!.count, previousAverage: money(p!.amount / p!.count), average: money(c.amount / c.count) } },
        impact: { key: '{amount} more spent on {category} than in the previous period.', values: { amount: money(c.amount - p!.amount), category: name } },
        action: { label: 'Review transactions', to: { kind: 'transactions', search: name } },
        ask: { key: 'Why did my {category} spending rise from {previous} to {current} compared with the previous period?', values: { category: name, previous: money(p!.amount), current: money(c.amount) } },
      });
      // 8. Savings rate moved 5+ points.
      if (totals.income > 0 && prev.income > 0 && Math.abs(totals.rate - prev.rate) >= 5) {
        const up = totals.rate > prev.rate;
        insights.push({
          id: 'rate', severity: 'trend', weight: Math.abs(totals.savings - prev.savings),
          title: { key: up ? 'Your savings rate rose from {previous} to {current}' : 'Your savings rate fell from {previous} to {current}', values: { previous: pct(prev.rate), current: pct(totals.rate) } },
          evidence: [{ label: 'Saved this period', value: money(totals.savings) }, { label: 'Saved previous period', value: money(prev.savings) }],
          why: { key: 'Income changed by {income} and spending by {expense} against the previous period.', values: { income: signed(percentChange(totals.income, prev.income)), expense: signed(percentChange(totals.expense, prev.expense)) } },
          impact: { key: up ? 'You kept {amount} more than in the previous period.' : 'You kept {amount} less than in the previous period.', values: { amount: money(Math.abs(totals.savings - prev.savings)) } },
          action: { label: 'View report', to: { kind: 'page', page: 'Reports' } },
          ask: { key: 'My savings rate went from {previous} to {current}. What changed and what should I do?', values: { previous: pct(prev.rate), current: pct(totals.rate) } },
        });
      }
    }
  }
  // The surplus note is only useful when nothing more urgent is open.
  const urgent = insights.some(i => i.severity === 'alert');
  const list = insights.filter(i => !(i.id === 'surplus' && urgent))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.weight - a.weight);
  const status = list.some(i => i.severity === 'alert') ? 'action' : list.some(i => i.severity === 'caution') ? 'watch' : 'ok';
  const headline: Text = totals.income === 0
    ? { key: 'No income recorded yet this period · {amount} spent', values: { amount: money(totals.expense) } }
    : totals.expense > totals.income
      ? { key: 'You spent {amount} more than you earned this period', values: { amount: money(totals.expense - totals.income) } }
      : { key: 'You kept {rate} of your income this period', values: { rate: pct(totals.rate) } };
  return { enough, hasPrevious, totals, previous: prev, status, headline, insights: list };
}
function signed(n: number) { return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n))}%`; }
