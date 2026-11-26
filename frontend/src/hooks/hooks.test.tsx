import { createElement, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocal } from './useLocal';
import { usePagination, type Pager } from '../components/Pagination';
import { useSession } from '../services/session';
import { LanguageProvider, useLanguage } from '../i18n';
import { FALLBACK_VND_PER_USD, displayCurrency, setDisplayCurrency, vndPerUsd } from '../lib/currency';
import { installBrokenStorage, installBrowserStubs, makeSession, SESSION_KEY } from '../test/helpers';

/** Renders a component that runs `use` once on the server and returns what the hook returned. */
function renderHook<T>(use: () => T, wrap: (children: ReactNode) => ReactNode = c => c): T {
  let result!: T;
  function Probe() { result = use(); return null; }
  renderToString(wrap(createElement(Probe)) as never);
  return result;
}

let env: ReturnType<typeof installBrowserStubs>;
beforeEach(() => {
  env = installBrowserStubs();
  vi.spyOn(console, 'error').mockImplementation(() => undefined); // React warns that layout effects do not run on the server
  setDisplayCurrency('VND', FALLBACK_VND_PER_USD);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); setDisplayCurrency('VND', FALLBACK_VND_PER_USD); });

describe('useLocal (initial value)', () => {
  it('returns the initial value when nothing is saved', () => {
    const [value] = renderHook(() => useLocal('k', 5));
    expect(value).toBe(5);
  });

  it('calls a lazy initializer', () => {
    const [value] = renderHook(() => useLocal('k', () => ({ made: true })));
    expect(value).toEqual({ made: true });
  });

  it('prefers the saved value', () => {
    env.store.set('k', JSON.stringify({ a: 1 }));
    const [value] = renderHook(() => useLocal('k', { a: 0 }));
    expect(value).toEqual({ a: 1 });
  });

  it('reads each key separately, so accounts never share data', () => {
    env.store.set('mm-goals-user-1', JSON.stringify(['one']));
    env.store.set('mm-goals-user-2', JSON.stringify(['two']));
    expect(renderHook(() => useLocal('mm-goals-user-1', []))[0]).toEqual(['one']);
    expect(renderHook(() => useLocal('mm-goals-user-2', []))[0]).toEqual(['two']);
    expect(renderHook(() => useLocal('mm-goals-user-3', ['none']))[0]).toEqual(['none']);
  });

  it('falls back to the initial value for corrupt JSON', () => {
    env.store.set('k', '{broken');
    expect(renderHook(() => useLocal('k', 'fallback'))[0]).toBe('fallback');
  });

  it('falls back when storage is blocked', () => {
    installBrokenStorage();
    expect(renderHook(() => useLocal('k', 'fallback'))[0]).toBe('fallback');
  });

  it('returns a setter and no storage error at first', () => {
    const [, setValue, error] = renderHook(() => useLocal('k', 1));
    expect(typeof setValue).toBe('function');
    expect(error).toBe(false);
  });

  it('reads saved booleans and strings of the right type', () => {
    env.store.set('flag', 'true');
    env.store.set('name', '"An"');
    expect(renderHook(() => useLocal('flag', false))[0]).toBe(true);
    expect(renderHook(() => useLocal('name', ''))[0]).toBe('An');
  });
});

describe('usePagination (first page)', () => {
  const items = Array.from({ length: 25 }, (_, i) => i + 1);
  const pager = <T,>(list: T[], size?: number): Pager<T> => renderHook(() => usePagination(list, size));

  it('slices the first page', () => {
    const p = pager(items);
    expect(p.items).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(p.page).toBe(1);
    expect(p.size).toBe(10);
    expect(p.start).toBe(0);
  });

  it('counts pages and total', () => {
    const p = pager(items);
    expect(p.total).toBe(25);
    expect(p.pageCount).toBe(3);
  });

  it('honors a custom page size', () => {
    const p = pager(items, 5);
    expect(p.items).toEqual([1, 2, 3, 4, 5]);
    expect(p.pageCount).toBe(5);
  });

  it('shows everything when the list is shorter than a page', () => {
    const p = pager([1, 2, 3]);
    expect(p.items).toEqual([1, 2, 3]);
    expect(p.pageCount).toBe(1);
  });

  it('has exactly one empty page for an empty list', () => {
    const p = pager([]);
    expect(p.items).toEqual([]);
    expect(p.pageCount).toBe(1);
    expect(p.total).toBe(0);
    expect(p.page).toBe(1);
  });

  it('fits an exact multiple into whole pages', () => {
    expect(pager(items.slice(0, 20)).pageCount).toBe(2);
    expect(pager(items.slice(0, 21)).pageCount).toBe(3);
  });

  it('exposes setters', () => {
    const p = pager(items);
    expect(typeof p.setPage).toBe('function');
    expect(typeof p.setSize).toBe('function');
  });
});

describe('useSession (initial value)', () => {
  it('is signed out without a saved session', () => {
    expect(renderHook(() => useSession()).session).toBeNull();
  });

  it('restores a saved session', () => {
    env.store.set(SESSION_KEY, JSON.stringify(makeSession({ accessToken: 'saved' })));
    expect(renderHook(() => useSession()).session?.accessToken).toBe('saved');
  });

  it('is signed out for a corrupt session', () => {
    env.store.set(SESSION_KEY, 'nope');
    expect(renderHook(() => useSession()).session).toBeNull();
  });

  it('offers a sign-out function', () => {
    expect(typeof renderHook(() => useSession()).signOut).toBe('function');
  });
});

describe('LanguageProvider', () => {
  const inProvider = <T,>() => (children: ReactNode) => createElement(LanguageProvider, null, children as never);
  const useIt = () => useLanguage();
  const render = () => renderHook(useIt, inProvider());

  it('defaults to English with US dollars', () => {
    const l = render();
    expect(l.language).toBe('en');
    expect(l.locale).toBe('en-GB');
    expect(l.currency).toBe('USD');
  });

  it('switches the whole app to Vietnamese and dong from the saved preference', () => {
    env.store.set('mm-language-v1', '"vi"');
    const l = render();
    expect(l.language).toBe('vi');
    expect(l.locale).toBe('vi-VN');
    expect(l.currency).toBe('VND');
  });

  it('falls back to English for any other saved value', () => {
    env.store.set('mm-language-v1', '"fr"');
    expect(render().language).toBe('en');
  });

  it('sets the display currency used by the money helpers', () => {
    env.store.set('mm-language-v1', '"vi"');
    render();
    expect(displayCurrency()).toBe('VND');
    env.store.set('mm-language-v1', '"en"');
    render();
    expect(displayCurrency()).toBe('USD');
  });

  it('uses the fallback exchange rate when none is cached', () => {
    expect(render().rate).toBe(FALLBACK_VND_PER_USD);
    expect(vndPerUsd()).toBe(FALLBACK_VND_PER_USD);
  });

  it('uses a cached exchange rate', () => {
    env.store.set('mm-fx-usd-vnd-v1', JSON.stringify({ rate: 25_500, at: Date.now() }));
    expect(render().rate).toBe(25_500);
    expect(vndPerUsd()).toBe(25_500);
  });

  it.each([
    ['a corrupt cache', '{x'],
    ['a zero rate', JSON.stringify({ rate: 0, at: 1 })],
    ['a negative rate', JSON.stringify({ rate: -5, at: 1 })],
    ['a null cache', 'null'],
  ])('ignores %s', (_name, cached) => {
    env.store.set('mm-fx-usd-vnd-v1', cached);
    expect(render().rate).toBe(FALLBACK_VND_PER_USD);
  });

  describe('translator', () => {
    it('keeps English text as it is', () => {
      expect(render().t('Edit {name}', { name: 'Lunch' })).toBe('Edit Lunch');
    });

    it('translates known text into Vietnamese', () => {
      env.store.set('mm-language-v1', '"vi"');
      const { t } = render();
      expect(t('Edit {name}', { name: 'Bữa trưa' })).toBe('Sửa Bữa trưa');
      expect(t('Showing {count} of {total} transactions', { count: 3, total: 10 })).toBe('Hiển thị 3/10 giao dịch');
    });

    it('returns unknown text unchanged', () => {
      env.store.set('mm-language-v1', '"vi"');
      expect(render().t('A sentence nobody translated')).toBe('A sentence nobody translated');
    });

    it('leaves a placeholder in place when no value is given for it', () => {
      env.store.set('mm-language-v1', '"vi"');
      expect(render().t('Edit {name}', {})).toBe('Sửa {name}');
      expect(render().t('Edit {name}')).toBe('Sửa {name}');
    });

    it('fills every occurrence and accepts numbers', () => {
      expect(render().t('{n} and {n} and {m}', { n: 1, m: 2 })).toBe('1 and 1 and 2');
    });

    it('does not use object prototype names as translations', () => {
      env.store.set('mm-language-v1', '"vi"');
      const { t } = render();
      expect(t('constructor')).toBe('constructor');
      expect(t('toString')).toBe('toString');
    });

    it('works with empty text', () => {
      expect(render().t('')).toBe('');
    });
  });

  it('refuses to be used outside the provider', () => {
    expect(() => renderHook(() => useLanguage())).toThrow('LanguageProvider is required');
  });
});
