import { createContext } from 'react';
import type { Transaction } from '../data';

// Kept out of pages/Overview so App and other pages can use them without loading the Overview chunk (and its charts).

export type Totals = { income: number; expense: number; savings: number; balance: number; rate: number };

export function getTotals(rows: Transaction[]): Totals {
  const income = rows.filter(t => t.type === 'Income').reduce((s, t) => s + t.amount, 0);
  const expense = rows.filter(t => t.type === 'Expense').reduce((s, t) => s + t.amount, 0);
  // `balance` here is only the period's net. The real account balance comes from BalanceContext (see SummaryCards).
  return { income, expense, savings: income - expense, balance: income - expense, rate: income ? (income - expense) / income * 100 : 0 };
}

/**
 * Real account balance (opening balances of the user's accounts + every transaction up to the date):
 * current at the end of the selected period, previous at the end of the period before it. Provided by App.
 */
export const BalanceContext = createContext<{ current: number; previous: number } | null>(null);

export const percentChange = (current: number, previous: number) => previous ? (current - previous) / previous * 100 : 0;
