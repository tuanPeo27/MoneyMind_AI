import { localDate, seedTransactions, initialCategories, type Transaction, type Category } from '../data';
import { getCategoryIcon, type CategoryIconId } from '../components/CategoryIcon';

export type PlatformUser = {
  id: string; name: string; email: string; registered: string;
  role: 'USER' | 'ADMIN'; active: boolean;
};
const monthDate = (monthsAgo: number, day = 1) => {
  const now = new Date();
  return localDate(new Date(now.getFullYear(), now.getMonth() - monthsAgo, day));
};
export const initialUsers: PlatformUser[] = [
  { id: 'u1', name: 'Trần Quang Minh', email: 'admin@moneymind.demo', registered: monthDate(5), role: 'ADMIN', active: true },
  { id: 'u2', name: 'Nguyễn Minh Chương', email: 'chuong.nguyen@example.com', registered: monthDate(4), role: 'USER', active: true },
  { id: 'u3', name: 'Lê Thu Hà', email: 'ha.le@example.com', registered: monthDate(3), role: 'USER', active: true },
  { id: 'u4', name: 'Phạm Hoàng Nam', email: 'nam.pham@example.com', registered: monthDate(2), role: 'USER', active: false },
  { id: 'u5', name: 'Vũ Ngọc Linh', email: 'linh.vu@example.com', registered: monthDate(1), role: 'USER', active: true },
  { id: 'u6', name: 'Đỗ Anh Tuấn', email: 'tuan.do@example.com', registered: monthDate(0), role: 'USER', active: true },
];
export type PlatformTransaction = Transaction & { userId: string };
export const platformTransactions: PlatformTransaction[] = initialUsers.slice(1).flatMap((u, index) =>
  seedTransactions().slice(0, 4).map((t, i) => ({
    ...t, id: `platform-${index}-${i}`, userId: u.id,
    amount: Math.round(t.amount * (1 + index * 0.15) / 1000) * 1000,
  })),
);
export type SystemCategory = Category & { id: string; icon: CategoryIconId };
export const systemCategories: SystemCategory[] = initialCategories.map((c, i) => ({
  ...c, id: `system-${i}`, icon: getCategoryIcon(c.name, c.icon),
}));
export const aiUsage = [
  { daysAgo: 5, requests: 128, completed: 126, tokens: 98350, latency: 1.2 },
  { daysAgo: 4, requests: 164, completed: 161, tokens: 125100, latency: 1.4 },
  { daysAgo: 3, requests: 142, completed: 140, tokens: 109200, latency: 1.1 },
  { daysAgo: 2, requests: 198, completed: 194, tokens: 151300, latency: 1.5 },
  { daysAgo: 1, requests: 176, completed: 174, tokens: 137500, latency: 1.3 },
  { daysAgo: 0, requests: 215, completed: 212, tokens: 164200, latency: 1.2 },
].map(d => {
  const date = new Date(); date.setDate(date.getDate() - d.daysAgo);
  return { ...d, date: localDate(date), name: date.toLocaleDateString('en', { weekday: 'short' }) };
});
export const questionTopics = [
  { name: 'Spending analysis', share: 38 },
  { name: 'Budget planning', share: 27 },
  { name: 'Savings advice', share: 21 },
  { name: 'Financial summaries', share: 14 },
];
export const adminNav = [
  { path: '/admin', label: 'Admin Overview', icon: 'overview' },
  { path: '/admin/users', label: 'User Management', icon: 'users' },
  { path: '/admin/transactions', label: 'Transaction Monitoring', icon: 'transactions' },
  { path: '/admin/categories', label: 'Category Management', icon: 'categories' },
  { path: '/admin/ai', label: 'AI Usage & Analytics', icon: 'ai' },
  { path: '/admin/settings', label: 'System Settings', icon: 'settings' },
] as const;
