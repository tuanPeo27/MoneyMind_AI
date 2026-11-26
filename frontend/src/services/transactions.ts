import { http, getData } from './client';
import type {
  CategorySuggestionResponse, PagedResult, TransactionQuery, TransactionResponse, TransactionType, UpsertTransactionRequest,
} from './types';

export const listTransactions = (query: TransactionQuery = {}) =>
  getData(http.get<PagedResult<TransactionResponse>>('/transactions', { params: query }));
export const getTransaction = (id: string) => getData(http.get<TransactionResponse>(`/transactions/${id}`));
export const createTransaction = (request: UpsertTransactionRequest) => getData(http.post<TransactionResponse>('/transactions', request));
export const updateTransaction = (id: string, request: UpsertTransactionRequest) => getData(http.put<TransactionResponse>(`/transactions/${id}`, request));
/** History → keyword rules → AI (capped per day). `method` is History, Rule, AI or None. */
export const suggestCategory = (description: string, type: TransactionType, amount?: number, signal?: AbortSignal) =>
  getData(http.post<CategorySuggestionResponse>('/transactions/suggest-category', { description, type, amount }, { signal }));

/** Records the category the user finally saved for an AI suggestion (it only has a `logId` then). */
export const confirmCategorySuggestion = (logId: string, finalCategoryId: string) =>
  http.post(`/transactions/category-suggestions/${logId}/confirm`, { finalCategoryId }).then(() => undefined);

export const deleteTransaction = (id: string) => http.delete(`/transactions/${id}`).then(() => undefined);
