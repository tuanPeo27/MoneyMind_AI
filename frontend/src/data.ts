import type { CategoryIconId } from './components/CategoryIcon';

export type Page = 'Overview' | 'Accounts' | 'Transactions' | 'Budgets' | 'Categories' | 'Reports' | 'AI Financial Assistant' | 'Smart Insights' | 'Settings' | 'Workspace' | 'Notifications';
export type Transaction = {
  id: string; description: string; amount: number; type: 'Income' | 'Expense';
  category: string; account: string; date: string; notes: string;
  /** Id of the account (wallet) the transaction belongs to. Missing only for rows not yet saved. */
  accountId?: string;
};
// `category` and `account` hold display names; the API ids are resolved by name when saving.
export type Budget = {
  id: string; category: string; limit: number;
  /** Date range and alert level kept from the server so edits do not reset them. */
  startDate?: string; endDate?: string; alertThreshold?: number;
};
export type Category = { id?: string; name: string; type: 'Income' | 'Expense'; color: string; icon?: CategoryIconId; isSystem?: boolean };
// Amounts are stored in VND; these format them in the display currency (VND in Vietnamese, USD in English).
export { money, compact } from './lib/currency';
export const dateLabel = (value: string, locale = 'en-GB') => new Date(value + 'T12:00:00').toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
export function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export const today = localDate(new Date());
export const initialCategories: Category[] = [
  { name: 'Ăn uống', type: 'Expense', color: '#3B82F6' },
  { name: 'Nhà ở', type: 'Expense', color: '#9CA3AF' },
  { name: 'Mua sắm', type: 'Expense', color: '#8B5CF6' },
  { name: 'Di chuyển', type: 'Expense', color: '#34D399' },
  { name: 'Hóa đơn', type: 'Expense', color: '#F87171' },
  { name: 'Giải trí', type: 'Expense', color: '#EC4899' },
  { name: 'Khác', type: 'Expense', color: '#6B7280' },
  { name: 'Lương', type: 'Income', color: '#34D399' },
  { name: 'Đầu tư', type: 'Income', color: '#3B82F6' },
];
export const initialBudgets: Budget[] = [
  { id: 'b1', category: 'Ăn uống', limit: 4500000 },
  { id: 'b2', category: 'Mua sắm', limit: 4000000 },
  { id: 'b3', category: 'Di chuyển', limit: 2500000 },
  { id: 'b4', category: 'Giải trí', limit: 2000000 },
];
export function seedTransactions(): Transaction[] {
  const now = new Date();
  const samples = [
    ['Cà phê & ăn trưa · The Coffee House', 365000, 'Ăn uống', 'MoMo', 0],
    ['Mua sắm tại Uniqlo', 2650000, 'Mua sắm', 'Vietcombank', 1],
    ['Lương tháng này · Công ty ABC', 30000000, 'Lương', 'Vietcombank', 2],
    ['Grab & xăng xe', 1500000, 'Di chuyển', 'MoMo', 3],
    ['Cổ tức đầu tư', 2500000, 'Đầu tư', 'Vietcombank', 4],
    ['Ăn uống & đi chợ', 3485000, 'Ăn uống', 'Vietcombank', 5],
    ['Tiền thuê nhà', 5000000, 'Nhà ở', 'Vietcombank', 6],
    ['Điện, nước & Internet', 2400000, 'Hóa đơn', 'Vietcombank', 7],
    ['Netflix, Spotify & xem phim', 1350000, 'Giải trí', 'MoMo', 8],
    ['Chi phí cá nhân khác', 1500000, 'Khác', 'Tiền mặt', 9],
  ] as const;
  return Array.from({ length: 6 }, (_, m) => samples.map(([description, amount, category, account, offset], i) => {
    const date = new Date(now.getFullYear(), now.getMonth() - m, Math.max(1, now.getDate() - offset));
    const type = category === 'Lương' || category === 'Đầu tư' ? 'Income' : 'Expense';
    const factor = m === 0 ? 1 : type === 'Income' ? [1, 0.94, 0.89, 0.98, 0.85, 0.92][m] : [1, 0.88, 1.1, 0.84, 0.94, 0.79][m];
    return { id: `t-${m}-${i}`, description, amount: Math.round(amount * factor / 1000) * 1000, category, account, type, date: localDate(date), notes: '' } as Transaction;
  })).flat();
}
export function usePeriodRange(period: string, custom: { start: string; end: string }) {
  const now = new Date();
  if (period === 'Custom') return custom;
  const offset = period === 'Last month' ? 1 : 0;
  return {
    start: localDate(new Date(now.getFullYear(), period === 'This year' ? 0 : now.getMonth() - offset, 1)),
    end: localDate(new Date(now.getFullYear(), now.getMonth() - offset + 1, 0)),
  };
}
