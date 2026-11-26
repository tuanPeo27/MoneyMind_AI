import { useState } from 'react';
import { Archive, ArchiveRestore, Banknote, Eye, EyeOff, Landmark, Pencil, Plus, Smartphone, Trash2, Wallet, type LucideIcon } from 'lucide-react';
import { useLanguage } from '../i18n';
import { Badge, Button, Card, Empty, Field, IconButton, Modal, SectionHead, fieldClass } from '../components/ui';
import { AmountInput } from '../components/AmountInput';
import { FormSelect } from '../components/Select';
import { LoadingStatus, Skeleton, SkeletonText, useFadeIn } from '../components/Skeleton';
import { money } from '../data';
import type { AccountType } from '../services';
import type { AccountInput, WalletAccount } from '../hooks/useWorkspaceData';

import { HIDDEN_AMOUNT } from '../lib/currency';
export { HIDDEN_AMOUNT };
export const accountTypes: Record<AccountType, { label: string; icon: LucideIcon; tone: string }> = {
  Cash: { label: 'Cash', icon: Banknote, tone: 'text-positive bg-positive/10' },
  Bank: { label: 'Bank account', icon: Landmark, tone: 'text-brand bg-brand/10' },
  EWallet: { label: 'E-wallet', icon: Smartphone, tone: 'text-ai bg-ai/10' },
};
export function AccountIcon({ type, small = false }: { type: AccountType; small?: boolean }) {
  const { icon: Icon, tone } = accountTypes[type] ?? accountTypes.Cash;
  return <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-xl ${tone} ${small ? 'size-8' : 'size-10'}`}><Icon className={small ? 'size-4' : 'size-[18px]'} /></span>;
}

type Dialog = { kind: 'create' } | { kind: 'edit'; account: WalletAccount } | { kind: 'delete'; account: WalletAccount } | null;

/**
 * Accounts page: the user's money sources (cash, bank accounts, e-wallets) from /api/accounts.
 * The backend computes balance = starting balance + income - expense, lets you rename or change the type
 * (not the starting balance), and archives instead of deleting an account that still has transactions.
 */
/** An account card while loading: same padding, icon size and row heights as the real card. */
function AccountSkeleton() {
  return <div aria-hidden="true" className="rounded-2xl border border-line bg-base/40 p-4">
    <div className="flex items-center gap-3">
      <Skeleton className="size-10 shrink-0 !rounded-xl" />
      <span className="min-w-0 flex-1"><SkeletonText className="h-6" bar="h-3.5" width="w-28" /></span>
      <SkeletonText className="h-6" bar="h-3.5" width="w-20" />
    </div>
    <div className="mt-2 flex min-h-11 items-center pl-[52px]"><SkeletonText className="h-4" bar="h-2.5" width="w-32" /></div>
  </div>;
}
export default function AccountsPage({ accounts, archived, hidden, setHidden, onCreate, onUpdate, onDelete, onRestore, loading = false }: {
  accounts: WalletAccount[]; archived: WalletAccount[];
  /** First load of the user's data: skeleton cards instead of the empty state. */
  loading?: boolean;
  hidden: boolean; setHidden: (value: boolean) => void;
  /** Each returns true on success; errors are shown by the caller. */
  onCreate: (input: AccountInput) => Promise<boolean>;
  onUpdate: (id: string, input: Pick<AccountInput, 'name' | 'type'>) => Promise<boolean>;
  onDelete: (account: WalletAccount) => Promise<boolean>;
  onRestore: (account: WalletAccount) => Promise<boolean>;
}) {
  const { t } = useLanguage();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const fade = useFadeIn(loading);
  const total = accounts.reduce((s, a) => s + a.balance, 0);
  const show = (vnd: number) => hidden ? HIDDEN_AMOUNT : money(vnd);
  const run = async (action: () => Promise<boolean>) => {
    setBusy(true);
    try { if (await action()) setDialog(null); } finally { setBusy(false); }
  };

  return <div className="space-y-5">
    <Card className="!border-brand/25 !bg-balance relative overflow-hidden p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm text-muted"><Wallet className="size-4" aria-hidden="true" />{t('Total assets')}
            <button type="button" onClick={() => setHidden(!hidden)} aria-pressed={!hidden} aria-label={t(hidden ? 'Show account balance' : 'Hide account balance')} title={t(hidden ? 'Show account balance' : 'Hide account balance')}
              className="flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-line hover:text-ink focus-visible:ring-2 focus-visible:ring-brand">
              {hidden ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
            </button>
          </p>
          {loading ? <>
            <Skeleton className="mt-3 h-[30px] w-44 sm:h-[36px] sm:w-56" />
            <SkeletonText className="mt-3 h-4" bar="h-2.5" width="w-28" />
          </> : <div className={fade}>
            <p className="mt-3 text-[30px] font-semibold leading-none tracking-[-0.045em] tabular-nums sm:text-[36px]">{show(total)}</p>
            <p className="mt-3 text-xs text-muted">{t('{count} active accounts', { count: accounts.length })}</p>
          </div>}
        </div>
        <Button onClick={() => setDialog({ kind: 'create' })}><Plus className="size-4" />{t('Add account')}</Button>
      </div>
    </Card>

    <Card className="p-5">
      <SectionHead title={t('Your accounts')} subtitle={t('Cash, bank accounts and e-wallets you track. Balances include every transaction.')} />
      {loading ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><LoadingStatus label={t('Loading your data...')} />{[0, 1].map(i => <AccountSkeleton key={i} />)}</div>
        : accounts.length ? <div className={`grid gap-3 md:grid-cols-2 xl:grid-cols-3 ${fade}`}>{accounts.map(a =>
        <div key={a.id} className="group rounded-2xl border border-line bg-base/40 p-4 transition-colors hover:border-brand/30">
          <div className="flex items-center gap-3">
            <AccountIcon type={a.type} />
            <p className="min-w-0 flex-1 truncate font-medium">{a.name}</p>
            <p className={`shrink-0 font-semibold tabular-nums ${!hidden && a.balance < 0 ? 'text-negative' : ''}`}>{show(a.balance)}</p>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 pl-[52px]">
            <p className="min-w-0 truncate text-xs text-muted">{t(accountTypes[a.type]?.label ?? a.type)} · {t('{count} transactions', { count: a.transactions })}</p>
            <div className="flex shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
              <IconButton icon={Pencil} label={t('Edit {name}', { name: a.name })} onClick={() => setDialog({ kind: 'edit', account: a })} />
              <IconButton icon={Trash2} label={t('Delete {name}', { name: a.name })} onClick={() => setDialog({ kind: 'delete', account: a })} />
            </div>
          </div>
        </div>)}</div>
        : <Empty title={t('No accounts yet')} text={t('Add the cash, bank accounts and e-wallets you want to track.')} />}
    </Card>

    {archived.length > 0 && <Card className="p-5">
      <SectionHead title={t('Archived accounts')} subtitle={t('Kept because they have transactions. They are not counted in your balance.')} />
      <div className="divide-y divide-line">{archived.map(a => <div key={a.id} className="flex items-center gap-3 py-3">
        <AccountIcon type={a.type} small />
        <span className="min-w-0 flex-1 truncate text-sm text-muted">{a.name}</span>
        <Badge><Archive className="size-3" aria-hidden="true" />{t('Archived')}</Badge>
        <Button secondary disabled={busy} onClick={() => void run(() => onRestore(a))}><ArchiveRestore className="size-4" />{t('Restore')}</Button>
      </div>)}</div>
    </Card>}

    {(dialog?.kind === 'create' || dialog?.kind === 'edit') && <AccountForm account={dialog.kind === 'edit' ? dialog.account : undefined} busy={busy}
      existing={accounts} onClose={() => setDialog(null)}
      onSave={input => run(() => dialog.kind === 'edit' ? onUpdate(dialog.account.id, input) : onCreate(input))} />}
    {dialog?.kind === 'delete' && <Modal title={t('Delete this account?')} onClose={() => !busy && setDialog(null)}>
      <p className="text-sm leading-6 text-muted">{dialog.account.transactions
        ? t('“{name}” has {count} transactions, so it will be archived instead of deleted. Its history stays in your reports, but it no longer counts toward your balance.', { name: dialog.account.name, count: dialog.account.transactions })
        : t('“{name}” has no transactions and will be deleted permanently.', { name: dialog.account.name })}</p>
      <div className="mt-6 flex justify-end gap-3">
        <Button secondary disabled={busy} onClick={() => setDialog(null)}>{t('Cancel')}</Button>
        <Button className="!bg-negative !text-on-negative" disabled={busy} onClick={() => void run(() => onDelete(dialog.account))}>{t(dialog.account.transactions ? 'Archive account' : 'Delete')}</Button>
      </div>
    </Modal>}
  </div>;
}

function AccountForm({ account, existing, busy, onClose, onSave }: {
  account?: WalletAccount; existing: WalletAccount[]; busy: boolean; onClose: () => void; onSave: (input: AccountInput) => void;
}) {
  const { t } = useLanguage();
  const [error, setError] = useState('');
  return <Modal title={t(account ? 'Edit account' : 'Add account')} onClose={() => !busy && onClose()}>
    <form className="space-y-5" onSubmit={e => {
      e.preventDefault();
      const data = new FormData(e.currentTarget);
      const name = String(data.get('name')).trim();
      if (!name) { setError(t('Enter an account name.')); return; }
      if (existing.some(a => a.id !== account?.id && a.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { setError(t('An account with this name already exists.')); return; }
      onSave({ name, type: String(data.get('type')) as AccountType, initialBalance: Number(data.get('initialBalance') || 0) });
    }}>
      <Field label={t('Account name')}><input name="name" required maxLength={100} autoFocus defaultValue={account?.name} placeholder={t('e.g. Vietcombank, MoMo')} className={fieldClass} /></Field>
      <Field label={t('Type')}><FormSelect name="type" label={t('Type')} defaultValue={account?.type ?? 'Bank'}
        options={(Object.keys(accountTypes) as AccountType[]).map(type => ({ value: type, label: t(accountTypes[type].label), icon: <AccountIcon type={type} small /> }))} /></Field>
      {account
        ? <p className="rounded-xl bg-line/40 px-4 py-3 text-xs leading-5 text-muted">{t('Starting balance: {amount}. It cannot be changed after the account is created; add a transaction to adjust the balance.', { amount: money(account.initialBalance) })}</p>
        : <Field label={t('Starting balance')}><AmountInput name="initialBalance" minVnd={0} defaultValue={0} /></Field>}
      {error && <p role="alert" className="text-sm text-negative">{error}</p>}
      <div className="flex justify-end gap-3"><Button secondary type="button" disabled={busy} onClick={onClose}>{t('Cancel')}</Button><Button disabled={busy}>{t(account ? 'Save changes' : 'Add account')}</Button></div>
    </form>
  </Modal>;
}
