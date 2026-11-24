import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSession, patchSessionUser, setSession } from './session';
import { SESSION_KEY, installBrokenStorage, installBrowserStubs, makeSession } from '../test/helpers';

describe('session storage', () => {
  let env: ReturnType<typeof installBrowserStubs>;
  beforeEach(() => { env = installBrowserStubs(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('has no session at first', () => {
    expect(getSession()).toBeNull();
  });

  it('saves and reads a session back', () => {
    const session = makeSession();
    setSession(session);
    expect(getSession()).toEqual(session);
  });

  it('stores the session as JSON under a versioned key', () => {
    setSession(makeSession());
    expect(JSON.parse(env.store.get(SESSION_KEY)!).accessToken).toBe('access-1');
  });

  it('clears the session with null', () => {
    setSession(makeSession());
    setSession(null);
    expect(getSession()).toBeNull();
    expect(env.store.has(SESSION_KEY)).toBe(false);
  });

  it('replaces the previous session', () => {
    setSession(makeSession({ accessToken: 'a' }));
    setSession(makeSession({ accessToken: 'b' }));
    expect(getSession()?.accessToken).toBe('b');
  });

  it('announces every change so open tabs and hooks can update', () => {
    setSession(makeSession());
    setSession(null);
    expect(env.win.dispatchEvent).toHaveBeenCalledTimes(2);
    const event = env.win.dispatchEvent.mock.calls[0][0] as Event;
    expect(event.type).toBe('mm-auth-session-change');
  });

  it('treats corrupt JSON as signed out', () => {
    env.store.set(SESSION_KEY, '{not json');
    expect(getSession()).toBeNull();
  });

  it('treats an empty value as signed out', () => {
    env.store.set(SESSION_KEY, '');
    expect(getSession()).toBeNull();
  });
});

describe('patchSessionUser', () => {
  beforeEach(() => { installBrowserStubs(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('updates only the given user fields', () => {
    setSession(makeSession());
    patchSessionUser({ fullName: 'New Name', phoneNumber: '0901234567' });
    const user = getSession()!.user;
    expect(user.fullName).toBe('New Name');
    expect(user.phoneNumber).toBe('0901234567');
    expect(user.email).toBe('an@x.com');
    expect(user.roles).toEqual(['User']);
  });

  it('keeps both tokens untouched', () => {
    setSession(makeSession());
    patchSessionUser({ fullName: 'X' });
    expect(getSession()!.accessToken).toBe('access-1');
    expect(getSession()!.refreshToken).toBe('refresh-1');
  });

  it('does nothing when signed out', () => {
    patchSessionUser({ fullName: 'X' });
    expect(getSession()).toBeNull();
  });

  it('can clear the avatar', () => {
    setSession(makeSession());
    patchSessionUser({ avatarUrl: null });
    expect(getSession()!.user.avatarUrl).toBeNull();
  });
});

describe('when browser storage is blocked', () => {
  beforeEach(() => { installBrokenStorage(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('reading returns null instead of throwing', () => {
    expect(getSession()).toBeNull();
  });

  it('writing does not throw', () => {
    expect(() => setSession(makeSession())).not.toThrow();
    expect(() => setSession(null)).not.toThrow();
  });
});
