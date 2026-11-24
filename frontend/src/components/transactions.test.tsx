// @vitest-environment jsdom
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp, setupUser } from '../test/dom';
import { TransactionForm, TransactionTable } from './transactions';
import { initialCategories, money, today, type Category, type Transaction } from '../data';

const tx = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 't1', description: 'Lunch', amount: 120_000, type: 'Expense', category: 'Ăn uống', account: 'MoMo',
  date: '2025-01-10', notes: 'with team', ...overrides,
});

describe('TransactionTable', () => {
  const rows = [
    tx(),
    tx({ id: 't2', description: 'Salary', amount: 30_000_000, type: 'Income', category: 'Lương', account: 'Vietcombank', date: '2025-01-05' }),
  ];
  const setup = (props: Partial<React.ComponentProps<typeof TransactionTable>> = {}) => {
    const onEdit = vi.fn(), onDelete = vi.fn();
    renderApp(<TransactionTable rows={rows} categories={initialCategories} onEdit={onEdit} onDelete={onDelete} {...props} />, { language: 'vi' });
    return { onEdit, onDelete, user: setupUser() };
  };

  it('lists a row per transaction', () => {
    setup();
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2
    expect(screen.getByText('Lunch')).toBeInTheDocument();
    expect(screen.getByText('Salary')).toBeInTheDocument();
  });

  it('shows expenses with a minus and income with a plus', () => {
    setup();
    expect(screen.getByText(`−${money(120_000)}`)).toBeInTheDocument();
    expect(screen.getByText(`+${money(30_000_000)}`)).toBeInTheDocument();
  });

  it('colours income green', () => {
    setup();
    expect(screen.getByText(`+${money(30_000_000)}`)).toHaveClass('text-positive');
    expect(screen.getByText(`−${money(120_000)}`)).not.toHaveClass('text-positive');
  });

  it('shows the account and the type columns by default', () => {
    setup();
    expect(screen.getAllByRole('columnheader')).toHaveLength(7);
    expect(screen.getByText('Vietcombank')).toBeInTheDocument();
  });

  it('hides account, type and actions in compact mode', () => {
    setup({ compact: true });
    expect(screen.getAllByRole('columnheader')).toHaveLength(4);
    expect(screen.queryByText('Vietcombank')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sửa|Edit/ })).not.toBeInTheDocument();
  });

  it('opens a transaction when its name is clicked', async () => {
    const { onEdit, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Lunch' }));
    expect(onEdit).toHaveBeenCalledWith(rows[0]);
  });

  it('has edit and delete buttons labelled with the transaction name', async () => {
    const { onEdit, onDelete, user } = setup();
    const row = screen.getByText('Salary').closest('tr') as HTMLElement;
    const buttons = within(row).getAllByRole('button');
    await user.click(buttons[buttons.length - 2]);
    await user.click(buttons[buttons.length - 1]);
    expect(onEdit).toHaveBeenCalledWith(rows[1]);
    expect(onDelete).toHaveBeenCalledWith(rows[1]);
  });

  it('shows an empty state for no rows', () => {
    setup({ rows: [] });
    expect(screen.getByText('Không tìm thấy giao dịch') ?? screen.getByText('No transactions found')).toBeInTheDocument();
  });

  it('shows a header sort buttons only when sorting is supported', async () => {
    const onSort = vi.fn();
    const { user } = setup({ onSort });
    await user.click(screen.getByRole('button', { name: /Ngày|Date/ }));
    await user.click(screen.getByRole('button', { name: /Số tiền|Amount/ }));
    expect(onSort.mock.calls).toEqual([['date'], ['amount']]);
  });

  it('has plain headers without sorting', () => {
    setup();
    expect(screen.queryAllByRole('button', { name: /Ngày|Date/ })).toHaveLength(0);
  });

  it('shows English category names in English', () => {
    renderApp(<TransactionTable rows={[tx()]} categories={initialCategories} onEdit={() => undefined} onDelete={() => undefined} />);
    expect(screen.getByText('Food & dining')).toBeInTheDocument();
  });

  it('shows the Vietnamese category name in Vietnamese', () => {
    setup();
    expect(screen.getByText('Ăn uống')).toBeInTheDocument();
  });
});

describe('TransactionForm', () => {
  const accounts = ['MoMo', 'Vietcombank'];
  function setup(props: Partial<React.ComponentProps<typeof TransactionForm>> = {}) {
    const onSave = vi.fn(), onClose = vi.fn();
    renderApp(<TransactionForm categories={initialCategories} accounts={accounts} onSave={onSave} onClose={onClose} {...props} />, { language: 'vi' });
    const form = document.querySelector('form') as HTMLFormElement;
    return { onSave, onClose, form, user: setupUser() };
  }
  const describeField = () => document.querySelector('input[name=description]') as HTMLInputElement;
  const amount = () => document.querySelector('input[name=amount]') as HTMLInputElement;
  const visibleAmount = () => screen.getAllByRole('textbox').find(el => el !== describeField() && el.getAttribute('name') !== 'description') as HTMLInputElement;

  it('is a dialog for adding a transaction', () => {
    setup();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(describeField()).toHaveValue('');
  });

  it('defaults the date to today', () => {
    setup();
    expect(document.querySelector('input[name=date]')).toHaveValue(today);
  });

  it('defaults to an expense in the first expense category and the first account', () => {
    setup();
    expect(screen.getByRole('combobox', { name: /Loại giao dịch|Transaction type/ })).toHaveTextContent(/Chi tiêu|Expense/);
    expect(screen.getByRole('combobox', { name: /Danh mục|Category/ })).toHaveTextContent('Ăn uống');
    expect(screen.getByRole('combobox', { name: /Tài khoản|Account/ })).toHaveTextContent('MoMo');
  });

  it('saves what was entered', async () => {
    const { onSave, form, user } = setup();
    await user.type(describeField(), '  Pho bo  ');
    await user.type(visibleAmount(), '50000');
    await user.type(document.querySelector('textarea[name=notes]') as HTMLTextAreaElement, ' good ');
    fireEvent.submit(form);
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({
      id: '', description: 'Pho bo', amount: 50000, type: 'Expense', category: 'Ăn uống', account: 'MoMo', date: today, notes: 'good',
    });
  });

  it('lets the user pick another account and category', async () => {
    const { onSave, form, user } = setup();
    await user.type(describeField(), 'Shirt');
    await user.type(visibleAmount(), '100000');
    await user.click(screen.getByRole('combobox', { name: /Danh mục|Category/ }));
    await user.click(screen.getByRole('option', { name: 'Mua sắm' }));
    await user.click(screen.getByRole('combobox', { name: /Tài khoản|Account/ }));
    await user.click(screen.getByRole('option', { name: 'Vietcombank' }));
    fireEvent.submit(form);
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ category: 'Mua sắm', account: 'Vietcombank' });
  });

  it('switches to the first income category when the type becomes income', async () => {
    const { onSave, form, user } = setup();
    await user.type(describeField(), 'Pay');
    await user.type(visibleAmount(), '1000000');
    await user.click(screen.getByRole('combobox', { name: /Loại giao dịch|Transaction type/ }));
    await user.click(screen.getByRole('option', { name: /Thu nhập|Income/ }));
    expect(screen.getByRole('combobox', { name: /Danh mục|Category/ })).toHaveTextContent('Lương');
    fireEvent.submit(form);
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ type: 'Income', category: 'Lương' });
  });

  it('only offers categories of the chosen type', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('combobox', { name: /Danh mục|Category/ }));
    const names = screen.getAllByRole('option').map(o => o.textContent);
    const expenseNames = initialCategories.filter(c => c.type === 'Expense').map(c => c.name);
    expect(names).toEqual(expenseNames);
  });

  it('rejects an empty description', async () => {
    const { onSave, form } = setup();
    fireEvent.submit(form);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rejects a description of only spaces', async () => {
    const { onSave, form, user } = setup();
    await user.type(describeField(), '    ');
    fireEvent.submit(form);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rejects a missing category and disables saving', async () => {
    const onlyIncome: Category[] = initialCategories.filter(c => c.type === 'Income');
    const { onSave, form, user } = setup({ categories: onlyIncome });
    await user.type(describeField(), 'Thing');
    fireEvent.submit(form);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Lưu giao dịch|Save transaction/ })).toBeDisabled();
  });

  it('cannot be saved without an account', () => {
    setup({ accounts: [] });
    expect(screen.getByRole('button', { name: /Lưu giao dịch|Save transaction/ })).toBeDisabled();
  });

  it('limits the description and notes length', () => {
    setup();
    expect(describeField()).toHaveAttribute('maxlength', '150');
    expect(document.querySelector('textarea[name=notes]')).toHaveAttribute('maxlength', '340');
  });

  it('closes with Cancel', async () => {
    const { onClose, user } = setup();
    await user.click(screen.getByRole('button', { name: /Hủy|Huỷ|Cancel/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes with Escape', async () => {
    const { onClose, user } = setup();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('offers AI analysis only when the caller supports it', async () => {
    const { rerender } = renderApp(<TransactionForm categories={initialCategories} accounts={accounts} onSave={() => undefined} onClose={() => undefined} />);
    expect(screen.queryByRole('button', { name: /Analyze this transaction with AI/ })).not.toBeInTheDocument();
    const onAnalyze = vi.fn();
    rerender(<TransactionForm categories={initialCategories} accounts={accounts} onSave={() => undefined} onClose={() => undefined} onAnalyze={onAnalyze} />);
    await setupUser().click(screen.getByRole('button', { name: /Analyze this transaction with AI/ }));
    expect(onAnalyze).toHaveBeenCalled();
  });

  it('disables the save button while saving and enables it again afterwards', async () => {
    let finish!: () => void;
    const onSave = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const { form, user } = setup({ onSave });
    await user.type(describeField(), 'Slow');
    await user.type(visibleAmount(), '1000');
    fireEvent.submit(form);
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /Lưu giao dịch|Save transaction/ })).toBeDisabled());
    finish();
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /Lưu giao dịch|Save transaction/ })).toBeEnabled());
  });

  it('shows the amount as a hidden field in dong', async () => {
    const { user } = setup();
    await user.type(visibleAmount(), '1234567');
    expect(amount()).toHaveValue('1234567');
  });

  describe('editing', () => {
    const existing = tx({ id: 'abc', description: 'Old lunch', amount: 90_000, category: 'Mua sắm', account: 'Vietcombank', date: '2025-02-02', notes: 'note' });

    it('is prefilled', () => {
      setup({ transaction: existing });
      expect(describeField()).toHaveValue('Old lunch');
      expect(amount()).toHaveValue('90000');
      expect(document.querySelector('input[name=date]')).toHaveValue('2025-02-02');
      expect(document.querySelector('textarea[name=notes]')).toHaveValue('note');
      expect(screen.getByRole('combobox', { name: /Danh mục|Category/ })).toHaveTextContent('Mua sắm');
      expect(screen.getByRole('combobox', { name: /Tài khoản|Account/ })).toHaveTextContent('Vietcombank');
    });

    it('keeps the id when saving', async () => {
      const { onSave, form } = setup({ transaction: existing });
      fireEvent.submit(form);
      await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(onSave.mock.calls[0][0]).toMatchObject({ id: 'abc', description: 'Old lunch', amount: 90000, category: 'Mua sắm' });
    });

    it('still offers an account that no longer exists in the list', async () => {
      const { user } = setup({ transaction: tx({ account: 'Closed wallet' }) });
      await user.click(screen.getByRole('combobox', { name: /Tài khoản|Account/ }));
      expect(screen.getByRole('option', { name: 'Closed wallet' })).toBeInTheDocument();
    });

    it('opens an income transaction with income categories', async () => {
      const { user } = setup({ transaction: tx({ type: 'Income', category: 'Lương' }) });
      await user.click(screen.getByRole('combobox', { name: /Danh mục|Category/ }));
      expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(initialCategories.filter(c => c.type === 'Income').map(c => c.name));
    });
  });
});
