// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp, setupUser } from '../test/dom';
import AccountsPage, { AccountIcon, HIDDEN_AMOUNT, accountTypes } from './Accounts';
import { money } from '../data';
import type { WalletAccount } from '../hooks/useWorkspaceData';

const wallet = (overrides: Partial<WalletAccount> = {}): WalletAccount => ({
  id: 'a1', name: 'MoMo', type: 'EWallet', initialBalance: 0, balance: 500_000, isArchived: false, createdAt: '2025-01-01', transactions: 3, ...overrides,
});

type Props = React.ComponentProps<typeof AccountsPage>;
function setup(props: Partial<Props> = {}) {
  const handlers = {
    onCreate: vi.fn().mockResolvedValue(true), onUpdate: vi.fn().mockResolvedValue(true),
    onDelete: vi.fn().mockResolvedValue(true), onRestore: vi.fn().mockResolvedValue(true), setHidden: vi.fn(),
  };
  const all: Props = { accounts: [wallet(), wallet({ id: 'a2', name: 'Vietcombank', type: 'Bank', balance: 2_000_000, transactions: 0 })], archived: [], hidden: false, ...handlers, ...props };
  const view = renderApp(<AccountsPage {...all} />, { language: 'vi' });
  return { ...handlers, user: setupUser(), ...view };
}
const dialog = () => screen.getByRole('dialog');

describe('AccountsPage summary', () => {
  it('shows the total across active accounts', () => {
    setup();
    expect(screen.getByText(money(2_500_000))).toBeInTheDocument();
  });

  it('shows a negative total and zero accounts', () => {
    setup({ accounts: [] });
    expect(screen.getByText(money(0))).toBeInTheDocument();
  });

  it('counts the active accounts', () => {
    setup();
    expect(screen.getByText(/2/, { selector: 'p.text-xs' })).toBeInTheDocument();
  });

  it('lists each account with name, balance and details', () => {
    setup();
    expect(screen.getByText('MoMo')).toBeInTheDocument();
    expect(screen.getByText('Vietcombank')).toBeInTheDocument();
    expect(screen.getByText(money(500_000))).toBeInTheDocument();
    expect(screen.getByText(money(2_000_000))).toBeInTheDocument();
  });

  it('colours a negative balance red', () => {
    setup({ accounts: [wallet({ balance: -1000 })] });
    expect(screen.getAllByText(money(-1000)).find(el => el.className.includes('text-negative'))).toBeDefined();
  });

  it('shows a friendly empty state', () => {
    setup({ accounts: [] });
    expect(screen.getByText(/Chưa có tài khoản|No accounts yet/)).toBeInTheDocument();
  });
});

describe('AccountsPage hiding balances', () => {
  it('masks every amount while hidden', () => {
    setup({ hidden: true });
    expect(screen.getAllByText(HIDDEN_AMOUNT).length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(money(500_000))).not.toBeInTheDocument();
  });

  it('toggles through the eye button', async () => {
    const { setHidden, user } = setup();
    await user.click(screen.getByRole('button', { name: /Ẩn số dư|Hide account balance/ }));
    expect(setHidden).toHaveBeenCalledWith(true);
  });

  it('offers to show them again while hidden', async () => {
    const { setHidden, user } = setup({ hidden: true });
    await user.click(screen.getByRole('button', { name: /Hiện số dư|Show account balance/ }));
    expect(setHidden).toHaveBeenCalledWith(false);
  });

  it('does not colour hidden negative balances', () => {
    setup({ hidden: true, accounts: [wallet({ balance: -1000 })] });
    expect(screen.queryAllByText(HIDDEN_AMOUNT).some(el => el.className.includes('text-negative'))).toBe(false);
  });
});

describe('AccountsPage creating', () => {
  const open = async (user: ReturnType<typeof setupUser>) => {
    await user.click(screen.getAllByRole('button', { name: /Thêm tài khoản|Add account/ })[0]);
    return within(dialog());
  };
  const nameField = () => within(dialog()).getByRole('textbox', { name: /Tên tài khoản|Account name/ });
  const last = <T,>(items: T[]) => items[items.length - 1];
  const submit = () => last(within(dialog()).getAllByRole('button', { name: /Thêm tài khoản|Add account/ }));

  it('opens a form with the type defaulting to a bank account', async () => {
    const { user } = setup();
    await open(user);
    expect(within(dialog()).getByRole('combobox', { name: /Loại|Type/ })).toHaveTextContent(/Tài khoản ngân hàng|Bank account/);
    expect(within(dialog()).getByText(/Số dư ban đầu|Starting balance/)).toBeInTheDocument();
  });

  it('sends the new account', async () => {
    const { onCreate, user } = setup();
    await open(user);
    await user.type(nameField(), '  Techcombank ');
    await user.type(last(within(dialog()).getAllByRole('textbox')), '1500000');
    await user.click(submit());
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith({ name: 'Techcombank', type: 'Bank', initialBalance: 1_500_000 });
  });

  it('lets the user pick another type', async () => {
    const { onCreate, user } = setup();
    await open(user);
    await user.type(nameField(), 'Wallet');
    await user.click(within(dialog()).getByRole('combobox', { name: /Loại|Type/ }));
    await user.click(screen.getByRole('option', { name: /Ví điện tử|E-wallet/ }));
    await user.click(submit());
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0]).toMatchObject({ type: 'EWallet' });
  });

  it('starts at a balance of zero', async () => {
    const { onCreate, user } = setup();
    await open(user);
    await user.type(nameField(), 'Empty');
    await user.click(submit());
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0].initialBalance).toBe(0);
  });

  it('rejects a name of only spaces', async () => {
    const { onCreate, user } = setup();
    await open(user);
    await user.type(nameField(), '    ');
    await user.click(submit());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it.each(['momo', 'MOMO', ' Momo '])('rejects the duplicate name %j regardless of case', async name => {
    const { onCreate, user } = setup();
    await open(user);
    await user.type(nameField(), name);
    await user.click(submit());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('closes after a successful save', async () => {
    const { user } = setup();
    await open(user);
    await user.type(nameField(), 'Fresh');
    await user.click(submit());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('stays open when the save is refused', async () => {
    const { user } = setup({ onCreate: vi.fn().mockResolvedValue(false) });
    await open(user);
    await user.type(nameField(), 'Fresh');
    await user.click(submit());
    await waitFor(() => expect(submit()).toBeEnabled());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('can be cancelled', async () => {
    const { onCreate, user } = setup();
    await open(user);
    await user.click(within(dialog()).getByRole('button', { name: /Hủy|Huỷ|Cancel/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('limits the name to 100 characters', async () => {
    const { user } = setup();
    await open(user);
    expect(nameField()).toHaveAttribute('maxlength', '100');
  });
});

describe('AccountsPage editing', () => {
  const openEdit = async (user: ReturnType<typeof setupUser>, name = 'MoMo') => {
    await user.click(screen.getByRole('button', { name: new RegExp(`(Sửa|Edit) ${name}`) }));
  };

  it('is prefilled and cannot change the starting balance', async () => {
    const { user } = setup({ accounts: [wallet({ initialBalance: 250_000 })] });
    await openEdit(user);
    expect(within(dialog()).getByRole('textbox', { name: /Tên tài khoản|Account name/ })).toHaveValue('MoMo');
    expect(within(dialog()).getByRole('combobox', { name: /Loại|Type/ })).toHaveTextContent(/Ví điện tử|E-wallet/);
    expect(within(dialog()).getByText(new RegExp(money(250_000).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument();
    expect(within(dialog()).queryByText(/^Số dư ban đầu$|^Starting balance$/)).not.toBeInTheDocument();
  });

  it('sends only name and type', async () => {
    const { onUpdate, user } = setup();
    await openEdit(user);
    const input = within(dialog()).getByRole('textbox', { name: /Tên tài khoản|Account name/ });
    await user.clear(input);
    await user.type(input, 'MoMo Pay');
    await user.click(within(dialog()).getByRole('button', { name: /Lưu thay đổi|Save changes/ }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('a1', { name: 'MoMo Pay', type: 'EWallet', initialBalance: 0 }));
  });

  it('allows keeping the own name', async () => {
    const { onUpdate, user } = setup();
    await openEdit(user);
    await user.click(within(dialog()).getByRole('button', { name: /Lưu thay đổi|Save changes/ }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
  });

  it('rejects another account\'s name', async () => {
    const { onUpdate, user } = setup();
    await openEdit(user);
    const input = within(dialog()).getByRole('textbox', { name: /Tên tài khoản|Account name/ });
    await user.clear(input);
    await user.type(input, 'vietcombank');
    await user.click(within(dialog()).getByRole('button', { name: /Lưu thay đổi|Save changes/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe('AccountsPage deleting', () => {
  const openDelete = async (user: ReturnType<typeof setupUser>, name: string) => {
    await user.click(screen.getByRole('button', { name: new RegExp(`(Xóa|Delete) ${name}`) }));
  };

  it('explains that an account with transactions is archived', async () => {
    const { user } = setup();
    await openDelete(user, 'MoMo');
    expect(within(dialog()).getByText(/3/)).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: /Lưu trữ|Archive account/ })).toBeInTheDocument();
  });

  it('explains that an account without transactions is deleted for good', async () => {
    const { user } = setup();
    await openDelete(user, 'Vietcombank');
    expect(within(dialog()).getByRole('button', { name: /^(Xóa|Delete)$/ })).toBeInTheDocument();
  });

  it('confirms the deletion', async () => {
    const { onDelete, user } = setup();
    await openDelete(user, 'Vietcombank');
    await user.click(within(dialog()).getByRole('button', { name: /^(Xóa|Delete)$/ }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'a2' })));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('can be cancelled without deleting', async () => {
    const { onDelete, user } = setup();
    await openDelete(user, 'MoMo');
    await user.click(within(dialog()).getByRole('button', { name: /Hủy|Huỷ|Cancel/ }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the dialog open when deleting fails', async () => {
    const { user } = setup({ onDelete: vi.fn().mockResolvedValue(false) });
    await openDelete(user, 'Vietcombank');
    await user.click(within(dialog()).getByRole('button', { name: /^(Xóa|Delete)$/ }));
    await waitFor(() => expect(within(dialog()).getByRole('button', { name: /^(Xóa|Delete)$/ })).toBeEnabled());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('AccountsPage archived accounts', () => {
  it('has no archived section when there are none', () => {
    setup();
    expect(screen.queryByText(/Đã lưu trữ|Archived accounts/)).not.toBeInTheDocument();
  });

  it('lists archived accounts and restores one', async () => {
    const { onRestore, user } = setup({ archived: [wallet({ id: 'old', name: 'Old wallet', isArchived: true })] });
    expect(screen.getByText('Old wallet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Khôi phục|Restore/ }));
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ id: 'old' })));
  });

  it('does not count archived accounts in the total', () => {
    setup({ accounts: [wallet({ balance: 100 })], archived: [wallet({ id: 'old', name: 'Old', balance: 9_999_999, isArchived: true })] });
    expect(screen.getByRole('heading', { level: 2, name: /Tài khoản của bạn|Your accounts/ })).toBeInTheDocument();
    expect(screen.queryByText(money(10_000_099))).not.toBeInTheDocument();
  });
});

describe('AccountIcon and account types', () => {
  it.each(['Cash', 'Bank', 'EWallet'] as const)('draws an icon for %s', type => {
    const { container } = renderApp(<AccountIcon type={type} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(accountTypes[type].label).toBeTruthy();
  });

  it('falls back to the cash icon for an unknown type', () => {
    const { container } = renderApp(<AccountIcon type={'Unknown' as never} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('uses a smaller badge when asked', () => {
    const { container } = renderApp(<AccountIcon type="Cash" small />);
    expect(container.firstElementChild).toHaveClass('size-8');
  });
});
