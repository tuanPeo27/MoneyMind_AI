import { http, getData } from './client';
import type { PagedResult, TransactionQuery, TransactionResponse, UpsertTransactionRequest } from './types';

export const listTransactions = (query: TransactionQuery = {}) =>
  getData(http.get<PagedResult<TransactionResponse>>('/transactions', { params: query }));
export const getTransaction = (id: string) => getData(http.get<TransactionResponse>(`/transactions/${id}`));
export const createTransaction = (request: UpsertTransactionRequest) => getData(http.post<TransactionResponse>('/transactions', request));
export const updateTransaction = (id: string, request: UpsertTransactionRequest) => getData(http.put<TransactionResponse>(`/transactions/${id}`, request));
export const deleteTransaction = (id: string) => http.delete(`/transactions/${id}`).then(() => undefined);
