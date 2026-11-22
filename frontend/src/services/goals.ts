import { http, getData } from './client';
import type { FinancialGoalResponse, FinancialGoalStatus, UpsertGoalRequest } from './types';

export const listGoals = () => getData(http.get<FinancialGoalResponse[]>('/financial-goals'));
export const getGoal = (id: string) => getData(http.get<FinancialGoalResponse>(`/financial-goals/${id}`));
export const createGoal = (request: UpsertGoalRequest) => getData(http.post<FinancialGoalResponse>('/financial-goals', request));
export const updateGoal = (id: string, request: UpsertGoalRequest) => getData(http.put<FinancialGoalResponse>(`/financial-goals/${id}`, request));
export const contributeToGoal = (id: string, amount: number) => getData(http.post<FinancialGoalResponse>(`/financial-goals/${id}/contributions`, { amount }));
export const setGoalStatus = (id: string, status: FinancialGoalStatus) => getData(http.put<FinancialGoalResponse>(`/financial-goals/${id}/status`, { status }));
export const deleteGoal = (id: string) => http.delete(`/financial-goals/${id}`).then(() => undefined);
