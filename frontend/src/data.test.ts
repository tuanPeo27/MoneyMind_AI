import { describe, expect, it } from 'vitest';
import { dateLabel, initialBudgets, initialCategories, localDate, seedTransactions, today, usePeriodRange } from './data';
import { pagePaths } from './routing';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

describe('localDate', () => {
  it.each([
    [new Date(2025, 0, 5), '2025-01-05'],
    [new Date(2025, 11, 31), '2025-12-31'],
    [new Date(2024, 1, 29), '2024-02-29'],
    [new Date(2025, 8, 9), '2025-09-09'],
    [new Date(2000, 0, 1), '2000-01-01'],
  ])('formats %s as %s', (date, expected) => {
    expect(localDate(date)).toBe(expected);
  });

  it('uses the local calendar day, not UTC', () => {
    expect(localDate(new Date(2025, 5, 15, 23, 59))).toBe('2025-06-15');
    expect(localDate(new Date(2025, 5, 15, 0, 1))).toBe('2025-06-15');
  });

  it('exports today as the current local date', () => {
    expect(today).toMatch(ISO);
    expect(today).toBe(localDate(new Date()));
  });
});

describe('dateLabel', () => {
  it('writes day, short month and year in British English', () => {
    expect(dateLabel('2025-03-05')).toBe('05 Mar 2025');
  });

  it('follows the requested locale', () => {
    expect(dateLabel('2025-03-05', 'vi-VN')).toContain('2025');
    expect(dateLabel('2025-03-05', 'en-US')).toContain('2025');
  });

  it('does not slip a day because of the time zone', () => {
    expect(dateLabel('2025-01-01')).toBe('01 Jan 2025');
    expect(dateLabel('2025-12-31')).toBe('31 Dec 2025');
  });
});

describe('initial data', () => {
  it('has nine default categories: seven expense and two income', () => {
    expect(initialCategories).toHaveLength(9);
    expect(initialCategories.filter(c => c.type === 'Expense')).toHaveLength(7);
    expect(initialCategories.filter(c => c.type === 'Income')).toHaveLength(2);
  });

  it('has unique category names and valid hex colors', () => {
    expect(new Set(initialCategories.map(c => c.name)).size).toBe(initialCategories.length);
    for (const c of initialCategories) expect(c.color).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('has budgets only for existing expense categories with positive limits', () => {
    expect(initialBudgets).toHaveLength(4);
    for (const b of initialBudgets) {
      const category = initialCategories.find(c => c.name === b.category);
      expect(category?.type).toBe('Expense');
      expect(b.limit).toBeGreaterThan(0);
    }
    expect(new Set(initialBudgets.map(b => b.id)).size).toBe(initialBudgets.length);
  });
});

describe('seedTransactions', () => {
  const rows = seedTransactions();

  it('creates ten transactions for each of six months', () => {
    expect(rows).toHaveLength(60);
  });

  it('gives every transaction a unique id', () => {
    expect(new Set(rows.map(r => r.id)).size).toBe(60);
  });

  it('only uses the default categories, with a matching type', () => {
    for (const row of rows) {
      const category = initialCategories.find(c => c.name === row.category);
      expect(category, row.category).toBeDefined();
      expect(row.type).toBe(category!.type);
    }
  });

  it('has positive amounts in whole thousands of dong', () => {
    for (const row of rows) {
      expect(row.amount).toBeGreaterThan(0);
      expect(row.amount % 1000).toBe(0);
    }
  });

  it('has valid dates that are never in the future', () => {
    for (const row of rows) {
      expect(row.date).toMatch(ISO);
      expect(row.date <= today).toBe(true);
    }
  });

  it('uses the exact base amounts for the current month', () => {
    const current = rows.filter(r => r.id.startsWith('t-0-'));
    expect(current).toHaveLength(10);
    expect(current.find(r => r.category === 'Lương')?.amount).toBe(30_000_000);
    expect(current.find(r => r.category === 'Nhà ở')?.amount).toBe(5_000_000);
  });

  it('varies the older months', () => {
    const salary = rows.filter(r => r.category === 'Lương').map(r => r.amount);
    expect(new Set(salary).size).toBeGreaterThan(1);
  });

  it('names the accounts of the demo wallets', () => {
    expect(new Set(rows.map(r => r.account))).toEqual(new Set(['MoMo', 'Vietcombank', 'Tiền mặt']));
  });

  it('starts every transaction without notes', () => {
    expect(rows.every(r => r.notes === '')).toBe(true);
  });
});

describe('usePeriodRange (plain date helper)', () => {
  const now = new Date();
  const custom = { start: '2025-02-01', end: '2025-02-10' };

  it('returns the custom range untouched', () => {
    expect(usePeriodRange('Custom', custom)).toBe(custom);
  });

  it('covers the current month for "This month"', () => {
    const range = usePeriodRange('This month', custom);
    expect(range.start).toBe(localDate(new Date(now.getFullYear(), now.getMonth(), 1)));
    expect(range.end).toBe(localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
  });

  it('covers the previous month for "Last month"', () => {
    const range = usePeriodRange('Last month', custom);
    expect(range.start).toBe(localDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
    expect(range.end).toBe(localDate(new Date(now.getFullYear(), now.getMonth(), 0)));
  });

  it('starts "This year" in January and ends with the current month', () => {
    const range = usePeriodRange('This year', custom);
    expect(range.start).toBe(`${now.getFullYear()}-01-01`);
    expect(range.end).toBe(localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
  });

  it('treats an unknown period like "This month"', () => {
    expect(usePeriodRange('Whatever', custom)).toEqual(usePeriodRange('This month', custom));
  });

  it('always returns start on or before end', () => {
    for (const period of ['This month', 'Last month', 'This year']) {
      const { start, end } = usePeriodRange(period, custom);
      expect(start <= end).toBe(true);
    }
  });
});

describe('page routes', () => {
  const pages = [
    'Overview', 'Accounts', 'Transactions', 'Budgets', 'Savings Funds', 'Categories', 'Reports',
    'AI Financial Assistant', 'Smart Insights', 'Settings', 'Workspace', 'Notifications',
  ];

  it('has a path for every page and no extras', () => {
    expect(Object.keys(pagePaths).sort()).toEqual([...pages].sort());
  });

  it('uses unique paths', () => {
    const paths = Object.values(pagePaths);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('serves Overview at the root', () => {
    expect(pagePaths.Overview).toBe('/');
  });

  it('starts every path with a slash and never ends with one except the root', () => {
    for (const path of Object.values(pagePaths)) {
      expect(path.startsWith('/')).toBe(true);
      if (path !== '/') expect(path.endsWith('/')).toBe(false);
    }
  });

  it('keeps admin routes out of the user pages', () => {
    for (const path of Object.values(pagePaths)) expect(path.startsWith('/admin')).toBe(false);
  });

  it.each([
    ['Savings Funds', '/savings'],
    ['AI Financial Assistant', '/assistant'],
    ['Smart Insights', '/insights'],
    ['Transactions', '/transactions'],
  ])('maps %s to %s', (page, path) => {
    expect(pagePaths[page as keyof typeof pagePaths]).toBe(path);
  });
});
