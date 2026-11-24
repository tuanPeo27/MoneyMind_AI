import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FALLBACK_VND_PER_USD,
  HIDDEN_AMOUNT,
  areAmountsHidden,
  compact,
  currencySymbol,
  displayCurrency,
  formatAmount,
  fractionDigits,
  fromDisplay,
  money,
  percent,
  setAmountsHidden,
  setDisplayCurrency,
  toDisplay,
  vndPerUsd,
} from './currency';

const bare = (text: string) => text.replace(/\s/g, '');

beforeEach(() => { setDisplayCurrency('VND', FALLBACK_VND_PER_USD); setAmountsHidden(false); });
afterEach(() => { setDisplayCurrency('VND', FALLBACK_VND_PER_USD); setAmountsHidden(false); });

describe('display state', () => {
  it('starts in VND with the fallback rate', () => {
    expect(displayCurrency()).toBe('VND');
    expect(vndPerUsd()).toBe(26_000);
    expect(FALLBACK_VND_PER_USD).toBe(26_000);
  });

  it('switches currency and rate together', () => {
    setDisplayCurrency('USD', 25_000);
    expect(displayCurrency()).toBe('USD');
    expect(vndPerUsd()).toBe(25_000);
  });

  it('exposes fraction digits per currency', () => {
    expect(fractionDigits()).toBe(0);
    setDisplayCurrency('USD', 26_000);
    expect(fractionDigits()).toBe(2);
  });

  it('exposes the symbol and its position', () => {
    expect(currencySymbol()).toEqual({ symbol: '₫', before: false });
    setDisplayCurrency('USD', 26_000);
    expect(currencySymbol()).toEqual({ symbol: '$', before: true });
  });
});

describe('conversion', () => {
  it('leaves VND untouched', () => {
    expect(toDisplay(123_456)).toBe(123_456);
    expect(fromDisplay(123_456)).toBe(123_456);
  });

  it('rounds VND input to whole dong', () => {
    expect(fromDisplay(1234.4)).toBe(1234);
    expect(fromDisplay(1234.5)).toBe(1235);
  });

  it.each([
    [26_000, 1],
    [52_000, 2],
    [13_000, 0.5],
    [0, 0],
    [-26_000, -1],
  ])('converts %i VND to %f USD', (vnd, usd) => {
    setDisplayCurrency('USD', 26_000);
    expect(toDisplay(vnd)).toBe(usd);
  });

  it.each([
    [1, 26_000],
    [0.5, 13_000],
    [1.234, 32_084],
    [0, 0],
  ])('converts %f USD back to %i VND', (usd, vnd) => {
    setDisplayCurrency('USD', 26_000);
    expect(fromDisplay(usd)).toBe(vnd);
  });

  it('uses the current rate', () => {
    setDisplayCurrency('USD', 25_000);
    expect(toDisplay(25_000)).toBe(1);
    expect(fromDisplay(2)).toBe(50_000);
  });

  it('a VND amount survives a display round trip within half a dong', () => {
    setDisplayCurrency('USD', 25_873);
    for (const vnd of [1, 999, 100_000, 31_000_000]) expect(Math.abs(fromDisplay(toDisplay(vnd)) - vnd)).toBeLessThanOrEqual(0);
  });
});

describe('formatAmount (VND)', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1_000, '1.000'],
    [1_234_567, '1.234.567'],
    [100_000_000, '100.000.000'],
    [-5_000, '-5.000'],
    [1_234.6, '1.235'],
  ])('%f -> %s', (vnd, expected) => {
    expect(bare(formatAmount(vnd))).toBe(expected);
  });
});

describe('formatAmount (USD)', () => {
  beforeEach(() => setDisplayCurrency('USD', 26_000));

  it.each([
    [0, '0.00'],
    [26_000, '1.00'],
    [13_000, '0.50'],
    [26_000_000, '1,000.00'],
    [1_000_000_000, '38,461.54'],
    [-26_000, '-1.00'],
  ])('%f VND -> %s', (vnd, expected) => {
    expect(formatAmount(vnd)).toBe(expected);
  });
});

describe('money', () => {
  it('puts the dong sign after the number', () => {
    expect(bare(money(1_234_567))).toBe('1.234.567₫');
    expect(bare(money(0))).toBe('0₫');
    expect(bare(money(-5_000))).toBe('-5.000₫');
  });

  it('puts the dollar sign before the number', () => {
    setDisplayCurrency('USD', 26_000);
    expect(money(26_000)).toBe('$1.00');
    expect(money(0)).toBe('$0.00');
    expect(money(26_000_000)).toBe('$1,000.00');
  });

  it('writes negative dollars as -$', () => {
    setDisplayCurrency('USD', 26_000);
    expect(money(-26_000)).toBe('-$1.00');
  });
});

describe('compact', () => {
  it('shortens big VND amounts', () => {
    const text = compact(1_500_000);
    expect(text).toMatch(/^1,5/);
    expect(text.length).toBeLessThan(10);
  });

  it('keeps small VND amounts readable', () => {
    expect(compact(500)).toBe('500');
  });

  it('shortens USD amounts with a dollar sign', () => {
    setDisplayCurrency('USD', 26_000);
    expect(compact(26_000 * 1_200)).toBe('$1.2K');
    // ICU versions differ: Node 22 prints "$1.0", newer Node prints "$1".
    expect(compact(26_000)).toMatch(/^\$1(\.0)?$/);
  });
});

describe('percent', () => {
  it.each([
    [1, 4, '25,00%'],
    [1, 3, '33,33%'],
    [0, 100, '0,00%'],
    [5, 0, '0,00%'],
    [100, 100, '100,00%'],
    [150, 100, '150,00%'],
    [-1, 4, '-25,00%'],
    [1, 10_000, '0,01%'],
  ])('%f of %f in Vietnamese', (part, total, expected) => {
    expect(bare(percent(part, total))).toBe(expected);
  });

  it('uses a decimal point in English', () => {
    setDisplayCurrency('USD', 26_000);
    expect(bare(percent(1, 4))).toBe('25.00%');
  });

  it('shows a non-zero share that is too small as a less-than value', () => {
    expect(percent(1, 1_000_000)).toMatch(/^</);
    expect(percent(1, 1_000_000)).toContain('0,01');
  });

  it('never shows a zero share with a less-than sign', () => {
    expect(percent(0, 1_000_000)).not.toMatch(/^</);
  });
});

describe('hiding amounts', () => {
  beforeEach(() => setAmountsHidden(true));

  it('reports the flag', () => {
    expect(areAmountsHidden()).toBe(true);
    setAmountsHidden(false);
    expect(areAmountsHidden()).toBe(false);
  });

  it('masks every money helper', () => {
    expect(formatAmount(123)).toBe(HIDDEN_AMOUNT);
    expect(money(123)).toBe(HIDDEN_AMOUNT);
    expect(compact(123)).toBe('•••');
  });

  it('masks USD amounts too', () => {
    setDisplayCurrency('USD', 26_000);
    expect(money(26_000)).toBe(HIDDEN_AMOUNT);
  });

  it('does not mask percentages or conversions', () => {
    expect(percent(1, 4)).not.toBe(HIDDEN_AMOUNT);
    expect(toDisplay(100)).toBe(100);
  });

  it('shows amounts again when switched off', () => {
    setAmountsHidden(false);
    expect(bare(money(1000))).toBe('1.000₫');
  });
});
