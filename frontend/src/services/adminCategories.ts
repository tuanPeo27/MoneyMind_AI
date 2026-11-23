import { http, getData } from './client';
import type { CategoryResponse, UpsertCategoryRequest } from './types';

/** Default (system) categories shared by every user, including hidden ones. Admin role only. */
export const listSystemCategories = () => getData(http.get<CategoryResponse[]>('/admin/categories'));
export const createSystemCategory = (request: UpsertCategoryRequest) =>
  getData(http.post<CategoryResponse>('/admin/categories', request));
/** The backend refuses (409) to change the type of a category that transactions or budgets already use. */
export const updateSystemCategory = (id: string, request: UpsertCategoryRequest) =>
  getData(http.put<CategoryResponse>(`/admin/categories/${id}`, request));
/** Deletes an unused category; one that is still used is only hidden (isActive = false). */
export const deleteSystemCategory = (id: string) => http.delete(`/admin/categories/${id}`).then(() => undefined);