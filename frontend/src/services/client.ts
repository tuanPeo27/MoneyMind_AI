import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { getSession, setSession, type AuthSession } from './session';

// In dev the Vite proxy forwards /api to the backend. Override with VITE_API_URL for other setups.
const BASE_URL = `${((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '')}/api`;

/** A normalized error thrown by every service call. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = 'ApiError';
  }
}

export const http: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 20000,
});

// Attach the access token to every request.
http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getSession()?.accessToken;
  if (token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };
let refreshing: Promise<AuthSession | null> | null = null;

/** Exchange the refresh token for a new session. Shared across concurrent 401s so we only refresh once. */
async function refreshSession(): Promise<AuthSession | null> {
  const current = getSession();
  if (!current?.refreshToken) return null;
  refreshing ??= axios
    .post<AuthSession>(`${BASE_URL}/auth/refresh`, { refreshToken: current.refreshToken })
    .then(res => { setSession(res.data); return res.data; })
    .catch(() => { setSession(null); return null; })
    .finally(() => { refreshing = null; });
  return refreshing;
}

http.interceptors.response.use(
  response => response,
  async (error: AxiosError<any>) => {
    const config = error.config as RetriableConfig | undefined;
    const status = error.response?.status;
    const url = config?.url ?? '';

    // Try a single silent refresh on 401, except for the auth endpoints themselves.
    if (status === 401 && config && !config._retried && !url.includes('/auth/')) {
      config._retried = true;
      const session = await refreshSession();
      if (session) {
        config.headers.Authorization = `Bearer ${session.accessToken}`;
        return http(config);
      }
    }

    if (!error.response) throw new ApiError(error.code === 'ECONNABORTED' ? 'TIMEOUT' : 'NETWORK', 0, error.code);
    const data = error.response.data;
    const fieldErrors = data?.errors as Record<string, string[]> | undefined;
    const firstValidation = fieldErrors ? Object.values(fieldErrors).flat()[0] : undefined;
    throw new ApiError(firstValidation || data?.detail || data?.title || 'REQUEST_FAILED', status ?? 0, undefined, fieldErrors);
  },
);

export const getData = <T>(p: Promise<{ data: T }>) => p.then(r => r.data);

/** Same error shape as the axios interceptor: first validation message, then ProblemDetails detail/title. */
async function toApiError(response: Response): Promise<ApiError> {
  const data = await response.json().catch(() => undefined) as any;
  const fieldErrors = data?.errors as Record<string, string[]> | undefined;
  const firstValidation = fieldErrors ? Object.values(fieldErrors).flat()[0] : undefined;
  return new ApiError(firstValidation || data?.detail || data?.title || 'REQUEST_FAILED', response.status, undefined, fieldErrors);
}

/**
 * POST that reads a newline-delimited JSON response as it arrives and calls `onEvent` for each line.
 * Axios cannot stream in the browser, so this uses fetch with the same token, one silent refresh on 401, and the
 * same ApiError for failures before the stream starts.
 */
export async function postStream(path: string, body: unknown, onEvent: (event: any) => void, signal?: AbortSignal) {
  const send = (token?: string) => fetch(`${BASE_URL}${path}`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  let response: Response;
  try {
    response = await send(getSession()?.accessToken);
    if (response.status === 401) {
      const session = await refreshSession();
      if (session) response = await send(session.accessToken);
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ApiError('NETWORK', 0);
  }
  if (!response.ok) throw await toApiError(response);
  if (!response.body) throw new ApiError('NETWORK', 0);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line));
    }
    if (done) break;
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer));
}
