import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { accountsApi, budgetsApi, categoriesApi, transactionsApi } from '../services';
import type { AccountResponse, BudgetResponse, CategoryResponse, TransactionResponse } from '../services';
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
    category: r.categoryName, account: r.accountName, date: r.transactionDate.slice(0, 10),
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

/** Loads the signed-in user's accounts, categories, transactions and budgets from the API and exposes CRUD actions. */
export function useWorkspaceData(userId: string | undefined) {
  const [accounts, setAccounts] = useState<AccountResponse[]>([]);
  const [categoryList, setCategoryList] = useState<CategoryResponse[]>([]);
  const [rows, setRows] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!userId) return;
    const current = ++requestId.current;
    setLoading(true); setError(null);
    try {
      const [accountList, categoryItems, firstPage, budgetItems] = await Promise.all([
        accountsApi.listAccounts(),
        categoriesApi.listCategories(),
        transactionsApi.listTransactions({ page: 1, pageSize: PAGE_SIZE }),
        budgetsApi.listBudgets(localDate(new Date())),
      ]);
      const pages = Math.min(firstPage.totalPages, MAX_PAGES);
      const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) =>
        transactionsApi.listTransactions({ page: i + 2, pageSize: PAGE_SIZE })));
      // New users have no account yet and every transaction needs one.
      const usable = accountList.filter(a => !a.isArchived);
      const ensured = usable.length ? accountList
        : [...accountList, await accountsApi.createAccount({ name: DEFAULT_ACCOUNT_NAME, accountType: 'Cash', initialBalance: 0 })];
      if (current !== requestId.current) return; // a newer load (or sign-out) superseded this one
      setAccounts(ensured);
      setCategoryList(categoryItems);
      setRows([firstPage, ...rest].flatMap(page => page.items).map(toTransaction));
      setBudgets(budgetItems.map(toBudget));
    } catch (e) {
      if (current === requestId.current) setError(e);
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    requestId.current++;
    setAccounts([]); setCategoryList([]); setRows([]); setBudgets([]); setError(null);
    if (userId) void load(); else setLoading(false);
  }, [userId, load]);

  const categories = useMemo(() => categoryList.filter(c => c.isActive).map(toCategory), [categoryList]);
  const accountNames = useMemo(() => accounts.filter(a => !a.isArchived).map(a => a.name), [accounts]);

  const saveTransaction = useCallback(async (t: Transaction, editing: boolean) => {
    const account = accounts.find(a => a.name === t.account);
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

  const removeBudget = useCallback(async (id: string) => {
    await budgetsApi.deleteBudget(id);
    setBudgets(old => old.filter(b => b.id !== id));
  }, []);

  return {
    rows, budgets, categories, accountNames, loading, error, reload: load,
    saveTransaction, removeTransaction, saveCategory, removeCategory, saveBudget, removeBudget,
  };
}
