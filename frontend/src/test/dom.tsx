import '@testing-library/jest-dom/vitest';
import { cleanup, render, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { LanguageProvider } from '../i18n';
import { FALLBACK_VND_PER_USD, setAmountsHidden, setDisplayCurrency } from '../lib/currency';

/** Newer Node versions ship an experimental localStorage that is unusable without a flag, so use a plain in-memory one. */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.has(key) ? this.data.get(key)! : null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
  [name: string]: unknown;
}
const memoryStorage = new MemoryStorage();
for (const target of new Set<object>([globalThis, window])) {
  Object.defineProperty(target, 'localStorage', { value: memoryStorage, configurable: true, writable: true });
}

/**
 * Shared setup for component tests (import this file first). Registers cleanup, browser APIs that jsdom lacks,
 * and a render helper that wraps the UI in the real LanguageProvider.
 */
beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  class ResizeObserverStub { observe() { /* noop */ } unobserve() { /* noop */ } disconnect() { /* noop */ } }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
  Element.prototype.scrollIntoView = () => undefined;
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
});

beforeEach(() => {
  localStorage.clear();
  setDisplayCurrency('VND', FALLBACK_VND_PER_USD);
  setAmountsHidden(false);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.body.style.overflow = '';
  vi.restoreAllMocks();
});

export type AppLanguage = 'en' | 'vi';

/** Renders inside the real LanguageProvider with a fresh exchange-rate cache, so no network request is made. */
export function renderApp(ui: ReactElement, options: { language?: AppLanguage } & Omit<RenderOptions, 'wrapper'> = {}) {
  const { language = 'en', ...rest } = options;
  localStorage.setItem('mm-language-v1', JSON.stringify(language));
  localStorage.setItem('mm-fx-usd-vnd-v1', JSON.stringify({ rate: FALLBACK_VND_PER_USD, at: Date.now() }));
  return render(ui, { wrapper: LanguageProvider, ...rest });
}

export const setupUser = () => userEvent.setup();
