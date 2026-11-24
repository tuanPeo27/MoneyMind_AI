import { getData, http } from './client';
import type { AcceptRecommendationResponse, WeeklyRecommendation, WeeklySummaryResponse } from './types';

// 204 (nothing yet) arrives as an empty body.
const orNull = (value: WeeklySummaryResponse | '') => value || null;

/** The latest weekly summary, or null when there is none yet. */
export const getLatestWeekly = () =>
  getData(http.get<WeeklySummaryResponse | ''>('/ai/insights/weekly/latest')).then(orNull);

/** Creates last week's summary if missing (at most one AI call per week). null: no transactions last week. */
export const generateWeekly = () =>
  getData(http.post<WeeklySummaryResponse | ''>('/ai/insights/weekly', null, { timeout: 65_000 })).then(orNull);

export const markRead = (id: string) => http.post(`/ai/insights/${id}/read`).then(() => undefined);

/** Turns the recommendation into an action card that still needs confirming. */
export const acceptRecommendation = (id: string) =>
  getData(http.post<AcceptRecommendationResponse>(`/ai/insights/recommendations/${id}/accept`));

export const dismissRecommendation = (id: string) =>
  getData(http.post<WeeklyRecommendation>(`/ai/insights/recommendations/${id}/dismiss`));
