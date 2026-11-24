import { describe, expect, it } from 'vitest';
import type { AIActionPayload, AIActionResponse, AIActionType } from '../../services';
import { parseQuickEntry, readyToSave } from './QuickEntry';

let next = 0;
const action = (type: AIActionType, payload: AIActionPayload, status: AIActionResponse['status'] = 'Pending'): AIActionResponse =>
  ({ id: String(++next), type, status, payload, createdAt: '2026-01-01T00:00:00Z' });

describe('parseQuickEntry', () => {
  it.each([
    ['cà phê 35k', 35_000, 'cà phê'],
    ['grab 35.000', 35_000, 'grab'],
    ['lương 1tr5', 1_500_000, 'lương'],
    ['tiền nhà 3 triệu', 3_000_000, 'tiền nhà'],
  ])('%s', (text, amount, description) => {
    expect(parseQuickEntry(text)).toEqual({ amount, description });
  });

  it('keeps the text when there is no amount', () => {
    expect(parseQuickEntry('ăn trưa')).toEqual({ description: 'ăn trưa' });
  });
});

describe('readyToSave', () => {
  const transaction = (payload: AIActionPayload) =>
    action('create_transaction', { type: 'Income', amount: 5_000_000, categoryId: 'c1', accountId: 'a1', ...payload });

  it('saves a new account before the transaction that uses it', () => {
    const tx = transaction({ accountId: null, accountName: 'Vietcombank' });
    const account = action('create_account', { name: 'vietcombank', accountType: 'Bank' });
    expect(readyToSave([tx, account]).map(a => a.type)).toEqual(['create_account', 'create_transaction']);
  });

  it('skips a transaction whose account is neither chosen nor proposed', () => {
    expect(readyToSave([transaction({ accountId: null, accountName: 'Techcombank' })])).toEqual([]);
  });

  it('covers a missing category and account proposed together', () => {
    const tx = transaction({ categoryId: null, categoryName: 'Thú cưng', type: 'Expense', accountId: null, accountName: 'MoMo' });
    const ready = readyToSave([
      tx,
      action('create_category', { name: 'Thú cưng', type: 'Expense' }),
      action('create_account', { name: 'MoMo', accountType: 'EWallet' }),
    ]);
    expect(ready[ready.length - 1]).toBe(tx);
    expect(ready).toHaveLength(3);
  });

  it('ignores saved and cancelled actions', () => {
    expect(readyToSave([transaction({}), action('create_account', { name: 'X' }, 'Confirmed')])).toHaveLength(1);
  });
});
