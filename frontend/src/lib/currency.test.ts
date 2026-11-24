import { afterEach, describe, expect, it } from 'vitest';
import {
  FALLBACK_VND_PER_USD,
  areAmountsHidden,
  compact,
  formatAmount,
  fromDisplay,
  money,
  percent,
  setAmountsHidden,
  setDisplayCurrency,
  toDisplay,
} from './currency';

describe('currency helpers', () => {
  afterEach(() => {
    setDisplayCurrency('VND', FALLBACK_VND_PER_USD);
    setAmountsHidden(false);
  });

  it('stores VND and converts USD display values without drift for unchanged VND', () => {
    setDisplayCurrency('USD', 26000);
    expect(toDisplay(26000)).toBe(1);
    expect(fromDisplay(1)).toBe(26000);
  });

  it('formats VND and USD amounts', () => {
    setDisplayCurrency('VND', 26000);
    expect(formatAmount(100000000)).toContain('100');
    expect(money(100000000)).toContain('₫');

    setDisplayCurrency('USD', 26000);
    expect(formatAmount(26000)).toContain('1');
    expect(money(26000)).toContain('$');
  });

  it('formats compact chart values', () => {
    setDisplayCurrency('VND', 26000);
    expect(compact(3100000000)).not.toBe('');
    setDisplayCurrency('USD', 26000);
    expect(compact(26000)).toContain('$');
  });

  it('handles zero, negative and very small percentages', () => {
    expect(percent(0, 100)).toContain('0');
    expect(percent(25, 100)).toContain('25');
    expect(percent(1, 100000)).toContain('<');
  });

  it('masks personal amounts globally', () => {
    setAmountsHidden(true);
    expect(areAmountsHidden()).toBe(true);
    expect(money(100000)).toBe('••••••');
  });
});
