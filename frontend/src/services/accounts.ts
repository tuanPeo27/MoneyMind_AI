import { http, getData } from './client';
import type { AccountResponse, CreateAccountRequest, UpdateAccountRequest } from './types';

export const listAccounts = () => getData(http.get<AccountResponse[]>('/accounts'));
export const getAccount = (id: string) => getData(http.get<AccountResponse>(`/accounts/${id}`));
export const createAccount = (request: CreateAccountRequest) => getData(http.post<AccountResponse>('/accounts', request));
export const updateAccount = (id: string, request: UpdateAccountRequest) => getData(http.put<AccountResponse>(`/accounts/${id}`, request));
export const deleteAccount = (id: string) => http.delete(`/accounts/${id}`).then(() => undefined);
