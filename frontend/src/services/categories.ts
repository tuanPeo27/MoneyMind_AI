import { http, getData } from './client';
import type { CategoryResponse, CategoryType, UpsertCategoryRequest } from './types';

export const listCategories = (type?: CategoryType) =>
  getData(http.get<CategoryResponse[]>('/categories', { params: type ? { type } : undefined }));
export const getCategory = (id: string) => getData(http.get<CategoryResponse>(`/categories/${id}`));
export const createCategory = (request: UpsertCategoryRequest) => getData(http.post<CategoryResponse>('/categories', request));
export const updateCategory = (id: string, request: UpsertCategoryRequest) => getData(http.put<CategoryResponse>(`/categories/${id}`, request));
export const deleteCategory = (id: string) => http.delete(`/categories/${id}`).then(() => undefined);
