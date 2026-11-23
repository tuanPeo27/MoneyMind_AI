import { money, type Transaction, type Budget } from '../../data';
import { displayCurrency, fromDisplay, vndPerUsd } from '../../lib/currency';

export type Highlight = 'summary' | 'cashflow' | 'expenses' | 'transactions' | 'budgets' | null;
export type FinancialContext = {
  route: string;
  page: string;
  period: string;
  range: { start: string; end: string };
  rows: Transaction[];
  previous: Transaction[];
  budgets: Budget[];
  selection?: { transaction?: Transaction; category?: string };
  platform?: { users: number; active: number; requests: number; volume: number };
  metrics?: { income: number; expense: number; savings: number; balance: number; rate: number };
};
export type AIResponse = {
  text: string;
  highlight?: Highlight;
  metrics?: { label: string; value: string }[];
};
export const emptyContext: FinancialContext = {
  route: '/', page: 'Overview', period: 'This month',
  range: { start: '', end: '' }, rows: [], previous: [], budgets: [],
};
export function getPrompts(page: string) {
  if (page.startsWith('Admin') || page === 'User Management' || page === 'AI Usage & Analytics')
    return ['Summarize platform activity.', 'Explain the AI usage metrics.', 'What should an administrator review?'];
  const prompts: Record<string, string[]> = {
    Transactions: ['Analyze my largest expenses.', 'Find unusual transactions.', 'Where is my money going?'],
    Budgets: ['Which budget is close to its limit?', 'Help me reduce spending.', 'Help me optimize my budget.'],
    Reports: ['Compare my income and expenses.', 'Explain my spending trends.', 'How has my savings rate changed?'],
    Categories: ['Where is my money going?', 'Which category costs the most?', 'Help me reduce dining expenses.'],
    Settings: ['How is my data stored?', 'How can I save more money?', 'Give me a financial health summary.'],
  };
  return prompts[page] || ['Give me a financial health summary.', 'Where is my money going?', 'Can I afford this purchase?', 'Help me optimize my budget.'];
}
const sum = (rows: Transaction[], type: string) => rows.filter(t => t.type === type).reduce((s, t) => s + t.amount, 0);

/** Deterministic local demo adapter. No model, network request, or secret is used. */
export function simulateFinancialResponse(question: string, context: FinancialContext, followUp?: Highlight): AIResponse {
  const { rows, previous, budgets } = context;
  const q = question.toLowerCase();
  const income = sum(rows, 'Income'), expense = sum(rows, 'Expense'), savings = income - expense;
  const rate = income ? savings / income * 100 : 0;
  if (context.route.startsWith('/admin')) {
    const p = context.platform;
    return {
      text: p ? `This is platform-wide demo data, not your personal finances. ${p.users} registered users include ${p.active} active accounts. The sample AI log contains ${p.requests} requests. Review inactive accounts and unsuccessful AI requests first. No live service or monitoring is connected.` : 'You are in the administration workspace. These are local demonstration records, not live platform data. User access changes require backend authorization in a production application.',
      metrics: p ? [{ label: 'Platform users', value: String(p.users) }, { label: 'AI requests', value: String(p.requests) }, { label: 'Demo financial volume', value: money(p.volume) }] : undefined,
    };
  }
  if (/stored|privacy|data storage/.test(q)) return { text: 'Your transactions, budgets, preferences, and this conversation are stored in localStorage in this browser. Nothing is sent to an AI provider. Clearing browser data removes this demo data. Frontend role checks are not real authorization.' };
  if (context.selection?.transaction && /this|selected|transaction/.test(q)) {
    const t = context.selection.transaction;
    return { text: `The selected transaction “${t.description}” is ${money(t.amount)} in ${t.category}, recorded on ${t.date} from ${t.account}. ${t.notes ? `Your note: ${t.notes}.` : 'There are no additional notes.'} I cannot verify whether this is fraudulent; check the original receipt or bank statement.`, highlight: 'transactions', metrics: [{ label: t.category, value: money(t.amount) }] };
  }
  if (!rows.length) return { text: 'There are no transactions in your selected date range. Change the date filter or add a transaction to get a useful analysis.', highlight: 'transactions' };
  if (/afford|purchase|mua/.test(q) || (/\d/.test(q) && followUp === 'summary')) {
    const match = q.match(/(\d[\d,.]*)\s*(m|million|triệu|k|nghìn|vnd|₫|usd)?/);
    const unit = match?.[2] || '';
    const scaled = match ? Number(match[1].replace(/,/g, '')) * (/^(m|million|triệu)$/.test(unit) ? 1000000 : /^(k|nghìn)$/.test(unit) ? 1000 : 1) : 0;
    // A number without an explicit VND unit is in the display currency (USD in English), stored amounts are VND.
    const amount = unit === 'usd' ? Math.round(scaled * vndPerUsd())
      : /^(vnd|₫|triệu|nghìn)$/.test(unit) || displayCurrency() === 'VND' ? scaled : fromDisplay(scaled);
    return { text: amount ? `A ${money(amount)} purchase would leave ${money(savings - amount)} of your selected-period net income. ${amount <= Math.max(0, savings) * 0.3 ? 'It fits within 30% of that surplus, but check upcoming bills first.' : 'It would use a significant share of your surplus. Consider waiting or saving toward it.'} This simple estimate does not account for debt or future obligations.` : `You have ${money(savings)} in net income this period. What is the purchase price? For example, ask “Can I afford 3 million VND?” This demo uses your current cash flow, not a credit or investment assessment.`, highlight: 'summary', metrics: [{ label: 'Period surplus', value: money(savings) }] };
  }
  if (/budget|limit|reduce spending|ngân sách/.test(q) || (followUp === 'budgets' && /why|how|more/.test(q))) {
    const ranked = budgets.map(b => ({ ...b, spent: rows.filter(t => t.type === 'Expense' && t.category === b.category).reduce((s, t) => s + t.amount, 0) })).sort((a, b) => b.spent / b.limit - a.spent / a.limit);
    const b = ranked[0];
    return { text: b ? `${b.category} is closest to its limit: ${money(b.spent)} of ${money(b.limit)} (${(b.spent / b.limit * 100).toFixed(0)}%). ${b.spent > b.limit ? `It is ${money(b.spent - b.limit)} over budget.` : `You have ${money(b.limit - b.spent)} left.`} Try a weekly spending cap before increasing the limit.` : 'You have no category budgets yet. A 50/30/20 split can be a starting point: 50% needs, 30% wants, 20% savings. Create a budget and adjust it to your fixed costs.', highlight: 'budgets', metrics: b ? [{ label: `${b.category} used`, value: `${(b.spent / b.limit * 100).toFixed(0)}%` }, { label: 'Remaining', value: money(b.limit - b.spent) }] : undefined };
  }
  if ((!/compar|trend/.test(q) && /dining|increas|expense|where|category|unusual|spending|chi tiêu/.test(q)) || (followUp === 'expenses' && /why|how|more/.test(q))) {
    const categories = [...new Set(rows.filter(t => t.type === 'Expense').map(t => t.category))].map(name => ({ name, value: rows.filter(t => t.category === name && t.type === 'Expense').reduce((s, t) => s + t.amount, 0) })).sort((a, b) => b.value - a.value);
    const category = /dining/.test(q) ? 'Ăn uống' : context.selection?.category || categories[0]?.name;
    const current = categories.find(c => c.name === category)?.value || 0;
    const old = previous.filter(t => t.category === category && t.type === 'Expense').reduce((s, t) => s + t.amount, 0);
    const change = old ? (current - old) / old * 100 : null;
    const largest = [...rows].filter(t => t.type === 'Expense').sort((a, b) => b.amount - a.amount)[0];
    if (/unusual|largest/.test(q)) return { text: largest ? `Your largest recorded expense is “${largest.description}” at ${money(largest.amount)}. It represents ${expense ? (largest.amount / expense * 100).toFixed(1) : 0}% of spending this period. A large amount alone is not evidence of unusual activity; confirm it against a receipt. This demo does not run fraud detection.` : 'No expense transactions are available.', highlight: 'transactions', metrics: largest ? [{ label: 'Largest expense', value: money(largest.amount) }] : [] };
    return { text: `${category || 'Spending'} accounts for ${money(current)}${change !== null ? `, ${Math.abs(change).toFixed(1)}% ${change >= 0 ? 'higher' : 'lower'} than the preceding period` : '; there is no previous-period comparison'}. ${expense ? `That is ${(current / expense * 100).toFixed(0)}% of your total expenses.` : ''} Check the category breakdown, then consider a realistic 10% reduction rather than cutting essentials.`, highlight: 'expenses', metrics: [{ label: category || 'Expenses', value: money(current) }, { label: 'Potential 10% reduction', value: money(current * 0.1) }] };
  }
  if (/compar|trend|income/.test(q)) return { text: `Income is ${money(income)} and expenses are ${money(expense)} in this period. Previous-period expenses were ${money(sum(previous, 'Expense'))}. You retained ${rate.toFixed(1)}% of income. Compare equivalent periods before drawing conclusions.`, highlight: 'cashflow', metrics: [{ label: 'Income', value: money(income) }, { label: 'Expenses', value: money(expense) }] };
  return { text: `You earned ${money(income)} and spent ${money(expense)}, leaving ${money(savings)} this period. Your savings rate is ${rate.toFixed(1)}%. ${rate >= 20 ? 'You are above the illustrative 20% savings target.' : 'Review flexible spending before changing essential expenses.'} ${/sav/.test(q) ? 'Consider moving a manageable amount into savings after payday.' : 'Ask me about a category, a budget, or a purchase to explore further.'}`, highlight: 'summary', metrics: [{ label: 'Net savings', value: money(savings) }, { label: 'Savings rate', value: `${rate.toFixed(1)}%` }] };
}
