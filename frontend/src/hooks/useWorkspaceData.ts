import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { accountsApi, budgetsApi, categoriesApi, transactionsApi } from '../services';
import type { AccountResponse, AccountType, BudgetResponse, CategoryResponse, TransactionResponse } from '../services';
import { ApiError } from '../services';
import { getCategoryIcon } from '../components/CategoryIcon';
import { localDate, type Budget, type Category, type Transaction } from '../data';

const DEFAULT_ACCOUNT_NAME = 'Tiền mặt';
const PAGE_SIZE = 100; // backend maximum
const MAX_PAGES = 50;
const DESCRIPTION_MAX = 500;

/** The API has a single `description`, the UI has description + notes. Notes are stored after the first line break. */
const encodeDescription = (t: Transaction) => {
  const notes = t.notes.trim();
  return notes ? `${t.description}\n${notes}`.slice(0, DESCRIPTION_MAX) : t.description;
};
function toTransaction(r: TransactionResponse): Transaction {
  const [description = '', ...rest] = (r.description ?? '').split('\n');
  return {
    id: r.id, description, notes: rest.join('\n'), amount: r.amount, type: r.type,
    category: r.categoryName, account: r.accountName, accountId: r.accountId, date: r.transactionDate.slice(0, 10),
  };
}
const toCategory = (c: CategoryResponse): Category => ({
  id: c.id, name: c.name, type: c.type, color: c.color || '#3B82F6', icon: getCategoryIcon(c.name, c.icon ?? undefined), isSystem: c.isSystem,
});
const toBudget = (b: BudgetResponse): Budget => ({
  id: b.id, category: b.categoryName, limit: b.amount, startDate: b.startDate, endDate: b.endDate, alertThreshold: b.alertThreshold,
});
const monthRange = () => {
  const now = new Date();
  return { start: localDate(new Date(now.getFullYear(), now.getMonth(), 1)), end: localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
};
const invalid = (message: string) => new ApiError(message, 400);

/** An account (wallet, bank account, e-wallet) with its balance computed from the loaded transactions. */
export type WalletAccount = { id: string; name: string; type: AccountType; initialBalance: number; balance: number; isArchived: boolean; createdAt: string; transactions: number };
export type AccountInput = { name: string; type: AccountType; initialBalance: number };

// Two loads can overlap (StrictMode runs effects twice in dev, a quick reload) and both see zero accounts. The
// backend's unique-name check is not atomic, so both creates could succeed: share one request per user instead.
const creatingDefault = new Map<string, Promise<AccountResponse[]>>();
function ensureDefaultAccount(userId: string) {
  let pending = creatingDefault.get(userId);
  if (!pending) {
    pending = accountsApi.createAccount({ name: DEFAULT_ACCOUNT_NAME, accountType: 'Cash', initialBalance: 0 })
      .then(created => [created])
      // Created meanwhile from another tab: just read it back.
      .catch(e => e instanceof ApiError && e.status === 409 ? accountsApi.listAccounts(true) : Promise.reject(e))
      .finally(() => setTimeout(() => creatingDefault.delete(userId), 5000));
    creatingDefault.set(userId, pending);
  }
  return pending;
}

/** Loads the signed-in user's accounts, categories, transactions and budgets from the API and exposes CRUD actions. */
export function useWorkspaceData(userId: string | undefined) {
  const [accounts, setAccounts] = useState<AccountResponse[]>([]);
  const [categoryList, setCategoryList] = useState<CategoryResponse[]>([]);
  const [rows, setRows] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(false);
  // False until the first load for this user finishes (with data or an error): pages show skeletons meanwhile.
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!userId) return;
    const current = ++requestId.current;
    setLoading(true); setError(null);
    try {
      const [accountList, categoryItems, firstPage, budgetItems] = await Promise.all([
        accountsApi.listAccounts(true), // archived ones too: their transactions still exist
        categoriesApi.listCategories(),
        transactionsApi.listTransactions({ page: 1, pageSize: PAGE_SIZE }),
        budgetsApi.listBudgets(localDate(new Date())),
      ]);
      const pages = Math.min(firstPage.totalPages, MAX_PAGES);
      const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) =>
        transactionsApi.listTransactions({ page: i + 2, pageSize: PAGE_SIZE })));
      // A brand-new user has no account and every transaction needs one. Only then create a default wallet,
      // so deleting your last account does not make it come back on the next load.
      const ensured = accountList.length ? accountList : await ensureDefaultAccount(userId);
      if (current !== requestId.current) return; // a newer load (or sign-out) superseded this one
      setAccounts(ensured);
      setCategoryList(categoryItems);
      setRows([firstPage, ...rest].flatMap(page => page.items).map(toTransaction));
      setBudgets(budgetItems.map(toBudget));
    } catch (e) {
      if (current === requestId.current) setError(e);
    } finally {
      if (current === requestId.current) { setLoading(false); setReady(true); }
    }
  }, [userId]);

  useEffect(() => {
    requestId.current++;
    setAccounts([]); setCategoryList([]); setRows([]); setBudgets([]); setError(null); setReady(false);
    if (userId) void load(); else setLoading(false);
  }, [userId, load]);

  const categories = useMemo(() => categoryList.filter(c => c.isActive).map(toCategory), [categoryList]);
  // Balance = starting balance + income - expense of the account's transactions (the backend's formula), computed
  // from the loaded rows so it is current right after adding or editing a transaction.
  const walletAccounts = useMemo<WalletAccount[]>(() => {
    const net = new Map<string, number>(), count = new Map<string, number>();
    for (const r of rows) if (r.accountId) {
      net.set(r.accountId, (net.get(r.accountId) ?? 0) + (r.type === 'Income' ? r.amount : -r.amount));
      count.set(r.accountId, (count.get(r.accountId) ?? 0) + 1);
    }
    return accounts.map(a => ({
      id: a.id, name: a.name, type: a.accountType, initialBalance: a.initialBalance,
      // Money moved into savings funds leaves the account (no expense transaction is recorded for it).
      balance: a.initialBalance + (net.get(a.id) ?? 0) - (a.contributed ?? 0), isArchived: a.isArchived, createdAt: a.createdAt, transactions: count.get(a.id) ?? 0,
    }));
  }, [accounts, rows]);
  const activeAccounts = useMemo(() => walletAccounts.filter(a => !a.isArchived), [walletAccounts]);
  const archivedAccounts = useMemo(() => walletAccounts.filter(a => a.isArchived), [walletAccounts]);
  const accountNames = useMemo(() => activeAccounts.map(a => a.name), [activeAccounts]);
  // Starting balances of the active accounts. Total balance at a date = this + net of their transactions up to it.
  const openingBalance = useMemo(() => activeAccounts.reduce((s, a) => s + a.initialBalance, 0), [activeAccounts]);
  const activeAccountIds = useMemo(() => new Set(activeAccounts.map(a => a.id)), [activeAccounts]);

  const saveTransaction = useCallback(async (t: Transaction, editing: boolean) => {
    const account = accounts.find(a => a.name === t.account && !a.isArchived);
    const category = categoryList.find(c => c.name === t.category && c.type === t.type);
    if (!account) throw invalid('Choose an account to continue.');
    if (!category) throw invalid('Choose a category to continue.');
    const request = {
      accountId: account.id, categoryId: category.id, amount: t.amount, type: t.type,
      description: encodeDescription(t), transactionDate: `${t.date}T12:00:00`,
    };
    const saved = toTransaction(editing ? await transactionsApi.updateTransaction(t.id, request) : await transactionsApi.createTransaction(request));
    setRows(old => editing ? old.map(r => r.id === saved.id ? saved : r) : [saved, ...old]);
    return saved;
  }, [accounts, categoryList]);

  const removeTransaction = useCallback(async (id: string) => {
    await transactionsApi.deleteTransaction(id);
    setRows(old => old.filter(r => r.id !== id));
  }, []);

  const saveCategory = useCallback(async (c: Category, oldName?: string) => {
    const existing = oldName ? categoryList.find(x => x.name === oldName) : undefined;
    const request = { name: c.name, type: c.type, icon: c.icon, color: c.color, isActive: true };
    const saved = existing ? await categoriesApi.updateCategory(existing.id, request) : await categoriesApi.createCategory(request);
    setCategoryList(old => existing ? old.map(x => x.id === saved.id ? saved : x) : [...old, saved]);
    if (existing && oldName !== saved.name) {
      setRows(old => old.map(r => r.category === oldName ? { ...r, category: saved.name } : r));
      setBudgets(old => old.map(b => b.category === oldName ? { ...b, category: saved.name } : b));
    }
  }, [categoryList]);

  const removeCategory = useCallback(async (c: Category) => {
    const existing = categoryList.find(x => x.name === c.name && x.type === c.type);
    if (!existing) return;
    await categoriesApi.deleteCategory(existing.id);
    // The server deactivates (instead of deleting) a category that is still referenced, so re-read the list.
    setCategoryList(await categoriesApi.listCategories());
  }, [categoryList]);

  const saveBudget = useCallback(async (b: Budget, editing: boolean) => {
    const category = categoryList.find(c => c.name === b.category && c.type === 'Expense');
    if (!category) throw invalid('Choose a category to continue.');
    const range = monthRange();
    const request = {
      categoryId: category.id, amount: b.limit,
      startDate: b.startDate ?? range.start, endDate: b.endDate ?? range.end,
      ...(b.alertThreshold ? { alertThreshold: b.alertThreshold } : {}),
    };
    const saved = toBudget(editing ? await budgetsApi.updateBudget(b.id, request) : await budgetsApi.createBudget(request));
    setBudgets(old => editing ? old.map(x => x.id === saved.id ? saved : x) : [...old, saved]);
  }, [categoryList]);

  const createAccount = useCallback(async (input: AccountInput) => {
    const saved = await accountsApi.createAccount({ name: input.name.trim(), accountType: input.type, initialBalance: input.initialBalance });
    setAccounts(old => [...old, saved]);
  }, []);
  /** Name and type only: the backend does not allow changing the starting balance after creation. */
  const updateAccount = useCallback(async (id: string, input: Pick<AccountInput, 'name' | 'type'>, isArchived = false) => {
    const old = accounts.find(a => a.id === id);
    const saved = await accountsApi.updateAccount(id, { name: input.name.trim(), accountType: input.type, isArchived });
    setAccounts(list => list.map(a => a.id === id ? saved : a));
    if (old && old.name !== saved.name) setRows(list => list.map(r => r.accountId === id ? { ...r, account: saved.name } : r));
  }, [accounts]);
  /** Deletes the account, or archives it when it still has transactions. Returns which of the two happened. */
  const removeAccount = useCallback(async (id: string) => {
    const archived = rows.some(r => r.accountId === id);
    await accountsApi.deleteAccount(id);
    setAccounts(list => archived ? list.map(a => a.id === id ? { ...a, isArchived: true } : a) : list.filter(a => a.id !== id));
    return archived ? 'archived' as const : 'deleted' as const;
  }, [rows]);

  /** Re-reads balances after money moved into a savings fund (it changes `contributed`, not the transactions). */
  const refreshAccounts = useCallback(async () => { setAccounts(await accountsApi.listAccounts(true)); }, []);

  const removeBudget = useCallback(async (id: string) => {
    await budgetsApi.deleteBudget(id);
    setBudgets(old => old.filter(b => b.id !== id));
  }, []);

  return {
    rows, budgets, categories, accountNames, openingBalance, activeAccounts, archivedAccounts, activeAccountIds, loading, ready, error, reload: load,
    createAccount, updateAccount, removeAccount, refreshAccounts, saveTransaction, removeTransaction, saveCategory, removeCategory, saveBudget, removeBudget,
  };
}
