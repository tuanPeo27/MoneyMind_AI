import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as authApi from './auth';
import * as usersApi from './users';
import * as categoriesApi from './categories';
import * as accountsApi from './accounts';
import * as transactionsApi from './transactions';
import * as budgetsApi from './budgets';
import * as goalsApi from './goals';
import * as dashboardApi from './dashboard';
import * as notificationsApi from './notifications';
import * as aiChatApi from './aiChat';
import * as adminUsersApi from './adminUsers';
import * as adminTransactionsApi from './adminTransactions';
import * as adminCategoriesApi from './adminCategories';
import { getSession, setSession } from './session';
import { installBrowserStubs, makeSession, mockNetwork, type Call } from '../test/helpers';

const ID = '3f2b8c1e-0000-4000-8000-000000000001';

const upsertTx = { accountId: 'a', categoryId: 'c', amount: 10, type: 'Expense', description: 'x', transactionDate: '2025-01-01', source: 'Manual' } as never;
const upsertBudget = { categoryId: 'c', amount: 5, startDate: '2025-01-01', endDate: '2025-01-31', alertThreshold: 80 } as never;
const upsertGoal = { name: 'Trip', targetAmount: 100, deadline: null } as never;
const upsertCategory = { name: 'Food', type: 'Expense', icon: null, color: null, isActive: true } as never;

type Row = [name: string, run: () => Promise<unknown>, method: string, url: string, params?: Record<string, unknown>, body?: unknown];

const rows: Row[] = [
  // accounts
  ['listAccounts()', () => accountsApi.listAccounts(), 'GET', '/accounts', undefined],
  ['listAccounts(true)', () => accountsApi.listAccounts(true), 'GET', '/accounts', { includeArchived: true }],
  ['getAccount', () => accountsApi.getAccount(ID), 'GET', `/accounts/${ID}`],
  ['createAccount', () => accountsApi.createAccount({ name: 'Cash' } as never), 'POST', '/accounts', undefined, { name: 'Cash' }],
  ['updateAccount', () => accountsApi.updateAccount(ID, { name: 'X' } as never), 'PUT', `/accounts/${ID}`, undefined, { name: 'X' }],
  ['deleteAccount', () => accountsApi.deleteAccount(ID), 'DELETE', `/accounts/${ID}`],
  // categories
  ['listCategories()', () => categoriesApi.listCategories(), 'GET', '/categories', undefined],
  ['listCategories(Income)', () => categoriesApi.listCategories('Income' as never), 'GET', '/categories', { type: 'Income' }],
  ['getCategory', () => categoriesApi.getCategory(ID), 'GET', `/categories/${ID}`],
  ['createCategory', () => categoriesApi.createCategory(upsertCategory), 'POST', '/categories', undefined, upsertCategory],
  ['updateCategory', () => categoriesApi.updateCategory(ID, upsertCategory), 'PUT', `/categories/${ID}`, undefined, upsertCategory],
  ['deleteCategory', () => categoriesApi.deleteCategory(ID), 'DELETE', `/categories/${ID}`],
  // transactions
  ['listTransactions()', () => transactionsApi.listTransactions(), 'GET', '/transactions', {}],
  ['listTransactions(query)', () => transactionsApi.listTransactions({ page: 2, pageSize: 5, search: 'pho' } as never), 'GET', '/transactions', { page: 2, pageSize: 5, search: 'pho' }],
  ['getTransaction', () => transactionsApi.getTransaction(ID), 'GET', `/transactions/${ID}`],
  ['createTransaction', () => transactionsApi.createTransaction(upsertTx), 'POST', '/transactions', undefined, upsertTx],
  ['updateTransaction', () => transactionsApi.updateTransaction(ID, upsertTx), 'PUT', `/transactions/${ID}`, undefined, upsertTx],
  ['deleteTransaction', () => transactionsApi.deleteTransaction(ID), 'DELETE', `/transactions/${ID}`],
  // budgets
  ['listBudgets()', () => budgetsApi.listBudgets(), 'GET', '/budgets', { activeOn: undefined }],
  ['listBudgets(date)', () => budgetsApi.listBudgets('2025-01-15'), 'GET', '/budgets', { activeOn: '2025-01-15' }],
  ['getBudget', () => budgetsApi.getBudget(ID), 'GET', `/budgets/${ID}`],
  ['createBudget', () => budgetsApi.createBudget(upsertBudget), 'POST', '/budgets', undefined, upsertBudget],
  ['updateBudget', () => budgetsApi.updateBudget(ID, upsertBudget), 'PUT', `/budgets/${ID}`, undefined, upsertBudget],
  ['deleteBudget', () => budgetsApi.deleteBudget(ID), 'DELETE', `/budgets/${ID}`],
  // goals
  ['listGoals', () => goalsApi.listGoals(), 'GET', '/financial-goals'],
  ['getGoal', () => goalsApi.getGoal(ID), 'GET', `/financial-goals/${ID}`],
  ['createGoal', () => goalsApi.createGoal(upsertGoal), 'POST', '/financial-goals', undefined, upsertGoal],
  ['updateGoal', () => goalsApi.updateGoal(ID, upsertGoal), 'PUT', `/financial-goals/${ID}`, undefined, upsertGoal],
  ['contributeToGoal (no account)', () => goalsApi.contributeToGoal(ID, 50), 'POST', `/financial-goals/${ID}/contributions`, undefined, { amount: 50, accountId: null }],
  ['contributeToGoal (account)', () => goalsApi.contributeToGoal(ID, 50, 'acc-1'), 'POST', `/financial-goals/${ID}/contributions`, undefined, { amount: 50, accountId: 'acc-1' }],
  ['contributeToGoal (blank account)', () => goalsApi.contributeToGoal(ID, 50, ''), 'POST', `/financial-goals/${ID}/contributions`, undefined, { amount: 50, accountId: null }],
  ['setGoalStatus', () => goalsApi.setGoalStatus(ID, 'Cancelled' as never), 'PUT', `/financial-goals/${ID}/status`, undefined, { status: 'Cancelled' }],
  ['deleteGoal', () => goalsApi.deleteGoal(ID), 'DELETE', `/financial-goals/${ID}`],
  // dashboard
  ['getOverview()', () => dashboardApi.getOverview(), 'GET', '/dashboard/overview', { from: undefined, to: undefined }],
  ['getOverview(range)', () => dashboardApi.getOverview('2025-01-01', '2025-01-31'), 'GET', '/dashboard/overview', { from: '2025-01-01', to: '2025-01-31' }],
  ['getReport', () => dashboardApi.getReport('2025-01-01', '2025-01-31'), 'GET', '/dashboard/report', { from: '2025-01-01', to: '2025-01-31' }],
  ['getTrend (monthly by default)', () => dashboardApi.getTrend('2025-01-01', '2025-06-30'), 'GET', '/dashboard/trend', { from: '2025-01-01', to: '2025-06-30', groupByMonth: true }],
  ['getTrend (daily)', () => dashboardApi.getTrend('2025-01-01', '2025-01-31', false), 'GET', '/dashboard/trend', { from: '2025-01-01', to: '2025-01-31', groupByMonth: false }],
  ['listSnapshots()', () => dashboardApi.listSnapshots(), 'GET', '/dashboard/snapshots', { periodType: undefined, page: 1, pageSize: 20 }],
  ['listSnapshots(Month,2,5)', () => dashboardApi.listSnapshots('Month' as never, 2, 5), 'GET', '/dashboard/snapshots', { periodType: 'Month', page: 2, pageSize: 5 }],
  ['createSnapshot', () => dashboardApi.createSnapshot('Week' as never, '2025-01-10'), 'POST', '/dashboard/snapshots', { periodType: 'Week', referenceDate: '2025-01-10' }],
  // notifications
  ['listNotifications()', () => notificationsApi.listNotifications(), 'GET', '/notifications', {}],
  ['listNotifications(unread)', () => notificationsApi.listNotifications({ unreadOnly: true } as never), 'GET', '/notifications', { unreadOnly: true }],
  ['getUnreadCount', () => notificationsApi.getUnreadCount(), 'GET', '/notifications/unread-count'],
  ['markNotificationRead', () => notificationsApi.markNotificationRead(ID), 'PUT', `/notifications/${ID}/read`],
  ['markAllNotificationsRead', () => notificationsApi.markAllNotificationsRead(), 'PUT', '/notifications/read-all'],
  ['deleteNotification', () => notificationsApi.deleteNotification(ID), 'DELETE', `/notifications/${ID}`],
  // AI chat
  ['getConversations', () => aiChatApi.getConversations(), 'GET', '/ai/chat/conversations', { page: 1, pageSize: 100 }],
  ['getMessages', () => aiChatApi.getMessages(ID), 'GET', `/ai/chat/conversations/${ID}/messages`, { page: 1, pageSize: 100 }],
  ['getUsage', () => aiChatApi.getUsage(), 'GET', '/ai/usage'],
  ['deleteConversation', () => aiChatApi.deleteConversation(ID), 'DELETE', `/ai/chat/conversations/${ID}`],
  ['sendMessage (new conversation)', () => aiChatApi.sendMessage(null, 'hello', 'vi'), 'POST', '/ai/chat/messages', undefined, { conversationId: null, message: 'hello', language: 'vi' }],
  ['sendMessage (existing)', () => aiChatApi.sendMessage(ID, 'again', 'en'), 'POST', '/ai/chat/messages', undefined, { conversationId: ID, message: 'again', language: 'en' }],
  ['confirmAction (as proposed)', () => aiChatApi.confirmAction(ID), 'POST', `/ai/actions/${ID}/confirm`, undefined, { payload: null }],
  ['confirmAction (edited)', () => aiChatApi.confirmAction(ID, { amount: 5 } as never), 'POST', `/ai/actions/${ID}/confirm`, undefined, { payload: { amount: 5 } }],
  ['cancelAction', () => aiChatApi.cancelAction(ID), 'POST', `/ai/actions/${ID}/cancel`],
  // admin
  ['listUsers()', () => adminUsersApi.listUsers(), 'GET', '/admin/users', {}],
  ['listUsers(query)', () => adminUsersApi.listUsers({ search: 'an', isActive: false } as never), 'GET', '/admin/users', { search: 'an', isActive: false }],
  ['getUser', () => adminUsersApi.getUser(ID), 'GET', `/admin/users/${ID}`],
  ['lockUser', () => adminUsersApi.lockUser(ID, 'spam'), 'POST', `/admin/users/${ID}/lock`, undefined, { reason: 'spam' }],
  ['unlockUser', () => adminUsersApi.unlockUser(ID), 'POST', `/admin/users/${ID}/unlock`],
  ['setAIQuota (50)', () => adminUsersApi.setAIQuota(ID, 50), 'PUT', `/admin/users/${ID}/ai-quota`, undefined, { dailyLimit: 50 }],
  ['setAIQuota (default)', () => adminUsersApi.setAIQuota(ID, null), 'PUT', `/admin/users/${ID}/ai-quota`, undefined, { dailyLimit: null }],
  ['getAIQuotaSettings', () => adminUsersApi.getAIQuotaSettings(), 'GET', '/admin/ai/quota'],
  ['setDefaultAIQuota', () => adminUsersApi.setDefaultAIQuota(-1), 'PUT', '/admin/ai/quota/default', undefined, { dailyLimit: -1 }],
  ['getTransactionStats()', () => adminTransactionsApi.getTransactionStats(), 'GET', '/admin/transactions/stats', { from: undefined, to: undefined }],
  ['getTransactionStats(range)', () => adminTransactionsApi.getTransactionStats('2025-01-01', '2025-01-31'), 'GET', '/admin/transactions/stats', { from: '2025-01-01', to: '2025-01-31' }],
  ['listSystemCategories', () => adminCategoriesApi.listSystemCategories(), 'GET', '/admin/categories'],
  ['createSystemCategory', () => adminCategoriesApi.createSystemCategory(upsertCategory), 'POST', '/admin/categories', undefined, upsertCategory],
  ['updateSystemCategory', () => adminCategoriesApi.updateSystemCategory(ID, upsertCategory), 'PUT', `/admin/categories/${ID}`, undefined, upsertCategory],
  ['deleteSystemCategory', () => adminCategoriesApi.deleteSystemCategory(ID), 'DELETE', `/admin/categories/${ID}`],
  // account / profile
  ['getProfile', () => usersApi.getProfile(), 'GET', '/users/me'],
  ['changePassword', () => usersApi.changePassword({ currentPassword: 'a', newPassword: 'b' } as never), 'PUT', '/users/me/password', undefined, { currentPassword: 'a', newPassword: 'b' }],
  ['forgotPassword', () => authApi.forgotPassword('a@b.com'), 'POST', '/auth/forgot-password', undefined, { email: 'a@b.com' }],
  ['resetPassword', () => authApi.resetPassword('tok', 'NewPassword1'), 'POST', '/auth/reset-password', undefined, { token: 'tok', newPassword: 'NewPassword1' }],
  ['listSessions', () => authApi.listSessions(), 'GET', '/auth/sessions'],
  ['revokeSession', () => authApi.revokeSession(ID), 'DELETE', `/auth/sessions/${ID}`],
  ['logoutAll', () => authApi.logoutAll(), 'POST', '/auth/logout-all'],
];

describe('API endpoints', () => {
  beforeEach(() => { installBrowserStubs(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it.each(rows)('%s', async (_name, run, method, url, params, body) => {
    const calls = mockNetwork(() => ({ data: { ok: true } }));
    await run();
    const call: Call = calls[0];
    expect(call.method).toBe(method);
    expect(call.url).toBe(url);
    if (params !== undefined) expect(call.params).toEqual(params);
    if (body !== undefined) expect(call.data).toEqual(body);
    expect(calls).toHaveLength(1);
  });

  it('sends exactly one request per call', async () => {
    const calls = mockNetwork(() => ({ data: [] }));
    await accountsApi.listAccounts();
    await goalsApi.listGoals();
    expect(calls).toHaveLength(2);
  });

  it('returns the response body of GET calls', async () => {
    mockNetwork(() => ({ data: [{ id: '1', name: 'Cash' }] }));
    await expect(accountsApi.listAccounts()).resolves.toEqual([{ id: '1', name: 'Cash' }]);
  });

  it('resolves delete calls with undefined', async () => {
    mockNetwork(() => ({ status: 204 }));
    await expect(accountsApi.deleteAccount(ID)).resolves.toBeUndefined();
    await expect(budgetsApi.deleteBudget(ID)).resolves.toBeUndefined();
    await expect(notificationsApi.markAllNotificationsRead()).resolves.toBeUndefined();
  });

  it('gives sendMessage a longer timeout than other calls because the AI can be slow', async () => {
    const calls = mockNetwork(() => ({ data: {} }));
    await aiChatApi.sendMessage(null, 'hi');
    await accountsApi.listAccounts();
    expect(calls[0].timeout).toBe(65_000);
    expect(calls[1].timeout).toBe(20_000);
  });

  it('rejects with an ApiError when the server refuses', async () => {
    mockNetwork(() => ({ status: 409, data: { detail: 'Tên ví đã tồn tại.' } }));
    await expect(accountsApi.createAccount({ name: 'Cash' } as never)).rejects.toMatchObject({ status: 409, message: 'Tên ví đã tồn tại.' });
  });
});

describe('auth service', () => {
  beforeEach(() => { installBrowserStubs(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const auth = makeSession({ accessToken: 'new-access', refreshToken: 'new-refresh' });

  it('login posts the credentials and stores the returned session', async () => {
    const calls = mockNetwork(() => ({ data: auth }));
    const session = await authApi.login('a@b.com', 'pw');
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/auth/login', data: { email: 'a@b.com', password: 'pw' } });
    expect(session.accessToken).toBe('new-access');
    expect(getSession()?.refreshToken).toBe('new-refresh');
  });

  it('login failure leaves the previous state alone', async () => {
    mockNetwork(() => ({ status: 401, data: { detail: 'Mật khẩu không đúng.' } }));
    await expect(authApi.login('a@b.com', 'bad')).rejects.toMatchObject({ status: 401 });
    expect(getSession()).toBeNull();
  });

  it('register posts the profile and stores the session', async () => {
    const calls = mockNetwork(() => ({ data: auth }));
    await authApi.register('An', 'a@b.com', 'Password1');
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/auth/register', data: { fullName: 'An', email: 'a@b.com', password: 'Password1' } });
    expect(getSession()?.accessToken).toBe('new-access');
  });

  it('loginWithGoogle posts the ID token and stores the session', async () => {
    const calls = mockNetwork(() => ({ data: auth }));
    await authApi.loginWithGoogle('google-id-token');
    expect(calls[0]).toMatchObject({ url: '/auth/google', data: { idToken: 'google-id-token' } });
    expect(getSession()?.accessToken).toBe('new-access');
  });

  it('logout clears the local session and revokes the refresh token', async () => {
    setSession(makeSession({ refreshToken: 'to-revoke' }));
    const calls = mockNetwork(() => ({ status: 204 }));
    await authApi.logout();
    expect(getSession()).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/auth/logout', data: { refreshToken: 'to-revoke' } });
  });

  it('logout still signs out locally when the server cannot be reached', async () => {
    setSession(makeSession());
    mockNetwork(() => new Error('offline'));
    await expect(authApi.logout()).resolves.toBeUndefined();
    expect(getSession()).toBeNull();
  });

  it('logout while already signed out sends nothing', async () => {
    const calls = mockNetwork(() => ({ status: 204 }));
    await authApi.logout();
    expect(calls).toHaveLength(0);
  });
});

describe('users service', () => {
  beforeEach(() => { installBrowserStubs(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const profile = (overrides = {}) => ({ id: 'u1', fullName: 'New Name', email: 'an@x.com', phoneNumber: '0901234567', avatarUrl: 'https://cdn.x.com/a.png', timeZoneId: 'UTC', roles: ['User'], ...overrides });

  it('updateProfile keeps the current avatar when none is given', async () => {
    setSession(makeSession());
    const calls = mockNetwork(() => ({ data: profile() }));
    await usersApi.updateProfile({ fullName: 'New Name', phoneNumber: '0901234567' } as never);
    expect(calls[0].data).toEqual({ fullName: 'New Name', phoneNumber: '0901234567', avatarUrl: 'https://cdn.x.com/a.png' });
  });

  it('updateProfile sends the new avatar when one is given', async () => {
    setSession(makeSession());
    const calls = mockNetwork(() => ({ data: profile({ avatarUrl: 'https://cdn.x.com/b.png' }) }));
    await usersApi.updateProfile({ fullName: 'X', phoneNumber: null, avatarUrl: 'https://cdn.x.com/b.png' } as never);
    expect((calls[0].data as { avatarUrl: string }).avatarUrl).toBe('https://cdn.x.com/b.png');
  });

  it('updateProfile sends an empty string through so the avatar can be removed', async () => {
    setSession(makeSession());
    const calls = mockNetwork(() => ({ data: profile({ avatarUrl: null }) }));
    await usersApi.updateProfile({ fullName: 'X', phoneNumber: null, avatarUrl: '' } as never);
    expect((calls[0].data as { avatarUrl: string }).avatarUrl).toBe('');
  });

  it('updateProfile sends null when there is no session avatar and none is given', async () => {
    setSession(makeSession({ user: { id: 'u1', fullName: 'A', email: 'a@x.com', roles: [] } }));
    const calls = mockNetwork(() => ({ data: profile({ avatarUrl: null }) }));
    await usersApi.updateProfile({ fullName: 'X', phoneNumber: null } as never);
    expect((calls[0].data as { avatarUrl: unknown }).avatarUrl).toBeNull();
  });

  it('updateProfile refreshes the cached user in the session', async () => {
    setSession(makeSession());
    mockNetwork(() => ({ data: profile({ fullName: 'Saved Name', phoneNumber: '0912345678' }) }));
    await usersApi.updateProfile({ fullName: 'Saved Name', phoneNumber: '0912345678' } as never);
    expect(getSession()?.user.fullName).toBe('Saved Name');
    expect(getSession()?.user.phoneNumber).toBe('0912345678');
    expect(getSession()?.accessToken).toBe('access-1');
  });

  it('updateTimeZone posts the zone and caches it', async () => {
    setSession(makeSession());
    const calls = mockNetwork(() => ({ data: profile({ timeZoneId: 'Asia/Tokyo' }) }));
    await usersApi.updateTimeZone('Asia/Tokyo');
    expect(calls[0]).toMatchObject({ method: 'PUT', url: '/users/me/time-zone', data: { timeZoneId: 'Asia/Tokyo' } });
    expect(getSession()?.user.timeZoneId).toBe('Asia/Tokyo');
  });

  it('a failed profile update leaves the cached user unchanged', async () => {
    setSession(makeSession());
    mockNetwork(() => ({ status: 400, data: { detail: 'bad' } }));
    await expect(usersApi.updateProfile({ fullName: 'X', phoneNumber: null } as never)).rejects.toMatchObject({ status: 400 });
    expect(getSession()?.user.fullName).toBe('An Nguyen');
  });
});
