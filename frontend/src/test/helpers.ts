import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { vi } from 'vitest';
import { http } from '../services/client';
import type { AuthSession } from '../services/session';

/** In-memory localStorage plus a minimal window (event bus) so browser-only modules run under Node. */
export function installBrowserStubs() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  };
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const win = {
    dispatchEvent: vi.fn((event: Event) => { listeners.get(event.type)?.forEach(l => l(event)); return true; }),
    addEventListener: (type: string, listener: (event: Event) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: (event: Event) => void) => { listeners.get(type)?.delete(listener); },
    scrollTo: vi.fn(),
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', win);
  return { store, storage, win };
}

/** localStorage that throws on every use, like a browser with storage blocked. */
export function installBrokenStorage() {
  const fail = () => { throw new Error('storage blocked'); };
  vi.stubGlobal('localStorage', { getItem: fail, setItem: fail, removeItem: fail });
  vi.stubGlobal('window', { dispatchEvent: vi.fn(() => true), addEventListener: vi.fn(), removeEventListener: vi.fn() });
}

export const SESSION_KEY = 'mm-auth-session-v1';

export function makeSession(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    accessTokenExpiresAt: '2030-01-01T00:00:00Z',
    user: { id: 'u1', fullName: 'An Nguyen', email: 'an@x.com', roles: ['User'], avatarUrl: 'https://cdn.x.com/a.png' },
    ...overrides,
  };
}

export type Call = {
  method: string;
  url: string;
  params?: Record<string, unknown>;
  data?: unknown;
  authorization?: string;
  timeout?: number;
};
export type Reply = { status?: number; data?: unknown } | Error;

/** Replaces the network layer of both the shared client and the global axios (used by the token refresh). */
export function mockNetwork(handler: (call: Call) => Reply | Promise<Reply>) {
  const calls: Call[] = [];
  const adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const authorization = config.headers?.get?.('Authorization');
    const call: Call = {
      method: (config.method ?? 'get').toUpperCase(),
      url: config.url ?? '',
      params: config.params,
      data: typeof config.data === 'string' && config.data ? JSON.parse(config.data) : config.data ?? undefined,
      authorization: typeof authorization === 'string' ? authorization : undefined,
      timeout: config.timeout,
    };
    calls.push(call);
    const reply = await handler(call);
    if (reply instanceof Error) throw reply;
    const status = reply.status ?? 200;
    const response = { data: reply.data, status, statusText: '', headers: {}, config } as AxiosResponse;
    if (status >= 400) {
      throw new AxiosError('Request failed', status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST', config, null, response);
    }
    return response;
  };
  http.defaults.adapter = adapter;
  axios.defaults.adapter = adapter;
  return calls;
}

export const networkError = () => new AxiosError('Network Error', 'ERR_NETWORK');
export const timeoutError = () => new AxiosError('timeout of 20000ms exceeded', 'ECONNABORTED');
