import type { Transaction } from '../data';

/** Income, expense and savings for the 6 months ending with `reference`'s month (no chart code, safe to import anywhere). */
export function monthlyData(transactions: Transaction[], reference = new Date()) {
  return Array.from({ length: 6 }, (_, i) => {
    const date = new Date(reference.getFullYear(), reference.getMonth() - 5 + i, 1);
    const list = transactions.filter(t => new Date(t.date).getMonth() === date.getMonth() && new Date(t.date).getFullYear() === date.getFullYear());
    const income = list.filter(t => t.type === 'Income').reduce((s, t) => s + t.amount, 0);
    const expense = list.filter(t => t.type === 'Expense').reduce((s, t) => s + t.amount, 0);
    return { name: date.toLocaleDateString('en', { month: 'short' }), income, expense, savings: income - expense, date: date.getTime() };
  });
}
