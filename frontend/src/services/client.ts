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
