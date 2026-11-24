import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getData, http } from './client';
import { getSession, setSession } from './session';
import { installBrowserStubs, makeSession, mockNetwork, networkError, timeoutError } from '../test/helpers';

describe('ApiError', () => {
  it('carries the message, status, code and field errors', () => {
    const error = new ApiError('boom', 422, 'X', { Name: ['required'] });
    expect(error.message).toBe('boom');
    expect(error.status).toBe(422);
    expect(error.code).toBe('X');
    expect(error.fieldErrors).toEqual({ Name: ['required'] });
  });

  it('is a real Error with its own name', () => {
    const error = new ApiError('boom', 500);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.name).toBe('ApiError');
  });

  it('leaves optional parts undefined', () => {
    const error = new ApiError('x', 0);
    expect(error.code).toBeUndefined();
    expect(error.fieldErrors).toBeUndefined();
  });
});

describe('http client configuration', () => {
  it('talks to /api with JSON and a 20 second timeout', () => {
    expect(http.defaults.baseURL).toBe('/api');
    expect(http.defaults.timeout).toBe(20000);
    expect((http.defaults.headers as Record<string, unknown>)['Content-Type']).toBe('application/json');
  });
});

describe('getData', () => {
  it('unwraps the response body', async () => {
    await expect(getData(Promise.resolve({ data: { a: 1 } }))).resolves.toEqual({ a: 1 });
  });
});

describe('request interceptor', () => {
  beforeEach(() => { installBrowserStubs(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sends the access token as a Bearer header', async () => {
    setSession(makeSession({ accessToken: 'tok-123' }));
    const calls = mockNetwork(() => ({ data: {} }));
    await http.get('/x');
    expect(calls[0].authorization).toBe('Bearer tok-123');
  });

  it('sends no Authorization header when signed out', async () => {
    const calls = mockNetwork(() => ({ data: {} }));
    await http.get('/x');
    expect(calls[0].authorization).toBeUndefined();
  });

  it('does not overwrite an Authorization header that is already set', async () => {
    setSession(makeSession({ accessToken: 'tok-123' }));
    const calls = mockNetwork(() => ({ data: {} }));
    await http.get('/x', { headers: { Authorization: 'Bearer custom' } });
    expect(calls[0].authorization).toBe('Bearer custom');
  });

  it('serializes request bodies as JSON', async () => {
    const calls = mockNetwork(() => ({ data: {} }));
    await http.post('/x', { a: 1, b: 'two' });
    expect(calls[0].data).toEqual({ a: 1, b: 'two' });
  });
});

describe('error normalization', () => {
  beforeEach(() => { installBrowserStubs(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  async function failWith(reply: Parameters<typeof mockNetwork>[0]) {
    mockNetwork(reply);
    return http.get('/x').then(() => { throw new Error('expected a failure'); }, (e: unknown) => e as ApiError);
  }

  it('uses the first validation message of a 400 response', async () => {
    const error = await failWith(() => ({ status: 400, data: { errors: { Email: ['bad email', 'second'], Name: ['required'] } } }));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe('bad email');
    expect(error.status).toBe(400);
    expect(error.fieldErrors).toEqual({ Email: ['bad email', 'second'], Name: ['required'] });
  });

  it('falls back to the problem detail', async () => {
    const error = await failWith(() => ({ status: 409, data: { detail: 'Email already used', title: 'Conflict' } }));
    expect(error.message).toBe('Email already used');
    expect(error.status).toBe(409);
  });

  it('falls back to the problem title', async () => {
    const error = await failWith(() => ({ status: 404, data: { title: 'Not found' } }));
    expect(error.message).toBe('Not found');
  });

  it('uses REQUEST_FAILED when the body says nothing', async () => {
    const error = await failWith(() => ({ status: 500, data: {} }));
    expect(error.message).toBe('REQUEST_FAILED');
    expect(error.status).toBe(500);
  });

  it('copes with an empty error body', async () => {
    const error = await failWith(() => ({ status: 502 }));
    expect(error.message).toBe('REQUEST_FAILED');
  });

  it('reports a lost connection as NETWORK with status 0', async () => {
    const error = await failWith(() => networkError());
    expect(error.message).toBe('NETWORK');
    expect(error.status).toBe(0);
    expect(error.code).toBe('ERR_NETWORK');
  });

  it('reports a timeout as TIMEOUT with status 0', async () => {
    const error = await failWith(() => timeoutError());
    expect(error.message).toBe('TIMEOUT');
    expect(error.status).toBe(0);
  });

  it.each([403, 404, 409, 429, 503])('keeps status %i on the error', async status => {
    const error = await failWith(() => ({ status, data: { detail: 'x' } }));
    expect(error.status).toBe(status);
  });
});

describe('silent token refresh on 401', () => {
  beforeEach(() => { installBrowserStubs(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const refreshed = makeSession({ accessToken: 'access-2', refreshToken: 'refresh-2' });

  it('refreshes the token once and retries the request with the new token', async () => {
    setSession(makeSession());
    const calls = mockNetwork(call => {
      if (call.url.endsWith('/auth/refresh')) return { data: refreshed };
      return call.authorization === 'Bearer access-2' ? { data: { ok: true } } : { status: 401 };
    });
    const result = await http.get('/accounts');
    expect(result.data).toEqual({ ok: true });
    expect(calls.map(c => c.url)).toEqual(['/accounts', '/api/auth/refresh', '/accounts']);
    expect(calls[2].authorization).toBe('Bearer access-2');
  });

  it('sends the stored refresh token to the refresh endpoint', async () => {
    setSession(makeSession({ refreshToken: 'stored-refresh' }));
    const calls = mockNetwork(call => {
      if (call.url.endsWith('/auth/refresh')) return { data: refreshed };
      return call.authorization === 'Bearer access-2' ? { data: {} } : { status: 401 };
    });
    await http.get('/accounts');
    expect(calls[1].method).toBe('POST');
    expect(calls[1].data).toEqual({ refreshToken: 'stored-refresh' });
  });

  it('saves the new session', async () => {
    setSession(makeSession());
    mockNetwork(call => {
      if (call.url.endsWith('/auth/refresh')) return { data: refreshed };
      return call.authorization === 'Bearer access-2' ? { data: {} } : { status: 401 };
    });
    await http.get('/accounts');
    expect(getSession()?.accessToken).toBe('access-2');
    expect(getSession()?.refreshToken).toBe('refresh-2');
  });

  it('refreshes only once when several requests fail together', async () => {
    setSession(makeSession());
    const calls = mockNetwork(async call => {
      if (call.url.endsWith('/auth/refresh')) { await new Promise(r => setTimeout(r, 20)); return { data: refreshed }; }
      return call.authorization === 'Bearer access-2' ? { data: {} } : { status: 401 };
    });
    await Promise.all([http.get('/a'), http.get('/b'), http.get('/c')]);
    expect(calls.filter(c => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('signs the user out when the refresh is rejected', async () => {
    setSession(makeSession());
    mockNetwork(call => (call.url.endsWith('/auth/refresh') ? { status: 401 } : { status: 401, data: { detail: 'expired' } }));
    const error = await http.get('/accounts').then(() => null, (e: ApiError) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error?.status).toBe(401);
    expect(getSession()).toBeNull();
  });

  it('does not retry again when the retried request is still unauthorized', async () => {
    setSession(makeSession());
    const calls = mockNetwork(call => (call.url.endsWith('/auth/refresh') ? { data: refreshed } : { status: 401 }));
    const error = await http.get('/accounts').then(() => null, (e: ApiError) => e);
    expect(error?.status).toBe(401);
    expect(calls.filter(c => c.url === '/accounts')).toHaveLength(2);
    expect(calls.filter(c => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('fails straight away when there is no refresh token', async () => {
    const calls = mockNetwork(() => ({ status: 401, data: { detail: 'Unauthorized' } }));
    const error = await http.get('/accounts').then(() => null, (e: ApiError) => e);
    expect(error?.status).toBe(401);
    expect(calls).toHaveLength(1);
  });

  it.each(['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'])('never refreshes for %s', async url => {
    setSession(makeSession());
    const calls = mockNetwork(() => ({ status: 401, data: { detail: 'nope' } }));
    const error = await http.post(url, {}).then(() => null, (e: ApiError) => e);
    expect(error?.status).toBe(401);
    expect(calls).toHaveLength(1);
  });

  it.each([400, 403, 404, 500])('does not try to refresh for a %i', async status => {
    setSession(makeSession());
    const calls = mockNetwork(() => ({ status, data: {} }));
    await http.get('/accounts').catch(() => undefined);
    expect(calls).toHaveLength(1);
  });

  it('does not refresh when the network is down', async () => {
    setSession(makeSession());
    const calls = mockNetwork(() => networkError());
    const error = await http.get('/accounts').then(() => null, (e: ApiError) => e);
    expect(error?.message).toBe('NETWORK');
    expect(calls).toHaveLength(1);
  });
});
