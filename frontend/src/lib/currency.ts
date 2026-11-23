import { useEffect, useState } from 'react';

/**
 * Display currency. Amounts are always stored in VND (backend and local state); Vietnamese shows VND,
 * English shows USD converted with the current VND-per-USD exchange rate.
 */
export type Currency = 'VND' | 'USD';

/** Used until the live rate has loaded, or when it cannot be loaded (offline, blocked). */
export const FALLBACK_VND_PER_USD = 26_000;
const RATE_URL = 'https://open.er-api.com/v6/latest/USD';
const RATE_KEY = 'mm-fx-usd-vnd-v1';
const RATE_MAX_AGE = 12 * 60 * 60 * 1000;

// Module-level state so the plain helpers below (money, compact, ...) can be called anywhere, including from
// non-React code. LanguageProvider keeps it in sync and re-renders the tree whenever it changes.
let state: { currency: Currency; rate: number } = { currency: 'VND', rate: FALLBACK_VND_PER_USD };
export function setDisplayCurrency(currency: Currency, rate: number) { state = { currency, rate }; }

/** Shown instead of an amount while amounts are hidden. */
export const HIDDEN_AMOUNT = '••••••';
// "Hide amounts" (the eye on Total balance). When on, every helper below masks its output, so all money on the
// personal workspace is hidden at once: cards, lists, charts, budgets, search results. Set by App on each render.
let amountsHidden = false;
export function setAmountsHidden(hidden: boolean) { amountsHidden = hidden; }
export const areAmountsHidden = () => amountsHidden;
export const displayCurrency = () => state.currency;
export const vndPerUsd = () => state.rate;

/** VND -> display currency (unrounded). */
export const toDisplay = (vnd: number) => state.currency === 'USD' ? vnd / state.rate : vnd;
/** Display currency -> VND, rounded to whole đồng. */
export const fromDisplay = (amount: number) => Math.round(state.currency === 'USD' ? amount * state.rate : amount);
/** Decimal places shown and accepted for the display currency. */
export const fractionDigits = () => state.currency === 'USD' ? 2 : 0;

const formatters = new Map<string, Intl.NumberFormat>();
function nf(key: string, locale: string, options: Intl.NumberFormatOptions) {
  let f = formatters.get(key);
  if (!f) { f = new Intl.NumberFormat(locale, options); formatters.set(key, f); }
  return f;
}
// VND groups thousands with "." (vi-VN), USD with "," (en-US).
const localeOf = (c: Currency) => c === 'USD' ? 'en-US' : 'vi-VN';

/** Number only, grouped every three digits: 100.000.000 (VND) or 3,846.15 (USD). Input is VND. */
export function formatAmount(vnd: number) {
  if (amountsHidden) return HIDDEN_AMOUNT;
  const c = state.currency, digits = fractionDigits();
  return nf(`n-${c}`, localeOf(c), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(toDisplay(vnd));
}
/** Full amount with currency: "100.000.000 ₫" or "$3,846.15". Input is VND. */
export function money(vnd: number) {
  if (amountsHidden) return HIDDEN_AMOUNT;
  return state.currency === 'USD' ? `$${formatAmount(vnd)}`.replace('$-', '-$') : `${formatAmount(vnd)} ₫`;
}
/** Short form for chart axes and tight spaces: "31 Tr" or "$1.2K". Input is VND. */
export function compact(vnd: number) {
  if (amountsHidden) return '•••';
  const c = state.currency;
  return nf(`c-${c}`, localeOf(c), { notation: 'compact', maximumFractionDigits: 1, ...(c === 'USD' ? { style: 'currency', currency: 'USD' } : {}) })
    .format(toDisplay(vnd));
}
/**
 * Share of `part` in `total` with two decimals in the display locale: "99,99%" (vi) / "99.99%" (en).
 * A non-zero share too small to show is written "<0,01%" so it never reads as nothing.
 */
export function percent(part: number, total: number) {
  const f = nf(`p-${state.currency}`, localeOf(state.currency), { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!total || !part) return f.format(0);
  const share = part / total;
  return Math.abs(share) < 0.00005 ? `<${f.format(0.0001)}` : f.format(share);
}
/** Symbol shown next to a bare formatted number, and whether it goes before it ($) or after it (₫). */
export const currencySymbol = () => state.currency === 'USD' ? { symbol: '$', before: true } : { symbol: '₫', before: false };

/** Live VND-per-USD rate, cached for 12 hours. Falls back to the cached or the fixed rate on failure. */
export function useExchangeRate() {
  const [rate, setRate] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(RATE_KEY) || 'null') as { rate: number; at: number } | null;
      if (saved && saved.rate > 0) return saved.rate;
    } catch { /* ignore */ }
    return FALLBACK_VND_PER_USD;
  });
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(RATE_KEY) || 'null') as { rate: number; at: number } | null;
      if (saved && Date.now() - saved.at < RATE_MAX_AGE) return;
    } catch { /* ignore */ }
    const controller = new AbortController();
    fetch(RATE_URL, { signal: controller.signal })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((data: { rates?: Record<string, number> }) => {
        const next = data.rates?.VND;
        // Sanity bounds so a bad response can never turn 1 USD into nonsense.
        if (!next || next < 10_000 || next > 100_000) return;
        setRate(next);
        try { localStorage.setItem(RATE_KEY, JSON.stringify({ rate: next, at: Date.now() })); } catch { /* ignore */ }
      })
      .catch(() => { /* keep the cached or fallback rate */ });
    return () => controller.abort();
  }, []);
  return rate;
}
