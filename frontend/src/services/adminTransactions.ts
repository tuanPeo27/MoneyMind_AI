import { http, getData } from './client';
import type { AdminTransactionStatsResponse } from './types';

/** Platform-wide transaction statistics (Admin role). `from` / `to` are YYYY-MM-DD, inclusive; default last 30 days. */
export const getTransactionStats = (from?: string, to?: string) =>
  getData(http.get<AdminTransactionStatsResponse>('/admin/transactions/stats', { params: { from, to } }));