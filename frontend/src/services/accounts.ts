import { http, getData } from './client';
import type { AccountResponse, CreateAccountRequest, UpdateAccountRequest } from './types';

/** Active accounts; with `includeArchived` also the ones archived because they still have transactions. */
export const listAccounts = (includeArchived = false) =>
  getData(http.get<AccountResponse[]>('/accounts', { params: includeArchived ? { includeArchived } : undefined }));
export const getAccount = (id: string) => getData(http.get<AccountResponse>(`/accounts/${id}`));
export const createAccount = (request: CreateAccountRequest) => getData(http.post<AccountResponse>('/accounts', request));
export const updateAccount = (id: string, request: UpdateAccountRequest) => getData(http.put<AccountResponse>(`/accounts/${id}`, request));
export const deleteAccount = (id: string) => http.delete(`/accounts/${id}`).then(() => undefined);
