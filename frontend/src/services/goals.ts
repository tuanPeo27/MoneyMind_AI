import { http, getData } from './client';
import type { FinancialGoalResponse, FinancialGoalStatus, UpsertGoalRequest } from './types';

export const listGoals = () => getData(http.get<FinancialGoalResponse[]>('/financial-goals'));
export const getGoal = (id: string) => getData(http.get<FinancialGoalResponse>(`/financial-goals/${id}`));
export const createGoal = (request: UpsertGoalRequest) => getData(http.post<FinancialGoalResponse>('/financial-goals', request));
export const updateGoal = (id: string, request: UpsertGoalRequest) => getData(http.put<FinancialGoalResponse>(`/financial-goals/${id}`, request));
/** `accountId`: account the money is taken from (its balance goes down). Omit to only record it in the fund. */
export const contributeToGoal = (id: string, amount: number, accountId?: string | null) =>
  getData(http.post<FinancialGoalResponse>(`/financial-goals/${id}/contributions`, { amount, accountId: accountId || null }));
export const setGoalStatus = (id: string, status: FinancialGoalStatus) => getData(http.put<FinancialGoalResponse>(`/financial-goals/${id}/status`, { status }));
export const deleteGoal = (id: string) => http.delete(`/financial-goals/${id}`).then(() => undefined);
