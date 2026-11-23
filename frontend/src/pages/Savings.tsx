import { useState } from 'react';
import { BellRing, CalendarClock, CircleCheck, Pencil, PiggyBank, Plus, RotateCcw, Trash2, Undo2, X, type LucideIcon } from 'lucide-react';
import { useLanguage } from '../i18n';
import { Badge, Button, Card, Empty, Field, IconButton, Modal, SectionHead, fieldClass } from '../components/ui';
import { AmountInput } from '../components/AmountInput';
import { money } from '../data';
import type { FinancialGoalResponse, FinancialGoalStatus, UpsertGoalRequest } from '../services';
import { AccountIcon, HIDDEN_AMOUNT } from './Accounts';
import { FormSelect, Select } from '../components/Select';
import type { WalletAccount } from '../hooks/useWorkspaceData';

/** Option value meaning "record it in the fund only, do not take it from an account". */
const NO_ACCOUNT = 'none';

type Dialog =
  | { kind: 'form'; goal?: FinancialGoalResponse }
  | { kind: 'contribute'; goal: FinancialGoalResponse }
  | { kind: 'delete'; goal: FinancialGoalResponse }
  | { kind: 'cancel'; goal: FinancialGoalResponse }
  | null;

const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
/** Whole days from today to a `YYYY-MM-DD` deadline (negative when it has passed). */
const daysUntil = (deadline: string) => Math.round((new Date(`${deadline}T00:00:00`).getTime() - todayStart().getTime()) / 86_400_000);

function ProgressBar({ percent, tone }: { percent: number; tone: string }) {
  const { t } = useLanguage();
  return <div role="progressbar" aria-label={t('Savings progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}
    className="h-2.5 w-full overflow-hidden rounded-full bg-line">
    <div className={`h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none ${tone}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
  </div>;
}

/**
 * Savings funds (financial goals) from /api/financial-goals. The backend completes a fund when the saved amount
 * reaches its target and sends a notification, so the page only adds money and shows progress.
 */
export default function SavingsPage({ goals, loading, hidden, accounts, onSave, onContribute, onStatus, onDelete }: {
  goals: FinancialGoalResponse[]; loading: boolean; hidden: boolean;
  /** Active accounts with their current balance: the money for a contribution can come from one of them. */
  accounts: WalletAccount[];
  /** Each returns true on success; errors are shown by the caller. */
  onSave: (id: string | undefined, input: UpsertGoalRequest) => Promise<boolean>;
  onContribute: (goal: FinancialGoalResponse, amount: number, accountId: string | null) => Promise<boolean>;
  onStatus: (goal: FinancialGoalResponse, status: FinancialGoalStatus) => Promise<boolean>;
  onDelete: (goal: FinancialGoalResponse) => Promise<boolean>;
}) {
  const { t } = useLanguage();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const show = (vnd: number) => hidden ? HIDDEN_AMOUNT : money(vnd);
  const run = async (action: () => Promise<boolean>) => {
    setBusy(true);
    try { if (await action()) setDialog(null); } finally { setBusy(false); }
  };
  const active = goals.filter(g => g.status === 'Active');
  const completed = goals.filter(g => g.status === 'Completed');
  const cancelled = goals.filter(g => g.status === 'Cancelled');
  const saved = active.reduce((s, g) => s + g.currentAmount, 0);
  const target = active.reduce((s, g) => s + g.targetAmount, 0);
  const overall = target ? Math.min(100, saved / target * 100) : 0;

  return <div className="space-y-5">
    <Card className="!border-brand/25 !bg-balance p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm text-muted"><PiggyBank className="size-4" aria-hidden="true" />{t('Total saved in active funds')}</p>
          <p className="mt-3 text-[30px] font-semibold leading-none tracking-[-0.045em] tabular-nums sm:text-[36px]">{show(saved)}</p>
          <p className="mt-3 text-xs text-muted">{t('{saved} of {target} · {count} active funds', { saved: show(saved), target: show(target), count: active.length })}</p>
        </div>
        <Button onClick={() => setDialog({ kind: 'form' })}><Plus className="size-4" />{t('Add savings fund')}</Button>
      </div>
      {active.length > 0 && <div className="mt-5"><ProgressBar percent={overall} tone="bg-brand" /></div>}
    </Card>

    <Card className="p-5">
      <SectionHead title={t('Active savings funds')} subtitle={t('Add money toward each goal. You are notified when a fund reaches its target.')} />
      {loading && !goals.length ? <p role="status" className="py-6 text-sm text-muted">{t('Loading your data...')}</p>
        : active.length ? <div className="grid gap-3 md:grid-cols-2">{active.map(g => {
          const days = g.deadline ? daysUntil(g.deadline) : null;
          const remaining = Math.max(0, g.targetAmount - g.currentAmount);
          return <div key={g.id} className="group rounded-2xl border border-line bg-base/40 p-4 transition-colors hover:border-brand/30">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand"><PiggyBank className="size-[18px]" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{g.name}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                  <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
                  {days === null ? t('No deadline') : days < 0 ? <span className="text-negative">{t('Overdue by {n} days', { n: -days })}</span>
                    : days === 0 ? t('Due today') : t('{n} days left', { n: days })}
                </p>
                {g.reminderDay ? <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted"><BellRing className="size-3.5 shrink-0" aria-hidden="true" />{t('Reminder on day {n} of every month', { n: g.reminderDay })}</p> : null}
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums">{Math.round(g.progressPercent)}%</p>
            </div>
            <div className="mt-4"><ProgressBar percent={g.progressPercent} tone={g.progressPercent >= 80 ? 'bg-positive' : 'bg-brand'} /></div>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted tabular-nums">
              <span>{show(g.currentAmount)} / {show(g.targetAmount)}</span>
              <span>{t('{amount} to go', { amount: show(remaining) })}</span>
            </div>
            <div className="mt-4 flex items-center justify-between gap-2">
              <Button secondary onClick={() => setDialog({ kind: 'contribute', goal: g })}><Plus className="size-4" />{t('Add money')}</Button>
              <div className="flex shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                <IconButton icon={Pencil} label={t('Edit {name}', { name: g.name })} onClick={() => setDialog({ kind: 'form', goal: g })} />
                <IconButton icon={X} label={t('Cancel {name}', { name: g.name })} onClick={() => setDialog({ kind: 'cancel', goal: g })} />
                <IconButton icon={Trash2} label={t('Delete {name}', { name: g.name })} onClick={() => setDialog({ kind: 'delete', goal: g })} />
              </div>
            </div>
          </div>;
        })}</div>
          : <Empty title={t('No savings funds yet')} text={t('Create a fund for something you are saving toward, such as a trip, a laptop or an emergency reserve.')} />}
    </Card>

    {completed.length > 0 && <HistoryCard title={t('Reached goals')} subtitle={t('Funds that reached their target.')} icon={CircleCheck} tone="positive" goals={completed} show={show}
      action={g => <IconButton icon={Trash2} label={t('Delete {name}', { name: g.name })} onClick={() => setDialog({ kind: 'delete', goal: g })} />} />}
    {cancelled.length > 0 && <HistoryCard title={t('Cancelled funds')} subtitle={t('Kept for your records. Reopen one to keep saving.')} icon={RotateCcw} tone="neutral" goals={cancelled} show={show}
      action={g => <span className="flex">
        <Button secondary disabled={busy} onClick={() => void run(() => onStatus(g, 'Active'))}><Undo2 className="size-4" />{t('Reopen')}</Button>
        <IconButton icon={Trash2} label={t('Delete {name}', { name: g.name })} onClick={() => setDialog({ kind: 'delete', goal: g })} />
      </span>} />}

    {dialog?.kind === 'form' && <GoalForm goal={dialog.goal} busy={busy} onClose={() => setDialog(null)} onSave={input => run(() => onSave(dialog.goal?.id, input))} />}
    {dialog?.kind === 'contribute' && <ContributeForm goal={dialog.goal} accounts={accounts} hidden={hidden} busy={busy} onClose={() => setDialog(null)} onSave={(amount, accountId) => run(() => onContribute(dialog.goal, amount, accountId))} />}
    {dialog?.kind === 'cancel' && <Modal title={t('Cancel this fund?')} onClose={() => !busy && setDialog(null)}>
      <p className="text-sm leading-6 text-muted">{t('“{name}” will stop counting toward your active savings. You can reopen it later.', { name: dialog.goal.name })}</p>
      <div className="mt-6 flex justify-end gap-3">
        <Button secondary disabled={busy} onClick={() => setDialog(null)}>{t('Keep fund')}</Button>
        <Button disabled={busy} onClick={() => void run(() => onStatus(dialog.goal, 'Cancelled'))}>{t('Cancel fund')}</Button>
      </div>
    </Modal>}
    {dialog?.kind === 'delete' && <Modal title={t('Delete this fund?')} onClose={() => !busy && setDialog(null)}>
      <p className="text-sm leading-6 text-muted">{t('“{name}” will be deleted permanently. Money taken from your accounts for this fund goes back to them.', { name: dialog.goal.name })}</p>
      <div className="mt-6 flex justify-end gap-3">
        <Button secondary disabled={busy} onClick={() => setDialog(null)}>{t('Cancel')}</Button>
        <Button className="!bg-negative !text-on-negative" disabled={busy} onClick={() => void run(() => onDelete(dialog.goal))}>{t('Delete')}</Button>
      </div>
    </Modal>}
  </div>;
}

function HistoryCard({ title, subtitle, icon: Icon, tone, goals, show, action }: {
  title: string; subtitle: string; icon: LucideIcon; tone: 'positive' | 'neutral';
  goals: FinancialGoalResponse[]; show: (vnd: number) => string; action: (goal: FinancialGoalResponse) => React.ReactNode;
}) {
  const { t } = useLanguage();
  return <Card className="p-5">
    <SectionHead title={title} subtitle={subtitle} />
    <div className="divide-y divide-line">{goals.map(g => <div key={g.id} className="flex items-center gap-3 py-3">
      <Icon className={`size-4 shrink-0 ${tone === 'positive' ? 'text-positive' : 'text-muted'}`} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-sm">{g.name}</span>
      <span className="hidden text-xs text-muted tabular-nums sm:block">{show(g.currentAmount)} / {show(g.targetAmount)}</span>
      <Badge tone={tone === 'positive' ? 'positive' : 'neutral'}>{t(tone === 'positive' ? 'Reached' : 'Cancelled')}</Badge>
      {action(g)}
    </div>)}</div>
  </Card>;
}

function GoalForm({ goal, busy, onClose, onSave }: {
  goal?: FinancialGoalResponse; busy: boolean; onClose: () => void; onSave: (input: UpsertGoalRequest) => void;
}) {
  const { t, language } = useLanguage();
  const [error, setError] = useState('');
  const minDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return <Modal title={t(goal ? 'Edit savings fund' : 'Add savings fund')} onClose={() => !busy && onClose()}>
    <form className="space-y-5" onSubmit={e => {
      e.preventDefault();
      const data = new FormData(e.currentTarget);
      const name = String(data.get('name')).trim();
      const targetAmount = Number(data.get('targetAmount') || 0);
      const deadline = String(data.get('deadline') || '');
      const reminder = String(data.get('reminderDay') || 'off');
      if (!name) { setError(t('Enter a name for the fund.')); return; }
      if (targetAmount <= 0) { setError(t('Enter a target greater than 0.')); return; }
      if (goal && targetAmount < goal.currentAmount) { setError(t('The target cannot be lower than the amount already saved.')); return; }
      onSave({ name, targetAmount, deadline: deadline || null, reminderDay: reminder === 'off' ? null : Number(reminder) });
    }}>
      <Field label={t('Fund name')}><input name="name" required maxLength={150} autoFocus defaultValue={goal?.name} placeholder={t('e.g. Emergency fund, Da Nang trip')} className={fieldClass} /></Field>
      <Field label={t('Target amount')}><AmountInput name="targetAmount" required defaultValue={goal?.targetAmount} /></Field>
      <Field label={t('Deadline (optional)')}><input name="deadline" type="date" lang={language} min={goal ? undefined : minDate} defaultValue={goal?.deadline ?? ''} className={fieldClass} /></Field>
      <Field label={t('Contribution reminder')}><FormSelect name="reminderDay" label={t('Contribution reminder')} defaultValue={goal?.reminderDay ? String(goal.reminderDay) : 'off'}
        options={[{ value: 'off', label: t('No reminder') }, ...Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: t('Day {n} of every month', { n: i + 1 }), icon: <BellRing aria-hidden="true" className="size-4 shrink-0 text-muted" /> }))]} /></Field>
      <p className="-mt-3 text-xs leading-5 text-muted">{t('You get a notification on that day. Days 29-31 fall on the last day of shorter months.')}</p>
      {goal && <p className="rounded-xl bg-line/40 px-4 py-3 text-xs leading-5 text-muted">{t('Saved so far: {amount}. Use “Add money” to contribute.', { amount: money(goal.currentAmount) })}</p>}
      {error && <p role="alert" className="text-sm text-negative">{error}</p>}
      <div className="flex justify-end gap-3"><Button secondary type="button" disabled={busy} onClick={onClose}>{t('Cancel')}</Button><Button disabled={busy}>{t(goal ? 'Save changes' : 'Add savings fund')}</Button></div>
    </form>
  </Modal>;
}

function ContributeForm({ goal, accounts, hidden, busy, onClose, onSave }: {
  goal: FinancialGoalResponse; accounts: WalletAccount[]; hidden: boolean; busy: boolean; onClose: () => void;
  onSave: (amount: number, accountId: string | null) => void;
}) {
  const { t } = useLanguage();
  const [error, setError] = useState('');
  // Default to the account with the most money; "none" keeps the old behaviour (record it in the fund only).
  const sorted = [...accounts].sort((a, b) => b.balance - a.balance);
  const [source, setSource] = useState(sorted[0]?.id ?? NO_ACCOUNT);
  const account = accounts.find(a => a.id === source);
  const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
  const show = (vnd: number) => hidden ? HIDDEN_AMOUNT : money(vnd);
  return <Modal title={t('Add money to {name}', { name: goal.name })} onClose={() => !busy && onClose()}>
    <form className="space-y-5" onInput={() => setError('')} onSubmit={e => {
      e.preventDefault();
      const amount = Number(new FormData(e.currentTarget).get('amount') || 0);
      if (amount <= 0) { setError(t('Enter an amount greater than 0.')); return; }
      if (account && amount > account.balance) { setError(t('“{name}” only has {amount}.', { name: account.name, amount: money(Math.max(0, account.balance)) })); return; }
      onSave(amount, account?.id ?? null);
    }}>
      <p className="text-sm text-muted">{t('Saved {saved} of {target}. {amount} to go.', { saved: money(goal.currentAmount), target: money(goal.targetAmount), amount: money(remaining) })}</p>
      <Field label={t('Take the money from')}>
        <Select label={t('Take the money from')} value={source} onChange={value => { setSource(value); setError(''); }} options={[
          ...sorted.map(a => ({ value: a.id, label: `${a.name} · ${show(a.balance)}`, icon: <AccountIcon type={a.type} small /> })),
          { value: NO_ACCOUNT, label: t('Not from an account (record only)'), icon: <PiggyBank aria-hidden="true" className="size-4 shrink-0 text-muted" /> },
        ]} />
      </Field>
      <Field label={t('Amount to add')}><AmountInput name="amount" required autoFocus /></Field>
      <p className="text-xs leading-5 text-muted">{account
        ? t('The amount is moved from “{name}” into this fund: the account balance goes down, but it is not counted as spending.', { name: account.name })
        : t('Adding money here only updates this fund. It does not create a transaction or change an account balance.')}</p>
      {error && <p role="alert" className="text-sm text-negative">{error}</p>}
      <div className="flex justify-end gap-3"><Button secondary type="button" disabled={busy} onClick={onClose}>{t('Cancel')}</Button><Button disabled={busy}>{t('Add money')}</Button></div>
    </form>
  </Modal>;
}
