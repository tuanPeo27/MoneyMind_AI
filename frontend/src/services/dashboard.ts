import { http, getData } from './client';
import type { DashboardOverviewResponse, PagedResult, ReportPeriodType, ReportResponse, ReportSnapshotResponse, TrendPoint } from './types';

export const getOverview = (from?: string, to?: string) =>
  getData(http.get<DashboardOverviewResponse>('/dashboard/overview', { params: { from, to } }));
export const getReport = (from: string, to: string) =>
  getData(http.get<ReportResponse>('/dashboard/report', { params: { from, to } }));
export const getTrend = (from: string, to: string, groupByMonth = true) =>
  getData(http.get<TrendPoint[]>('/dashboard/trend', { params: { from, to, groupByMonth } }));
export const listSnapshots = (periodType?: ReportPeriodType, page = 1, pageSize = 20) =>
  getData(http.get<PagedResult<ReportSnapshotResponse>>('/dashboard/snapshots', { params: { periodType, page, pageSize } }));
export const createSnapshot = (periodType: ReportPeriodType, referenceDate?: string) =>
  getData(http.post<ReportSnapshotResponse>('/dashboard/snapshots', null, { params: { periodType, referenceDate } }));
