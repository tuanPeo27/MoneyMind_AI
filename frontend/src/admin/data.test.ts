import { describe, expect, it } from 'vitest';
import { categoryIcons } from '../components/CategoryIcon';
import { adminNav, aiUsage, initialUsers, platformTransactions, questionTopics, systemCategories } from './data';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

describe('demo platform users', () => {
  it('has six users with unique ids and emails', () => {
    expect(initialUsers).toHaveLength(6);
    expect(new Set(initialUsers.map(u => u.id)).size).toBe(6);
    expect(new Set(initialUsers.map(u => u.email)).size).toBe(6);
  });

  it('has exactly one administrator and the rest are plain users', () => {
    expect(initialUsers.filter(u => u.role === 'ADMIN')).toHaveLength(1);
    expect(initialUsers.filter(u => u.role === 'USER')).toHaveLength(5);
  });

  it('has at least one locked and several active accounts', () => {
    expect(initialUsers.some(u => !u.active)).toBe(true);
    expect(initialUsers.filter(u => u.active).length).toBeGreaterThan(3);
  });

  it('has valid emails and registration dates in order', () => {
    for (const user of initialUsers) {
      expect(user.email).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
      expect(user.registered).toMatch(ISO);
    }
    const dates = initialUsers.map(u => u.registered);
    expect([...dates].sort()).toEqual(dates);
  });
});

describe('demo platform transactions', () => {
  it('has four transactions for each of the five non-admin users', () => {
    expect(platformTransactions).toHaveLength(20);
  });

  it('belongs only to existing non-admin users', () => {
    const allowed = new Set(initialUsers.filter(u => u.role === 'USER').map(u => u.id));
    for (const t of platformTransactions) expect(allowed.has(t.userId)).toBe(true);
  });

  it('has unique ids and positive amounts in whole thousands', () => {
    expect(new Set(platformTransactions.map(t => t.id)).size).toBe(20);
    for (const t of platformTransactions) {
      expect(t.amount).toBeGreaterThan(0);
      expect(t.amount % 1000).toBe(0);
    }
  });

  it('gives later users larger amounts than the first for the same sample', () => {
    const first = platformTransactions.filter(t => t.userId === 'u2');
    const last = platformTransactions.filter(t => t.userId === 'u6');
    const sum = (rows: typeof first) => rows.reduce((s, t) => s + t.amount, 0);
    expect(sum(last)).toBeGreaterThan(sum(first));
  });
});

describe('demo system categories', () => {
  it('has a unique id and a valid icon for each', () => {
    expect(new Set(systemCategories.map(c => c.id)).size).toBe(systemCategories.length);
    for (const c of systemCategories) expect(Object.keys(categoryIcons)).toContain(c.icon);
  });

  it('mirrors the nine default categories', () => {
    expect(systemCategories).toHaveLength(9);
  });
});

describe('demo AI usage', () => {
  it('covers six consecutive days ending today', () => {
    expect(aiUsage).toHaveLength(6);
    expect(aiUsage.map(d => d.daysAgo)).toEqual([5, 4, 3, 2, 1, 0]);
    for (const day of aiUsage) expect(day.date).toMatch(ISO);
    const dates = aiUsage.map(d => d.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('never completes more requests than it received', () => {
    for (const day of aiUsage) {
      expect(day.completed).toBeLessThanOrEqual(day.requests);
      expect(day.tokens).toBeGreaterThan(0);
      expect(day.latency).toBeGreaterThan(0);
    }
  });

  it('labels each day with a short weekday name', () => {
    for (const day of aiUsage) expect(day.name).toMatch(/^[A-Z][a-z]{2}$/);
  });
});

describe('question topics', () => {
  it('shares add up to 100 percent', () => {
    expect(questionTopics.reduce((s, t) => s + t.share, 0)).toBe(100);
  });

  it('has unique names, most popular first', () => {
    expect(new Set(questionTopics.map(t => t.name)).size).toBe(questionTopics.length);
    const shares = questionTopics.map(t => t.share);
    expect([...shares].sort((a, b) => b - a)).toEqual(shares);
  });
});

describe('admin navigation', () => {
  it('has six unique entries under /admin', () => {
    expect(adminNav).toHaveLength(6);
    expect(new Set(adminNav.map(n => n.path)).size).toBe(6);
    for (const item of adminNav) expect(item.path.startsWith('/admin')).toBe(true);
  });

  it('starts at the admin overview', () => {
    expect(adminNav[0].path).toBe('/admin');
  });

  it('labels every entry', () => {
    for (const item of adminNav) {
      expect(item.label).toBeTruthy();
      expect(item.icon).toBeTruthy();
    }
  });
});
