import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Budget, Transaction } from '../../data';
import { FALLBACK_VND_PER_USD, setDisplayCurrency } from '../../lib/currency';
import { money } from '../../data';
import { emptyContext, getPrompts, simulateFinancialResponse, type FinancialContext } from './mockAssistant';

let seq = 0;
const tx = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: `t${++seq}`, description: 'Item', amount: 100_000, type: 'Expense', category: 'Ăn uống', account: 'MoMo',
  date: '2025-01-10', notes: '', ...overrides,
});

const budget = (category: string, limit: number): Budget => ({ id: `b-${category}`, category, limit });

function context(overrides: Partial<FinancialContext> = {}): FinancialContext {
  return {
    ...emptyContext,
    rows: [
      tx({ type: 'Income', category: 'Lương', amount: 10_000_000, description: 'Salary' }),
      tx({ category: 'Ăn uống', amount: 600_000, description: 'Big lunch' }),
      tx({ category: 'Mua sắm', amount: 200_000, description: 'Shirt' }),
    ],
    ...overrides,
  };
}

// income 10,000,000 - expense 800,000 = 9,200,000 net
const INCOME = 10_000_000, EXPENSE = 800_000, NET = 9_200_000;

beforeEach(() => setDisplayCurrency('VND', FALLBACK_VND_PER_USD));
afterEach(() => setDisplayCurrency('VND', FALLBACK_VND_PER_USD));

describe('getPrompts', () => {
  const adminPrompts = ['Summarize platform activity.', 'Explain the AI usage metrics.', 'What should an administrator review?'];

  it.each(['Admin Overview', 'Admin Users', 'User Management', 'AI Usage & Analytics'])('suggests admin prompts on %s', page => {
    expect(getPrompts(page)).toEqual(adminPrompts);
  });

  it.each(['Transactions', 'Reports', 'Categories', 'Settings'])('has its own prompts for %s', page => {
    const prompts = getPrompts(page);
    expect(prompts).toHaveLength(3);
    expect(prompts).not.toEqual(getPrompts('Overview'));
  });
  it('has the four budget prompts on Budgets', () => {
    expect(getPrompts('Budgets')).toEqual(['Analyse my budget this month.', 'Which category am I spending the most on?',
      'How can I save more on my budget?', 'Forecast my spending at the end of the month.']);
  });

  it.each(['Overview', 'Accounts', 'Something else', ''])('offers the four general prompts on %j', page => {
    expect(getPrompts(page)).toHaveLength(4);
    expect(getPrompts(page)).toContain('Give me a financial health summary.');
  });

  it('never returns empty or duplicate prompts', () => {
    for (const page of ['Overview', 'Transactions', 'Budgets', 'Reports', 'Categories', 'Settings', 'Admin Overview']) {
      const prompts = getPrompts(page);
      expect(new Set(prompts).size).toBe(prompts.length);
      for (const prompt of prompts) expect(prompt.trim()).not.toBe('');
    }
  });
});

describe('emptyContext', () => {
  it('describes an empty overview page', () => {
    expect(emptyContext).toMatchObject({ route: '/', page: 'Overview', period: 'This month', rows: [], previous: [], budgets: [] });
  });
});

describe('simulateFinancialResponse: administration', () => {
  it('explains the admin workspace when there is no platform data', () => {
    const answer = simulateFinancialResponse('hello', context({ route: '/admin' }));
    expect(answer.text).toContain('administration workspace');
    expect(answer.metrics).toBeUndefined();
  });

  it('summarizes platform data when it is given', () => {
    const answer = simulateFinancialResponse('hello', context({
      route: '/admin/users', platform: { users: 6, active: 5, requests: 215, volume: 90_000_000 },
    }));
    expect(answer.text).toContain('6 registered users');
    expect(answer.text).toContain('5 active accounts');
    expect(answer.text).toContain('215 requests');
    expect(answer.metrics?.map(m => m.label)).toEqual(['Platform users', 'AI requests', 'Demo financial volume']);
    expect(answer.metrics?.[2].value).toBe(money(90_000_000));
  });

  it('never mixes personal finances into admin answers', () => {
    const answer = simulateFinancialResponse('where is my money going', context({ route: '/admin' }));
    expect(answer.text).not.toContain('Ăn uống');
  });
});

describe('simulateFinancialResponse: privacy', () => {
  it.each(['How is my data stored?', 'what about privacy', 'data storage?'])('answers %j without touching the numbers', question => {
    const answer = simulateFinancialResponse(question, context());
    expect(answer.text).toContain('localStorage');
    expect(answer.text).toContain('Nothing is sent to an AI provider');
    expect(answer.metrics).toBeUndefined();
  });
});

describe('simulateFinancialResponse: selected transaction', () => {
  const selected = tx({ description: 'Coffee beans', amount: 250_000, category: 'Ăn uống', date: '2025-01-05', account: 'MoMo', notes: 'gift for dad' });

  it('describes the selected transaction', () => {
    const answer = simulateFinancialResponse('tell me about this transaction', context({ selection: { transaction: selected } }));
    expect(answer.text).toContain('Coffee beans');
    expect(answer.text).toContain(money(250_000));
    expect(answer.text).toContain('2025-01-05');
    expect(answer.text).toContain('MoMo');
    expect(answer.text).toContain('Your note: gift for dad.');
    expect(answer.highlight).toBe('transactions');
  });

  it('says so when there are no notes', () => {
    const answer = simulateFinancialResponse('explain this', context({ selection: { transaction: { ...selected, notes: '' } } }));
    expect(answer.text).toContain('no additional notes');
  });

  it('refuses to call a transaction fraudulent', () => {
    const answer = simulateFinancialResponse('is this selected one fraud?', context({ selection: { transaction: selected } }));
    expect(answer.text).toContain('cannot verify whether this is fraudulent');
  });
});

describe('simulateFinancialResponse: no data', () => {
  it('asks for another date range when there are no rows', () => {
    const answer = simulateFinancialResponse('where is my money going', context({ rows: [] }));
    expect(answer.text).toContain('no transactions in your selected date range');
    expect(answer.highlight).toBe('transactions');
  });
});

describe('simulateFinancialResponse: affordability', () => {
  it('says a small purchase fits within 30% of the surplus', () => {
    const answer = simulateFinancialResponse('Can I afford 1 million?', context());
    expect(answer.text).toContain(`A ${money(1_000_000)} purchase would leave ${money(NET - 1_000_000)}`);
    expect(answer.text).toContain('fits within 30%');
    expect(answer.highlight).toBe('summary');
    expect(answer.metrics?.[0]).toEqual({ label: 'Period surplus', value: money(NET) });
  });

  it('warns that a large purchase uses a big share of the surplus', () => {
    const answer = simulateFinancialResponse('Can I afford 5 million?', context());
    expect(answer.text).toContain('significant share');
  });

  it.each([
    ['can i afford 3 million', 3_000_000],
    ['can i afford 2 triệu', 2_000_000],
    ['can i afford 500k', 500_000],
    ['can i afford 300 nghìn', 300_000],
    ['can i afford 750000 vnd', 750_000],
    ['can i afford 1,500,000', 1_500_000],
  ])('reads the amount in %j', (question, vnd) => {
    const answer = simulateFinancialResponse(question, context());
    expect(answer.text).toContain(`A ${money(vnd)} purchase`);
  });

  it('converts an explicit USD amount with the current rate', () => {
    const answer = simulateFinancialResponse('can i afford 100 usd', context());
    expect(answer.text).toContain(`A ${money(2_600_000)} purchase`);
  });

  it('treats a bare number as dollars when the display currency is USD', () => {
    setDisplayCurrency('USD', 25_000);
    const answer = simulateFinancialResponse('can i afford 100', context());
    expect(answer.text).toContain(`A ${money(2_500_000)} purchase`);
  });

  it('treats a bare number as dong when the display currency is VND', () => {
    const answer = simulateFinancialResponse('can i afford 100000', context());
    expect(answer.text).toContain(`A ${money(100_000)} purchase`);
  });

  it('asks for the price when none is given', () => {
    const answer = simulateFinancialResponse('can I afford this purchase?', context());
    expect(answer.text).toContain('What is the purchase price?');
    expect(answer.text).toContain(money(NET));
  });

  it('continues an affordability chat when a number follows a summary', () => {
    const answer = simulateFinancialResponse('what about 2 million', context(), 'summary');
    expect(answer.text).toContain(`A ${money(2_000_000)} purchase`);
  });

  it('reports a negative balance when the purchase exceeds the surplus', () => {
    const answer = simulateFinancialResponse('can i afford 20 million', context());
    expect(answer.text).toContain(money(NET - 20_000_000));
    expect(answer.text).toContain('significant share');
  });

  it('never says a purchase fits when the period has no surplus', () => {
    const deficit = context({ rows: [tx({ amount: 500_000 })] });
    const answer = simulateFinancialResponse('can i afford 100k', deficit);
    expect(answer.text).toContain('significant share');
  });
});

describe('simulateFinancialResponse: budgets', () => {
  const rows = [tx({ type: 'Income', category: 'Lương', amount: 10_000_000 }), tx({ category: 'Ăn uống', amount: 800_000 }), tx({ category: 'Mua sắm', amount: 100_000 })];

  it('names the budget closest to its limit', () => {
    const answer = simulateFinancialResponse('Which budget is close to its limit?', context({
      rows, budgets: [budget('Ăn uống', 1_000_000), budget('Mua sắm', 1_000_000)],
    }));
    expect(answer.text).toContain(`Ăn uống is closest to its limit: ${money(800_000)} of ${money(1_000_000)} (80%)`);
    expect(answer.text).toContain(`You have ${money(200_000)} left.`);
    expect(answer.highlight).toBe('budgets');
    expect(answer.metrics).toEqual([{ label: 'Ăn uống used', value: '80%' }, { label: 'Remaining', value: money(200_000) }]);
  });

  it('says how far over budget a category is', () => {
    const answer = simulateFinancialResponse('which budget is over the limit', context({ rows, budgets: [budget('Ăn uống', 500_000)] }));
    expect(answer.text).toContain(`It is ${money(300_000)} over budget.`);
    expect(answer.metrics?.[0].value).toBe('160%');
  });

  it('ranks by the share used, not by the amount', () => {
    const answer = simulateFinancialResponse('budget status', context({
      rows, budgets: [budget('Ăn uống', 10_000_000), budget('Mua sắm', 120_000)],
    }));
    expect(answer.text).toContain('Mua sắm is closest');
  });

  it('suggests a 50/30/20 plan when there are no budgets', () => {
    const answer = simulateFinancialResponse('help me with my budget', context({ rows, budgets: [] }));
    expect(answer.text).toContain('50/30/20');
    expect(answer.metrics).toBeUndefined();
    expect(answer.highlight).toBe('budgets');
  });

  it('recognizes Vietnamese budget words', () => {
    const answer = simulateFinancialResponse('ngân sách của tôi', context({ rows, budgets: [budget('Ăn uống', 1_000_000)] }));
    expect(answer.highlight).toBe('budgets');
  });

  it('keeps talking about budgets in a follow-up', () => {
    const answer = simulateFinancialResponse('why?', context({ rows, budgets: [budget('Ăn uống', 1_000_000)] }), 'budgets');
    expect(answer.highlight).toBe('budgets');
  });
});

describe('simulateFinancialResponse: expenses by category', () => {
  const previous = [tx({ category: 'Ăn uống', amount: 500_000 })];

  it('finds the biggest category and its share', () => {
    const answer = simulateFinancialResponse('Where is my money going?', context());
    expect(answer.text).toContain(`Ăn uống accounts for ${money(600_000)}`);
    expect(answer.text).toContain('That is 75% of your total expenses.');
    expect(answer.highlight).toBe('expenses');
    expect(answer.metrics).toEqual([
      { label: 'Ăn uống', value: money(600_000) },
      { label: 'Potential 10% reduction', value: money(60_000) },
    ]);
  });

  it('compares with the previous period when it can', () => {
    const higher = simulateFinancialResponse('where is my money going', context({ previous }));
    expect(higher.text).toContain('20.0% higher than the preceding period');
    const lower = simulateFinancialResponse('where is my money going', context({ previous: [tx({ category: 'Ăn uống', amount: 1_000_000 })] }));
    expect(lower.text).toContain('40.0% lower than the preceding period');
  });

  it('says so when there is nothing to compare with', () => {
    const answer = simulateFinancialResponse('where is my money going', context({ previous: [] }));
    expect(answer.text).toContain('there is no previous-period comparison');
  });

  it('ignores income in the previous period', () => {
    const answer = simulateFinancialResponse('where is my money going', context({ previous: [tx({ type: 'Income', category: 'Ăn uống', amount: 900_000 })] }));
    expect(answer.text).toContain('no previous-period comparison');
  });

  it('answers about dining specifically', () => {
    const answer = simulateFinancialResponse('Help me reduce dining expenses.', context({ previous }));
    expect(answer.text.startsWith('Ăn uống accounts for')).toBe(true);
  });

  it('answers about the category the user selected', () => {
    const answer = simulateFinancialResponse('which category costs the most', context({ selection: { category: 'Mua sắm' } }));
    expect(answer.text).toContain(`Mua sắm accounts for ${money(200_000)}`);
  });

  it('shows the largest expense for unusual-transaction questions', () => {
    const answer = simulateFinancialResponse('Find unusual transactions.', context());
    expect(answer.text).toContain('“Big lunch”');
    expect(answer.text).toContain(money(600_000));
    expect(answer.text).toContain('75.0% of spending');
    expect(answer.text).toContain('does not run fraud detection');
    expect(answer.highlight).toBe('transactions');
    expect(answer.metrics).toEqual([{ label: 'Largest expense', value: money(600_000) }]);
  });

  it('copes with a period that has income only', () => {
    const answer = simulateFinancialResponse('find unusual transactions', context({ rows: [tx({ type: 'Income', category: 'Lương', amount: 1_000_000 })] }));
    expect(answer.text).toContain('No expense transactions are available.');
    expect(answer.metrics).toEqual([]);
  });

  it('continues an expense chat in a follow-up', () => {
    const answer = simulateFinancialResponse('why?', context(), 'expenses');
    expect(answer.highlight).toBe('expenses');
  });
});

describe('simulateFinancialResponse: comparison and summary', () => {
  it('compares income and expenses', () => {
    const answer = simulateFinancialResponse('Compare my income and expenses.', context({ previous: [tx({ amount: 300_000 })] }));
    expect(answer.text).toContain(`Income is ${money(INCOME)} and expenses are ${money(EXPENSE)}`);
    expect(answer.text).toContain(`Previous-period expenses were ${money(300_000)}`);
    expect(answer.text).toContain('You retained 92.0% of income.');
    expect(answer.highlight).toBe('cashflow');
  });

  it('explains trends', () => {
    expect(simulateFinancialResponse('Explain my spending trends.', context()).highlight).toBe('cashflow');
  });

  it('gives a financial health summary by default', () => {
    const answer = simulateFinancialResponse('Give me a financial health summary.', context());
    expect(answer.text).toContain(`You earned ${money(INCOME)} and spent ${money(EXPENSE)}, leaving ${money(NET)}`);
    expect(answer.text).toContain('Your savings rate is 92.0%.');
    expect(answer.text).toContain('above the illustrative 20% savings target');
    expect(answer.highlight).toBe('summary');
    expect(answer.metrics).toEqual([{ label: 'Net savings', value: money(NET) }, { label: 'Savings rate', value: '92.0%' }]);
  });

  it('suggests reviewing flexible spending when the savings rate is below 20%', () => {
    const rows = [tx({ type: 'Income', category: 'Lương', amount: 1_000_000 }), tx({ amount: 900_000 })];
    const answer = simulateFinancialResponse('hello there', context({ rows }));
    expect(answer.text).toContain('Review flexible spending');
    expect(answer.metrics?.[1].value).toBe('10.0%');
  });

  it('reports a 0% savings rate when there is no income', () => {
    const answer = simulateFinancialResponse('hello there', context({ rows: [tx({ amount: 50_000 })] }));
    expect(answer.metrics?.[1].value).toBe('0.0%');
    expect(answer.text).toContain(`leaving ${money(-50_000)}`);
  });

  it('adds a savings tip when the question is about saving', () => {
    const answer = simulateFinancialResponse('How can I save more money?', context());
    expect(answer.text).toContain('moving a manageable amount into savings');
  });

  it('suggests what to ask next otherwise', () => {
    const answer = simulateFinancialResponse('hello there', context());
    expect(answer.text).toContain('Ask me about a category, a budget, or a purchase');
  });

  it('is deterministic', () => {
    const a = simulateFinancialResponse('Give me a financial health summary.', context());
    const b = simulateFinancialResponse('Give me a financial health summary.', context());
    expect(a).toEqual(b);
  });

  it('ignores letter case in the question', () => {
    const a = simulateFinancialResponse('WHERE IS MY MONEY GOING', context());
    const b = simulateFinancialResponse('where is my money going', context());
    expect(a).toEqual(b);
  });

  it('formats money in US dollars when the display currency is USD', () => {
    setDisplayCurrency('USD', 25_000);
    const answer = simulateFinancialResponse('Give me a financial health summary.', context());
    expect(answer.text).toContain('$');
    expect(answer.text).not.toContain('₫');
  });
});
