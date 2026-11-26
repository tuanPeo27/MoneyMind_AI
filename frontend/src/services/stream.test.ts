import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, postStream } from './client';
import { streamMessage } from './aiChat';
import { getSession, setSession } from './session';
import { installBrowserStubs, makeSession, mockNetwork } from '../test/helpers';

type FetchCall = { url: string; init: RequestInit };

/** A Response whose body arrives in the given pieces, to check lines split across network chunks. */
function streamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'Content-Type': 'application/x-ndjson' } });
}

function stubFetch(...responses: (Response | Error)[]) {
  const calls: FetchCall[] = [];
  const queue = [...responses];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  }));
  return calls;
}

const line = (event: unknown) => JSON.stringify(event) + '\n';

beforeEach(() => { installBrowserStubs(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('postStream', () => {
  it('posts JSON to /api with the NDJSON accept header and the token', async () => {
    setSession(makeSession({ accessToken: 'tok' }));
    const calls = stubFetch(streamResponse([line({ type: 'done' })]));
    await postStream('/x', { a: 1 }, () => undefined);
    expect(calls[0].url).toBe('/api/x');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ a: 1 });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    expect(headers.Accept).toBe('application/x-ndjson');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('sends no Authorization header when signed out', async () => {
    const calls = stubFetch(streamResponse([line({ type: 'done' })]));
    await postStream('/x', {}, () => undefined);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('delivers every event in order', async () => {
    stubFetch(streamResponse([line({ n: 1 }) + line({ n: 2 }) + line({ n: 3 })]));
    const seen: unknown[] = [];
    await postStream('/x', {}, e => seen.push(e));
    expect(seen).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it('joins a line that is split across chunks', async () => {
    const text = line({ type: 'delta', text: 'xin chào' });
    stubFetch(streamResponse([text.slice(0, 7), text.slice(7, 20), text.slice(20)]));
    const seen: unknown[] = [];
    await postStream('/x', {}, e => seen.push(e));
    expect(seen).toEqual([{ type: 'delta', text: 'xin chào' }]);
  });

  it('keeps multi-byte characters that are split across chunks', async () => {
    const bytes = new TextEncoder().encode(line({ text: 'tiết kiệm' }));
    const cut = bytes.indexOf(0xe1) + 1; // inside the first multi-byte character
    const body = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(bytes.slice(0, cut)); c.enqueue(bytes.slice(cut)); c.close(); },
    });
    stubFetch(new Response(body));
    const seen: unknown[] = [];
    await postStream('/x', {}, e => seen.push(e));
    expect(seen).toEqual([{ text: 'tiết kiệm' }]);
  });

  it('reads a last line that has no newline', async () => {
    stubFetch(streamResponse(['{"n":1}\n{"n":2}']));
    const seen: unknown[] = [];
    await postStream('/x', {}, e => seen.push(e));
    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('skips blank lines', async () => {
    stubFetch(streamResponse(['\n\n{"n":1}\n   \n']));
    const seen: unknown[] = [];
    await postStream('/x', {}, e => seen.push(e));
    expect(seen).toEqual([{ n: 1 }]);
  });

  it('turns an error status into an ApiError with the server message', async () => {
    stubFetch(new Response(JSON.stringify({ title: 'Too many', detail: 'Hết lượt hôm nay.' }), { status: 429 }));
    await expect(postStream('/x', {}, () => undefined)).rejects.toMatchObject({ message: 'Hết lượt hôm nay.', status: 429 });
  });

  it('prefers the first validation message', async () => {
    stubFetch(new Response(JSON.stringify({ errors: { Message: ['Quá dài'] }, detail: 'other' }), { status: 400 }));
    await expect(postStream('/x', {}, () => undefined)).rejects.toMatchObject({ message: 'Quá dài', status: 400 });
  });

  it('falls back to REQUEST_FAILED when the error body is not JSON', async () => {
    stubFetch(new Response('oops', { status: 500 }));
    await expect(postStream('/x', {}, () => undefined)).rejects.toMatchObject({ message: 'REQUEST_FAILED', status: 500 });
  });

  it('reports a network failure as NETWORK', async () => {
    stubFetch(new TypeError('Failed to fetch'));
    await expect(postStream('/x', {}, () => undefined)).rejects.toMatchObject({ message: 'NETWORK', status: 0 });
  });

  it('rethrows an abort as it is, not as a network error', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    stubFetch(abort);
    await expect(postStream('/x', {}, () => undefined)).rejects.toBe(abort);
  });

  it('passes the abort signal to fetch', async () => {
    const controller = new AbortController();
    const calls = stubFetch(streamResponse([line({ type: 'done' })]));
    await postStream('/x', {}, () => undefined, controller.signal);
    expect(calls[0].init.signal).toBe(controller.signal);
  });

  it('refreshes the session once on 401 and retries with the new token', async () => {
    setSession(makeSession({ accessToken: 'old', refreshToken: 'r1' }));
    mockNetwork(call => call.url.endsWith('/auth/refresh')
      ? { data: makeSession({ accessToken: 'new', refreshToken: 'r2' }) }
      : { status: 404 });
    const calls = stubFetch(new Response('', { status: 401 }), streamResponse([line({ n: 1 })]));
    const seen: unknown[] = [];
    await postStream('/x', {}, e => seen.push(e));
    expect(calls).toHaveLength(2);
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer new');
    expect(seen).toEqual([{ n: 1 }]);
    expect(getSession()?.accessToken).toBe('new');
  });

  it('fails with the 401 when the refresh does not work', async () => {
    setSession(makeSession());
    mockNetwork(() => ({ status: 401 }));
    stubFetch(new Response(JSON.stringify({ title: 'Unauthorized' }), { status: 401 }));
    await expect(postStream('/x', {}, () => undefined)).rejects.toMatchObject({ status: 401 });
    expect(getSession()).toBeNull();
  });

  it('does not try to refresh when there is no session', async () => {
    const calls = stubFetch(new Response('', { status: 401 }));
    await expect(postStream('/x', {}, () => undefined)).rejects.toBeInstanceOf(ApiError);
    expect(calls).toHaveLength(1);
  });
});

describe('streamMessage', () => {
  const user = { id: 'm1', role: 'User', content: 'hi' };
  const result = { conversationId: 'c1', userMessage: user, assistantMessage: { id: 'm2', actions: [] }, usage: {} };

  it('posts the message to the stream endpoint', async () => {
    const calls = stubFetch(streamResponse([line({ type: 'done', result })]));
    await streamMessage('c1', 'hello', 'vi', {});
    expect(calls[0].url).toBe('/api/ai/chat/messages/stream');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ conversationId: 'c1', message: 'hello', language: 'vi' });
  });

  it('reports start and each delta, then resolves with the final result', async () => {
    stubFetch(streamResponse([
      line({ type: 'start', conversationId: 'c1', userMessage: user }),
      line({ type: 'delta', text: 'Xin ' }),
      line({ type: 'delta', text: 'chào' }),
      line({ type: 'done', result }),
    ]));
    const onStart = vi.fn();
    const deltas: string[] = [];
    const final = await streamMessage(null, 'hello', undefined, { onStart, onDelta: d => deltas.push(d) });
    expect(onStart).toHaveBeenCalledWith('c1', user);
    expect(deltas).toEqual(['Xin ', 'chào']);
    expect(final).toEqual(result);
  });

  it('works without handlers', async () => {
    stubFetch(streamResponse([line({ type: 'delta', text: 'x' }), line({ type: 'done', result })]));
    await expect(streamMessage(null, 'hello', 'en', {})).resolves.toEqual(result);
  });

  it('rejects with the server message when the stream ends with an error event', async () => {
    stubFetch(streamResponse([line({ type: 'delta', text: 'par' }), line({ type: 'error', message: 'AI down', status: 503 })]));
    await expect(streamMessage(null, 'hello', 'vi', {})).rejects.toMatchObject({ message: 'AI down', status: 503 });
  });

  it('uses defaults for an error event without details', async () => {
    stubFetch(streamResponse([line({ type: 'error' })]));
    await expect(streamMessage(null, 'hello', 'vi', {})).rejects.toMatchObject({ message: 'REQUEST_FAILED', status: 503 });
  });

  it('rejects with NETWORK when the stream ends without a result', async () => {
    stubFetch(streamResponse([line({ type: 'delta', text: 'x' })]));
    await expect(streamMessage(null, 'hello', 'vi', {})).rejects.toMatchObject({ message: 'NETWORK', status: 0 });
  });

  it('ignores unknown event types', async () => {
    stubFetch(streamResponse([line({ type: 'ping' }), line({ type: 'done', result })]));
    await expect(streamMessage(null, 'hello', 'vi', {})).resolves.toEqual(result);
  });

  it('rejects with the server error before the answer starts (limit reached)', async () => {
    stubFetch(new Response(JSON.stringify({ detail: 'Đã hết lượt.' }), { status: 429 }));
    await expect(streamMessage(null, 'hello', 'vi', {})).rejects.toMatchObject({ message: 'Đã hết lượt.', status: 429 });
  });
});
