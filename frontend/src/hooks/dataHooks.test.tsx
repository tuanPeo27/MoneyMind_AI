// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../test/dom';
import { mockNetwork, type Call, type Reply } from '../test/helpers';
import { useNotifications } from './useNotifications';
import { useSavingsGoals } from './useSavingsGoals';
import { useWorkspaceData } from './useWorkspaceData';

type Route = (call: Call) => Reply | undefined;
/** Routes requests by "METHOD /url". Unknown routes answer 404 so a missing mock fails loudly. */
function router(routes: Record<string, Route | Reply>) {
  return (call: Call): Reply => {
    const entry = routes[`${call.method} ${call.url}`];
    if (entry === undefined) return { status: 404, data: { detail: `no mock for ${call.method} ${call.url}` } };
    return typeof entry === 'function' ? (entry(call) ?? { status: 404 }) : entry;
  };
}
const page = <T,>(items: T[], extra: Record<string, unknown> = {}) => ({ data: { items, page: 1, pageSize: 100, totalCount: items.length, totalPages: 1, ...extra } });

// ---------------------------------------------------------------- notifications

const note = (overrides: Record<string, unknown> = {}) => ({
  id: 'n1', type: 'Info', source: 'System', title: 'Title', message: 'Message', relatedType: null, relatedId: null,
  isRead: false, createdAt: '2025-01-01T10:00:00Z', ...overrides,
});

describe('useNotifications', () => {
  it('does nothing without a user', async () => {
    const calls = mockNetwork(() => ({ data: {} }));
    const { result } = renderHook(() => useNotifications(undefined));
    expect(result.current.items).toEqual([]);
    expect(result.current.unread).toBe(0);
    await result.current.refresh();
    expect(calls).toHaveLength(0);
  });

  it('loads the first 50 notifications and counts the unread ones', async () => {
    const calls = mockNetwork(router({
      'GET /notifications': page([note({ id: 'a' }), note({ id: 'b', isRead: true }), note({ id: 'c' })]),
    }));
    const { result } = renderHook(() => useNotifications('u1'));
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    expect(result.current.unread).toBe(2);
    expect(calls[0].params).toEqual({ page: 1, pageSize: 50 });
  });

  it.each([
    ['Budget', 'budget'],
    ['Goal', 'goal'],
    ['System', 'system'],
    ['AI', 'system'],
  ])('maps the %s source to the %s kind', async (source, kind) => {
    mockNetwork(router({ 'GET /notifications': page([note({ source })]) }));
    const { result } = renderHook(() => useNotifications('u1'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0]).toMatchObject({ kind, title: 'Title', message: 'Message', read: false, time: '2025-01-01T10:00:00Z' });
  });

  it('keeps the last list when a refresh fails', async () => {
    let fail = false;
    mockNetwork(router({ 'GET /notifications': () => fail ? { status: 500 } : page([note()]) }));
    const { result } = renderHook(() => useNotifications('u1'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    fail = true;
    await act(() => result.current.refresh());
    expect(result.current.items).toHaveLength(1);
  });

  describe('alerts', () => {
    it('stay quiet for what was already there on the first load', async () => {
      mockNetwork(router({ 'GET /notifications': page([note({ id: 'old', source: 'Budget' })]) }));
      const onAlert = vi.fn();
      const { result } = renderHook(() => useNotifications('u1', onAlert));
      await waitFor(() => expect(result.current.items).toHaveLength(1));
      expect(onAlert).not.toHaveBeenCalled();
    });

    it('fire once for a new unread budget or goal notification', async () => {
      let items = [note({ id: 'old', source: 'Budget' })];
      mockNetwork(router({ 'GET /notifications': () => page(items) }));
      const onAlert = vi.fn();
      const { result } = renderHook(() => useNotifications('u1', onAlert));
      await waitFor(() => expect(result.current.items).toHaveLength(1));
      items = [note({ id: 'new-budget', source: 'Budget' }), note({ id: 'new-goal', source: 'Goal' }), ...items];
      await act(() => result.current.refresh());
      expect(onAlert).toHaveBeenCalledTimes(2);
      expect(onAlert.mock.calls.map(c => c[0].id)).toEqual(['new-goal', 'new-budget']); // oldest first
      await act(() => result.current.refresh());
      expect(onAlert).toHaveBeenCalledTimes(2); // not again
    });

    it('ignore system notifications and ones that are already read', async () => {
      let items = [note({ id: 'old' })];
      mockNetwork(router({ 'GET /notifications': () => page(items) }));
      const onAlert = vi.fn();
      const { result } = renderHook(() => useNotifications('u1', onAlert));
      await waitFor(() => expect(result.current.items).toHaveLength(1));
      items = [note({ id: 's', source: 'System' }), note({ id: 'r', source: 'Budget', isRead: true }), ...items];
      await act(() => result.current.refresh());
      expect(onAlert).not.toHaveBeenCalled();
    });
  });

  describe('actions', () => {
    const setup = async () => {
      const calls = mockNetwork(router({
        'GET /notifications': page([note({ id: 'a' }), note({ id: 'b' }), note({ id: 'c', isRead: true })]),
        'PUT /notifications/a/read': { status: 204 },
        'PUT /notifications/read-all': { status: 204 },
        'DELETE /notifications/a': { status: 204 },
        'DELETE /notifications/b': { status: 204 },
        'DELETE /notifications/c': { status: 204 },
      }));
      const hook = renderHook(() => useNotifications('u1'));
      await waitFor(() => expect(hook.result.current.items).toHaveLength(3));
      return { ...hook, calls };
    };

    it('marks one notification read at once and tells the server', async () => {
      const { result, calls } = await setup();
      act(() => result.current.markRead('a'));
      expect(result.current.items.find(n => n.id === 'a')?.read).toBe(true);
      expect(result.current.unread).toBe(1);
      await waitFor(() => expect(calls.some(c => c.method === 'PUT' && c.url === '/notifications/a/read')).toBe(true));
    });

    it('marks everything read', async () => {
      const { result, calls } = await setup();
      act(() => result.current.markAllRead());
      expect(result.current.unread).toBe(0);
      await waitFor(() => expect(calls.some(c => c.url === '/notifications/read-all')).toBe(true));
    });

    it('removes one notification', async () => {
      const { result, calls } = await setup();
      act(() => result.current.remove('b'));
      expect(result.current.items.map(n => n.id)).toEqual(['a', 'c']);
      await waitFor(() => expect(calls.some(c => c.method === 'DELETE' && c.url === '/notifications/b')).toBe(true));
    });

    it('clears everything and then reloads', async () => {
      const { result, calls } = await setup();
      act(() => result.current.clear());
      expect(result.current.items).toEqual([]);
      await waitFor(() => expect(calls.filter(c => c.method === 'DELETE')).toHaveLength(3));
      await waitFor(() => expect(calls.filter(c => c.method === 'GET').length).toBeGreaterThanOrEqual(2));
    });

    it('rolls back by reloading when the server refuses', async () => {
      let refuse = false;
      mockNetwork(router({
        'GET /notifications': page([note({ id: 'a' })]),
        'PUT /notifications/a/read': () => { refuse = true; return { status: 500 }; },
      }));
      const { result } = renderHook(() => useNotifications('u1'));
      await waitFor(() => expect(result.current.items).toHaveLength(1));
      act(() => result.current.markRead('a'));
      await waitFor(() => expect(refuse).toBe(true));
      await waitFor(() => expect(result.current.items[0].read).toBe(false));
    });
  });

  describe('refreshing', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('reloads when the window regains focus', async () => {
      const calls = mockNetwork(router({ 'GET /notifications': page([note()]) }));
      const { result } = renderHook(() => useNotifications('u1'));
      await waitFor(() => expect(result.current.items).toHaveLength(1));
      const before = calls.length;
      act(() => { window.dispatchEvent(new Event('focus')); });
      await waitFor(() => expect(calls.length).toBeGreaterThan(before));
    });

    it('polls every minute', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const calls = mockNetwork(router({ 'GET /notifications': page([note()]) }));
      const { result } = renderHook(() => useNotifications('u1'));
      await vi.waitFor(() => expect(result.current.items).toHaveLength(1));
      const before = calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      await vi.waitFor(() => expect(calls.length).toBeGreaterThan(before));
    });

    it('stops polling after unmount', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const calls = mockNetwork(router({ 'GET /notifications': page([note()]) }));
      const { result, unmount } = renderHook(() => useNotifications('u1'));
      await vi.waitFor(() => expect(result.current.items).toHaveLength(1));
      unmount();
      const before = calls.length;
      await vi.advanceTimersByTimeAsync(180_000);
      expect(calls.length).toBe(before);
    });

    it('forgets everything when the user changes', async () => {
      mockNetwork(router({ 'GET /notifications': page([note()]) }));
      const { result, rerender } = renderHook(({ id }: { id: string | undefined }) => useNotifications(id), { initialProps: { id: 'u1' as string | undefined } });
      await waitFor(() => expect(result.current.items).toHaveLength(1));
      rerender({ id: undefined });
      await waitFor(() => expect(result.current.items).toEqual([]));
    });
  });
});

// ---------------------------------------------------------------- savings goals

const goal = (overrides: Record<string, unknown> = {}) => ({
  id: 'g1', name: 'Trip', targetAmount: 1000, currentAmount: 100, progressPercent: 10, deadline: null, status: 'Active', reminderDay: null, ...overrides,
});

describe('useSavingsGoals', () => {
  it('does nothing without a user', async () => {
    const calls = mockNetwork(() => ({ data: [] }));
    const { result } = renderHook(() => useSavingsGoals(undefined));
    await act(() => result.current.reload());
    expect(calls).toHaveLength(0);
    expect(result.current.goals).toEqual([]);
  });

  it('loads the goals and reports loading', async () => {
    mockNetwork(router({ 'GET /financial-goals': { data: [goal(), goal({ id: 'g2', name: 'Car' })] } }));
    const { result } = renderHook(() => useSavingsGoals('u1'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.goals).toHaveLength(2));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('exposes the error when loading fails', async () => {
    mockNetwork(router({ 'GET /financial-goals': { status: 500, data: { detail: 'down' } } }));
    const { result } = renderHook(() => useSavingsGoals('u1'));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.goals).toEqual([]);
  });

  describe('changes reload the list', () => {
    const setup = async () => {
      let goals = [goal()];
      const calls = mockNetwork(router({
        'GET /financial-goals': () => ({ data: goals }),
        'POST /financial-goals': () => { goals = [...goals, goal({ id: 'g2', name: 'New' })]; return { data: goals[1] }; },
        'PUT /financial-goals/g1': () => { goals = [goal({ name: 'Renamed' })]; return { data: goals[0] }; },
        'PUT /financial-goals/g1/status': () => { goals = [goal({ status: 'Cancelled' })]; return { data: goals[0] }; },
        'POST /financial-goals/g1/contributions': () => { goals = [goal({ currentAmount: 600 })]; return { data: goals[0] }; },
        'DELETE /financial-goals/g1': () => { goals = []; return { status: 204 }; },
      }));
      const hook = renderHook(() => useSavingsGoals('u1'));
      await waitFor(() => expect(hook.result.current.goals).toHaveLength(1));
      return { ...hook, calls };
    };

    it('create', async () => {
      const { result, calls } = await setup();
      await act(() => result.current.create({ name: 'New', targetAmount: 500, deadline: null } as never));
      expect(result.current.goals.map(g => g.name)).toEqual(['Trip', 'New']);
      expect(calls.find(c => c.method === 'POST' && c.url === '/financial-goals')?.data).toEqual({ name: 'New', targetAmount: 500, deadline: null });
    });

    it('update', async () => {
      const { result } = await setup();
      await act(() => result.current.update('g1', { name: 'Renamed', targetAmount: 1000, deadline: null } as never));
      expect(result.current.goals[0].name).toBe('Renamed');
    });

    it('change status', async () => {
      const { result } = await setup();
      await act(() => result.current.setStatus('g1', 'Cancelled' as never));
      expect(result.current.goals[0].status).toBe('Cancelled');
    });

    it('contribute and return the updated goal', async () => {
      const { result, calls } = await setup();
      let returned: { currentAmount: number } | undefined;
      await act(async () => { returned = await result.current.contribute('g1', 500, 'acc-1'); });
      expect(returned?.currentAmount).toBe(600);
      expect(result.current.goals[0].currentAmount).toBe(600);
      expect(calls.find(c => c.url.endsWith('/contributions'))?.data).toEqual({ amount: 500, accountId: 'acc-1' });
    });

    it('remove', async () => {
      const { result } = await setup();
      await act(() => result.current.remove('g1'));
      expect(result.current.goals).toEqual([]);
    });
  });

  it('keeps the old list when a reload fails', async () => {
    let fail = false;
    mockNetwork(router({ 'GET /financial-goals': () => fail ? { status: 500 } : { data: [goal()] } }));
    const { result } = renderHook(() => useSavingsGoals('u1'));
    await waitFor(() => expect(result.current.goals).toHaveLength(1));
    fail = true;
    await act(() => result.current.reload());
    expect(result.current.goals).toHaveLength(1);
    expect(result.current.error).not.toBeNull();
  });

  it('clears the list when the user changes', async () => {
    mockNetwork(router({ 'GET /financial-goals': { data: [goal()] } }));
    const { result, rerender } = renderHook(({ id }: { id: string | undefined }) => useSavingsGoals(id), { initialProps: { id: 'u1' as string | undefined } });
    await waitFor(() => expect(result.current.goals).toHaveLength(1));
    rerender({ id: undefined });
    await waitFor(() => expect(result.current.goals).toEqual([]));
  });
});

// ---------------------------------------------------------------- workspace data

const acct = (overrides: Record<string, unknown> = {}) => ({
  id: 'acc1', name: 'MoMo', accountType: 'EWallet', initialBalance: 1000, balance: 0, currency: 'VND', isArchived: false,
  createdAt: '2025-01-01T00:00:00Z', contributed: 0, ...overrides,
});
const cat = (overrides: Record<string, unknown> = {}) => ({
  id: 'cat1', name: 'Ăn uống', type: 'Expense', icon: 'utensils', color: '#FF0000', isSystem: true, isActive: true, ...overrides,
});
const txn = (overrides: Record<string, unknown> = {}) => ({
  id: 't1', accountId: 'acc1', accountName: 'MoMo', categoryId: 'cat1', categoryName: 'Ăn uống', amount: 100, type: 'Expense',
  description: 'Lunch\nwith team', transactionDate: '2025-01-10T12:00:00', source: 'Manual', createdAt: '', updatedAt: '', ...overrides,
});
const bud = (overrides: Record<string, unknown> = {}) => ({
  id: 'b1', categoryId: 'cat1', categoryName: 'Ăn uống', amount: 5000, spent: 0, remaining: 5000, usedPercent: 0,
  startDate: '2025-01-01', endDate: '2025-01-31', alertThreshold: 80, isOverThreshold: false, isExceeded: false, ...overrides,
});

function workspaceRoutes(overrides: Record<string, Route | Reply> = {}) {
  return router({
    'GET /accounts': { data: [acct()] },
    'GET /categories': { data: [cat(), cat({ id: 'cat2', name: 'Lương', type: 'Income', icon: 'wallet' }), cat({ id: 'cat3', name: 'Hidden', isActive: false })] },
    'GET /transactions': page([txn()]),
    'GET /budgets': { data: [bud()] },
    ...overrides,
  });
}

let userSeq = 0;
const newUser = () => `workspace-user-${++userSeq}`; // the default-account guard is cached per user id
/** One id per rendered hook. (A new id on every render would look like the user changing and reload forever.) */
function renderWorkspace() {
  const id = newUser();
  return renderHook(() => useWorkspaceData(id));
}

describe('useWorkspaceData loading', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('does nothing without a user', () => {
    const calls = mockNetwork(workspaceRoutes());
    const { result } = renderHook(() => useWorkspaceData(undefined));
    expect(result.current.loading).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('loads accounts, categories, transactions and budgets', async () => {
    mockNetwork(workspaceRoutes());
    const { result } = renderWorkspace();
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.loading).toBe(false);
    expect(result.current.activeAccounts.map(a => a.name)).toEqual(['MoMo']);
    expect(result.current.budgets[0]).toMatchObject({ category: 'Ăn uống', limit: 5000, alertThreshold: 80 });
    expect(result.current.accountNames).toEqual(['MoMo']);
  });

  it('asks for archived accounts too and today\'s budgets', async () => {
    const calls = mockNetwork(workspaceRoutes());
    const { result } = renderWorkspace();
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(calls.find(c => c.url === '/accounts')?.params).toEqual({ includeArchived: true });
    expect(String(calls.find(c => c.url === '/budgets')?.params?.activeOn)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('splits a stored description into description and notes', async () => {
    mockNetwork(workspaceRoutes());
    const { result } = renderWorkspace();
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.rows[0]).toMatchObject({ description: 'Lunch', notes: 'with team', date: '2025-01-10', category: 'Ăn uống', account: 'MoMo', accountId: 'acc1' });
  });

  it('handles a transaction without a description', async () => {
    mockNetwork(workspaceRoutes({ 'GET /transactions': page([txn({ description: null })]) }));
    const { result } = renderWorkspace();
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.rows[0]).toMatchObject({ description: '', notes: '' });
  });

  it('hides inactive categories and maps icons and colours', async () => {
    mockNetwork(workspaceRoutes());
    const { result } = renderWorkspace();
    await waitFor(() => expect(result.current.categories).toHaveLength(2));
    expect(result.current.categories.map(c => c.name)).toEqual(['Ăn uống', 'Lương']);
    expect(result.current.categories[0]).toMatchObject({ icon: 'Utensils', color: '#FF0000', isSystem: true });
  });

  it('uses a default colour for a category without one', async () => {
    mockNetwork(workspaceRoutes({ 'GET /categories': { data: [cat({ color: null })] } }));
    const { result } = renderWorkspace();
    await waitFor(() => expect(result.current.categories).toHaveLength(1));
    expect(result.current.categories[0].color).toBe('#3B82F6');
  });

  it('loads every page of transactions', async () => {
    const calls = mockNetwork(workspaceRoutes({
      'GET /transactions': call => call.params?.page === 1
        ? page([txn({ id: 't1' })], { totalPages: 3, totalCount: 3 })
        : page([txn({ id: `t${call.params?.page}` })], { page: call.params?.page, totalPages: 3, totalCount: 3 }),
    }));
    const { result } = renderWorkspace();
    await waitFor(() => expect(result.current.rows).toHaveLength(3));
    expect(result.current.rows.map(r => r.id)).toEqual(['t1', 't2', 't3']);
    expect(calls.filter(c => c.url === '/transactions')).toHaveLength(3);
  });

  it('reports a loading error and keeps the lists empty', async () => {
    mockNetwork(workspaceRoutes({ 'GET /categories': { status: 500, data: { detail: 'down' } } }));
    const { result } = renderWorkspace();
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.loading).toBe(false);
    expect(result.current.rows).toEqual([]);
  });

  it('can reload', async () => {
    const calls = mockNetwork(workspaceRoutes());
    const { result } = renderWorkspace();
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    await act(() => result.current.reload());
    expect(calls.filter(c => c.url === '/accounts')).toHaveLength(2);
  });

  it('clears everything when the user signs out', async () => {
    mockNetwork(workspaceRoutes());
    const id = newUser();
    const { result, rerender } = renderHook(({ user }: { user: string | undefined }) => useWorkspaceData(user), { initialProps: { user: id as string | undefined } });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    rerender({ user: undefined });
    await waitFor(() => expect(result.current.rows).toEqual([]));
    expect(result.current.activeAccounts).toEqual([]);
  });
});

describe('useWorkspaceData default account', () => {
  it('creates a cash wallet for a user without accounts', async () => {
    const created = acct({ id: 'new', name: 'Tiền mặt', accountType: 'Cash', initialBalance: 0 });
    const calls = mockNetwork(workspaceRoutes({ 'GET /accounts': { data: [] }, 'POST /accounts': { data: created } }));
    const { result } = renderWorkspace();
    await waitFor(() => expect(result.current.activeAccounts).toHaveLength(1));
    expect(result.current.activeAccounts[0].name).toBe('Tiền mặt');
    expect(calls.find(c => c.method === 'POST')?.data).toEqual({ name: 'Tiền mặt', accountType: 'Cash', initialBalance: 0 });
  });

  it('does not create one when accounts exist', async () => {
    const calls = mockNetwork(workspaceRoutes());
    const { result } = renderWorkspace();
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(calls.some(c => c.method === 'POST')).toBe(false);
  });

  it('reads the account back when it was created in another tab (409)', async () => {
    let reads = 0;
    mockNetwork(workspaceRoutes({
      'GET /accounts': () => (++reads === 1 ? { data: [] } : { data: [acct({ name: 'Tiền mặt' })] }),
      'POST /accounts': { status: 409, data: { detail: 'exists' } },
    }));
    const { result } = renderWorkspace();
    await waitFor(() => expect(result.current.activeAccounts.map(a => a.name)).toEqual(['Tiền mặt']));
  });

  it('shares one creation request when the same user loads twice at once', async () => {
    const calls = mockNetwork(workspaceRoutes({ 'GET /accounts': { data: [] }, 'POST /accounts': { data: acct({ name: 'Tiền mặt' }) } }));
    const id = newUser();
    renderHook(() => useWorkspaceData(id));
    const second = renderHook(() => useWorkspaceData(id));
    await waitFor(() => expect(second.result.current.activeAccounts).toHaveLength(1));
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
  });
});

describe('useWorkspaceData balances', () => {
  const load = async (routes: Record<string, Route | Reply> = {}) => {
    mockNetwork(workspaceRoutes(routes));
    const hook = renderWorkspace();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    await waitFor(() => expect(hook.result.current.activeAccounts.length).toBeGreaterThan(0));
    return hook;
  };

  it('is the starting balance plus income minus expense', async () => {
    const { result } = await load({ 'GET /transactions': page([txn({ amount: 100 }), txn({ id: 't2', amount: 400, type: 'Income' }), txn({ id: 't3', amount: 50 })]) });
    expect(result.current.activeAccounts[0]).toMatchObject({ balance: 1000 - 100 + 400 - 50, transactions: 3 });
  });

  it('subtracts money moved into savings funds', async () => {
    const { result } = await load({ 'GET /accounts': { data: [acct({ contributed: 300 })] }, 'GET /transactions': page([]) });
    expect(result.current.activeAccounts[0].balance).toBe(700);
  });

  it('separates active and archived accounts', async () => {
    const { result } = await load({ 'GET /accounts': { data: [acct(), acct({ id: 'acc2', name: 'Old', isArchived: true })] } });
    expect(result.current.activeAccounts.map(a => a.name)).toEqual(['MoMo']);
    expect(result.current.archivedAccounts.map(a => a.name)).toEqual(['Old']);
    expect(result.current.accountNames).toEqual(['MoMo']);
  });

  it('adds up the starting balances of active accounts only', async () => {
    const { result } = await load({ 'GET /accounts': { data: [acct({ initialBalance: 100 }), acct({ id: 'a2', name: 'B', initialBalance: 50 }), acct({ id: 'a3', name: 'C', initialBalance: 999, isArchived: true })] } });
    expect(result.current.openingBalance).toBe(150);
    expect([...result.current.activeAccountIds].sort()).toEqual(['a2', 'acc1']);
  });

  it('counts an account with no transactions as zero', async () => {
    const { result } = await load({ 'GET /transactions': page([]) });
    expect(result.current.activeAccounts[0]).toMatchObject({ balance: 1000, transactions: 0 });
  });
});

describe('useWorkspaceData actions', () => {
  const setup = async (routes: Record<string, Route | Reply> = {}) => {
    const calls = mockNetwork(workspaceRoutes(routes));
    const hook = renderWorkspace();
    await waitFor(() => expect(hook.result.current.rows).toHaveLength(1));
    return { ...hook, calls };
  };
  const base = { id: '', description: 'Coffee', amount: 55, type: 'Expense' as const, category: 'Ăn uống', account: 'MoMo', date: '2025-02-03', notes: '' };

  it('creates a transaction and puts it first', async () => {
    const { result, calls } = await setup({ 'POST /transactions': { data: txn({ id: 'new', description: 'Coffee', amount: 55, transactionDate: '2025-02-03T12:00:00' }) } });
    await act(() => result.current.saveTransaction(base, false));
    expect(result.current.rows.map(r => r.id)).toEqual(['new', 't1']);
    expect(calls.find(c => c.method === 'POST' && c.url === '/transactions')?.data).toEqual({
      accountId: 'acc1', categoryId: 'cat1', amount: 55, type: 'Expense', description: 'Coffee', transactionDate: '2025-02-03T12:00:00',
    });
  });

  it('stores notes after the first line of the description', async () => {
    const { result, calls } = await setup({ 'POST /transactions': { data: txn({ id: 'new' }) } });
    await act(() => result.current.saveTransaction({ ...base, notes: ' for dad ' }, false));
    expect((calls.find(c => c.method === 'POST')?.data as { description: string }).description).toBe('Coffee\nfor dad');
  });

  it('caps the stored description at 500 characters', async () => {
    const { result, calls } = await setup({ 'POST /transactions': { data: txn({ id: 'new' }) } });
    await act(() => result.current.saveTransaction({ ...base, description: 'x'.repeat(200), notes: 'y'.repeat(400) }, false));
    expect((calls.find(c => c.method === 'POST')?.data as { description: string }).description).toHaveLength(500);
  });

  it('updates a transaction in place', async () => {
    const { result } = await setup({ 'PUT /transactions/t1': { data: txn({ id: 't1', description: 'Edited', amount: 999 }) } });
    await act(() => result.current.saveTransaction({ ...base, id: 't1', description: 'Edited', amount: 999 }, true));
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]).toMatchObject({ description: 'Edited', amount: 999 });
  });

  it('refuses an unknown account without calling the server', async () => {
    const { result, calls } = await setup();
    await expect(result.current.saveTransaction({ ...base, account: 'Nope' }, false)).rejects.toMatchObject({ status: 400, message: 'Choose an account to continue.' });
    expect(calls.some(c => c.method === 'POST')).toBe(false);
  });

  it('refuses an archived account', async () => {
    const { result } = await setup({ 'GET /accounts': { data: [acct(), acct({ id: 'acc2', name: 'Old', isArchived: true })] } });
    await expect(result.current.saveTransaction({ ...base, account: 'Old' }, false)).rejects.toMatchObject({ message: 'Choose an account to continue.' });
  });

  it('refuses a category of the wrong type', async () => {
    const { result } = await setup();
    await expect(result.current.saveTransaction({ ...base, type: 'Income' }, false)).rejects.toMatchObject({ message: 'Choose a category to continue.' });
  });

  it('deletes a transaction', async () => {
    const { result } = await setup({ 'DELETE /transactions/t1': { status: 204 } });
    await act(() => result.current.removeTransaction('t1'));
    expect(result.current.rows).toEqual([]);
  });

  it('keeps the transaction when deleting fails', async () => {
    const { result } = await setup({ 'DELETE /transactions/t1': { status: 500 } });
    await expect(result.current.removeTransaction('t1')).rejects.toBeDefined();
    expect(result.current.rows).toHaveLength(1);
  });

  it('creates a category', async () => {
    const { result, calls } = await setup({ 'POST /categories': { data: cat({ id: 'cat9', name: 'Coffee', isSystem: false }) } });
    await act(() => result.current.saveCategory({ name: 'Coffee', type: 'Expense', color: '#111111', icon: 'Coffee' }));
    expect(result.current.categories.map(c => c.name)).toContain('Coffee');
    expect(calls.find(c => c.method === 'POST' && c.url === '/categories')?.data).toEqual({ name: 'Coffee', type: 'Expense', icon: 'Coffee', color: '#111111', isActive: true });
  });

  it('renaming a category renames it in transactions and budgets too', async () => {
    const { result } = await setup({ 'PUT /categories/cat1': { data: cat({ name: 'Eating out' }) } });
    await act(() => result.current.saveCategory({ name: 'Eating out', type: 'Expense', color: '#FF0000' }, 'Ăn uống'));
    expect(result.current.rows[0].category).toBe('Eating out');
    expect(result.current.budgets[0].category).toBe('Eating out');
  });

  it('re-reads categories after deleting one the server only deactivated', async () => {
    let listed = 0;
    const { result } = await setup({
      'GET /categories': () => { listed++; return { data: listed === 1 ? [cat()] : [cat({ isActive: false })] }; },
      'DELETE /categories/cat1': { status: 204 },
    });
    await act(() => result.current.removeCategory({ name: 'Ăn uống', type: 'Expense', color: '#FF0000' }));
    expect(result.current.categories).toEqual([]);
  });

  it('ignores deleting a category it does not know', async () => {
    const { result, calls } = await setup();
    await act(() => result.current.removeCategory({ name: 'Ghost', type: 'Expense', color: '#000' }));
    expect(calls.some(c => c.method === 'DELETE')).toBe(false);
  });

  it('creates a budget for the current month by default', async () => {
    const { result, calls } = await setup({ 'POST /budgets': { data: bud({ id: 'b2' }) } });
    await act(() => result.current.saveBudget({ id: '', category: 'Ăn uống', limit: 7000 }, false));
    const body = calls.find(c => c.method === 'POST' && c.url === '/budgets')?.data as { startDate: string; endDate: string; amount: number; alertThreshold?: number };
    expect(body.amount).toBe(7000);
    expect(body.startDate).toMatch(/^\d{4}-\d{2}-01$/);
    expect(body.endDate >= body.startDate).toBe(true);
    expect(body).not.toHaveProperty('alertThreshold');
    expect(result.current.budgets).toHaveLength(2);
  });

  it('keeps the dates and threshold of a budget being edited', async () => {
    const { result, calls } = await setup({ 'PUT /budgets/b1': { data: bud({ amount: 9000 }) } });
    await act(() => result.current.saveBudget({ id: 'b1', category: 'Ăn uống', limit: 9000, startDate: '2025-01-01', endDate: '2025-01-31', alertThreshold: 60 }, true));
    expect(calls.find(c => c.method === 'PUT' && c.url === '/budgets/b1')?.data).toEqual({ categoryId: 'cat1', amount: 9000, startDate: '2025-01-01', endDate: '2025-01-31', alertThreshold: 60 });
    expect(result.current.budgets[0].limit).toBe(9000);
  });

  it('refuses a budget for an income category', async () => {
    const { result } = await setup();
    await expect(result.current.saveBudget({ id: '', category: 'Lương', limit: 1 }, false)).rejects.toMatchObject({ message: 'Choose a category to continue.' });
  });

  it('deletes a budget', async () => {
    const { result } = await setup({ 'DELETE /budgets/b1': { status: 204 } });
    await act(() => result.current.removeBudget('b1'));
    expect(result.current.budgets).toEqual([]);
  });

  it('creates an account with a trimmed name', async () => {
    const { result, calls } = await setup({ 'POST /accounts': { data: acct({ id: 'acc2', name: 'Bank' }) } });
    await act(() => result.current.createAccount({ name: '  Bank ', type: 'Bank', initialBalance: 50 }));
    expect(result.current.activeAccounts.map(a => a.name)).toEqual(['MoMo', 'Bank']);
    expect(calls.find(c => c.method === 'POST' && c.url === '/accounts')?.data).toEqual({ name: 'Bank', accountType: 'Bank', initialBalance: 50 });
  });

  it('renames an account everywhere', async () => {
    const { result } = await setup({ 'PUT /accounts/acc1': { data: acct({ name: 'MoMo Pay' }) } });
    await act(() => result.current.updateAccount('acc1', { name: 'MoMo Pay', type: 'EWallet' }));
    expect(result.current.activeAccounts[0].name).toBe('MoMo Pay');
    expect(result.current.rows[0].account).toBe('MoMo Pay');
  });

  it('restores an archived account', async () => {
    const { result, calls } = await setup({
      'GET /accounts': { data: [acct({ isArchived: true })] },
      'PUT /accounts/acc1': { data: acct({ isArchived: false }) },
    });
    await act(() => result.current.updateAccount('acc1', { name: 'MoMo', type: 'EWallet' }, false));
    expect(result.current.activeAccounts).toHaveLength(1);
    expect((calls.find(c => c.method === 'PUT')?.data as { isArchived: boolean }).isArchived).toBe(false);
  });

  it('archives an account that has transactions instead of deleting it', async () => {
    const { result } = await setup({ 'DELETE /accounts/acc1': { status: 204 } });
    let outcome: string | undefined;
    await act(async () => { outcome = await result.current.removeAccount('acc1'); });
    expect(outcome).toBe('archived');
    expect(result.current.archivedAccounts).toHaveLength(1);
    expect(result.current.activeAccounts).toHaveLength(0);
  });

  it('deletes an account without transactions', async () => {
    const { result } = await setup({ 'GET /accounts': { data: [acct(), acct({ id: 'acc2', name: 'Empty' })] }, 'DELETE /accounts/acc2': { status: 204 } });
    await waitFor(() => expect(result.current.activeAccounts).toHaveLength(2));
    let outcome: string | undefined;
    await act(async () => { outcome = await result.current.removeAccount('acc2'); });
    expect(outcome).toBe('deleted');
    expect(result.current.activeAccounts.map(a => a.id)).toEqual(['acc1']);
  });

  it('re-reads balances after money moved into a savings fund', async () => {
    let contributed = 0;
    const { result } = await setup({ 'GET /accounts': () => ({ data: [acct({ contributed })] }) });
    expect(result.current.activeAccounts[0].balance).toBe(1000 - 100);
    contributed = 250;
    await act(() => result.current.refreshAccounts());
    expect(result.current.activeAccounts[0].balance).toBe(1000 - 100 - 250);
  });
});
