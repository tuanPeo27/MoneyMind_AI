import { http, getData } from './client';
import type { BudgetResponse, UpsertBudgetRequest } from './types';

export const listBudgets = () => getData(http.get<BudgetResponse[]>('/budgets'));
export const getBudget = (id: string) => getData(http.get<BudgetResponse>(`/budgets/${id}`));
export const createBudget = (request: UpsertBudgetRequest) => getData(http.post<BudgetResponse>('/budgets', request));
export const updateBudget = (id: string, request: UpsertBudgetRequest) => getData(http.put<BudgetResponse>(`/budgets/${id}`, request));
export const deleteBudget = (id: string) => http.delete(`/budgets/${id}`).then(() => undefined);
