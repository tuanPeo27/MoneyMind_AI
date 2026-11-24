import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeftRight, Check, CircleCheck, CircleX, Pencil, PiggyBank, Shapes, Target, Wallet, X, type LucideIcon } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { money, dateLabel } from '../../data';
import { AmountInput } from '../AmountInput';
import { Button, fieldClass } from '../ui';
import {
  accountsApi, categoriesApi, goalsApi, useSession,
  type AccountResponse, type AIActionPayload, type AIActionResponse, type AIActionType, type CategoryResponse, type FinancialGoalResponse,
} from '../../services';
import { useErrorText } from '../../pages/Auth';

/** Fired after an AI action is saved, so pages showing transactions, budgets or funds reload. */
export const FINANCE_CHANGED_EVENT = 'mm-finance-changed';

type Options = { categories: CategoryResponse[]; accounts: AccountResponse[]; goals: FinancialGoalResponse[] };
let cached: { userId: string; options: Promise<Options> } | null = null;

function loadOptions(userId: string): Promise<Options> {
  if (cached?.userId !== userId) {
    const options = Promise.all([categoriesApi.listCategories(), accountsApi.listAccounts(), goalsApi.listGoals()])
      .then(([categories, accounts, goals]) => ({
        categories: categories.filter(c => c.isActive),
        accounts: accounts.filter(a => !a.isArchived),
        goals: goals.filter(g => g.status === 'Active'),
      }));
    options.catch(() => { if (cached?.options === options) cached = null; });
    cached = { userId, options };
  }
  return cached.options;
}

/** Categories, accounts and funds of the signed-in user for the pickers on the cards; reloaded when data changes. */
function useActionOptions() {
  const { session } = useSession();
  const userId = session?.user.id;
  const [options, setOptions] = useState<Options | null>(null);
  useEffect(() => {
    if (!userId) return;
    let live = true;
    const run = () => { loadOptions(userId).then(o => { if (live) setOptions(o); }).catch(() => undefined); };
    const changed = () => { cached = null; run(); };
    run();
    window.addEventListener(FINANCE_CHANGED_EVENT, changed);
    return () => { live = false; window.removeEventListener(FINANCE_CHANGED_EVENT, changed); };
  }, [userId]);
  return options;
}

const meta: Record<AIActionType, { title: string; icon: LucideIcon }> = {
  create_transaction: { title: 'Add a transaction', icon: ArrowLeftRight },
  create_category: { title: 'Add a category', icon: Shapes },
  create_budget: { title: 'Create a budget', icon: Wallet },
  create_savings_goal: { title: 'Create a savings fund', icon: Target },
  contribute_to_goal: { title: 'Add money to a fund', icon: PiggyBank },
};

/** What still has to be chosen before the action can be saved (empty when it is ready). */
export function missing(type: AIActionType, p: AIActionPayload): string[] {
  const out: string[] = [];
  const amount = type === 'create_savings_goal' ? p.targetAmount : p.amount;
  if (type !== 'create_category' && !(amount && amount > 0)) out.push('amount');
  if ((type === 'create_transaction' || type === 'create_budget') && !p.categoryId) out.push('category');
  if (type === 'create_transaction' && !p.accountId) out.push('account');
  if (type === 'contribute_to_goal' && !p.goalId) out.push('fund');
  if ((type === 'create_category' || type === 'create_savings_goal') && !p.name?.trim()) out.push('name');
  return out;
}

export function AIActionCard({ action, onConfirm, onCancel }: {
  action: AIActionResponse;
  /** Resolves when saved; rejects with the server's error (the card stays editable). */
  onConfirm: (payload?: AIActionPayload) => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const { t, locale } = useLanguage();
  const errorText = useErrorText();
  const options = useActionOptions();
  const p = action.payload;
  const pending = action.status === 'Pending';
  const needs = missing(action.type, p);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  // A proposal the AI could not complete (e.g. no matching category) opens for editing straight away.
  const showForm = pending && (editing || needs.length > 0);
  const { title, icon: Icon } = meta[action.type] ?? meta.create_transaction;

  async function run(work: () => Promise<void>) {
    setBusy(true); setError('');
    try { await work(); setEditing(false); }
    catch (e) { setError(errorText(e)); setEditing(true); }
    finally { setBusy(false); }
  }

  const typeLabel = (value?: string | null) => t(value === 'Income' ? 'Income' : 'Expense');
  const rows: [string, ReactNode][] = (() => {
    switch (action.type) {
      case 'create_transaction': return [
        ['Type', typeLabel(p.type)], ['Amount', p.amount ? money(p.amount) : '—'],
        ['Category', p.categoryName ?? '—'], ['Account', p.accountName ?? '—'],
        ['Date', p.date ? dateLabel(p.date, locale) : '—'], ...(p.description ? [['Note', p.description] as [string, ReactNode]] : []),
      ];
      case 'create_category': return [['Name', p.name ?? '—'], ['Type', typeLabel(p.type)]];
      case 'create_budget': return [
        ['Category', p.categoryName ?? '—'], ['Limit', p.amount ? money(p.amount) : '—'],
        ['Period', `${p.startDate ? dateLabel(p.startDate, locale) : '—'} – ${p.endDate ? dateLabel(p.endDate, locale) : '—'}`],
        ['Warn at', `${p.alertThreshold ?? 80}%`],
      ];
      case 'create_savings_goal': return [
        ['Name', p.name ?? '—'], ['Target', p.targetAmount ? money(p.targetAmount) : '—'],
        ['Deadline', p.deadline ? dateLabel(p.deadline, locale) : t('No deadline')],
      ];
      case 'contribute_to_goal': return [
        ['Fund', p.goalName ?? '—'], ['Amount', p.amount ? money(p.amount) : '—'],
        ['From account', p.accountName ?? t('Not taken from an account')],
      ];
    }
  })();

  return <form className="glass space-y-3 rounded-2xl p-4" onSubmit={e => {
    e.preventDefault();
    const edited = showForm ? readForm(action.type, p, new FormData(e.currentTarget), options) : undefined;
    const stillMissing = edited ? missing(action.type, edited) : needs;
    if (stillMissing.length) { setError(t('Choose {fields} before confirming.', { fields: stillMissing.map(f => t(f)).join(', ') })); return; }
    void run(() => onConfirm(edited));
  }}>
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-ai/15 text-ai"><Icon className="size-4" /></span>
      <p className="min-w-0 flex-1 truncate text-sm font-semibold">{t(title)}</p>
      {action.status === 'Confirmed' && <span className="flex items-center gap-1 text-xs font-medium text-positive"><CircleCheck className="size-4" aria-hidden="true" />{t('Saved')}</span>}
      {action.status === 'Cancelled' && <span className="flex items-center gap-1 text-xs font-medium text-muted"><CircleX className="size-4" aria-hidden="true" />{t('Cancelled')}</span>}
      {pending && <span className="text-xs font-medium text-ai">{t('Waiting for your confirmation')}</span>}
    </div>

    {showForm ? <Fields type={action.type} payload={p} options={options} />
      : <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">{rows.map(([label, value]) => <div key={label} className="contents">
        <dt className="text-muted">{t(label)}</dt><dd className="min-w-0 break-words text-right font-medium tabular-nums">{value}</dd>
      </div>)}</dl>}

    {error && <p role="alert" className="text-sm text-negative">{error}</p>}
    {pending && <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" secondary disabled={busy} onClick={() => void run(onCancel)}><X className="size-4" />{t('Cancel')}</Button>
      {!showForm && <Button type="button" secondary disabled={busy} onClick={() => setEditing(true)}><Pencil className="size-4" />{t('Edit')}</Button>}
      <Button type="submit" disabled={busy}><Check className="size-4" />{busy ? t('Saving...') : t('Confirm')}</Button>
    </div>}
  </form>;
}

function Fields({ type, payload: p, options }: { type: AIActionType; payload: AIActionPayload; options: Options | null }) {
  const { t, language } = useLanguage();
  const [kind, setKind] = useState<'Expense' | 'Income'>(p.type === 'Income' ? 'Income' : 'Expense');
  const field = (label: string, input: ReactNode) => <label className="block space-y-1.5 text-sm font-medium"><span>{t(label)}</span>{input}</label>;
  const typeSelect = <select name="type" value={kind} onChange={e => setKind(e.target.value as 'Expense' | 'Income')} className={fieldClass}>
    <option value="Expense">{t('Expense')}</option><option value="Income">{t('Income')}</option>
  </select>;
  const categorySelect = (only: 'Expense' | 'Income') => <select name="categoryId" defaultValue={p.categoryId ?? ''} key={only} className={fieldClass}>
    <option value="" disabled>{p.categoryName ? t('“{name}” not found, choose one', { name: p.categoryName }) : t('Choose a category')}</option>
    {(options?.categories ?? []).filter(c => c.type === only).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
  </select>;
  const accountSelect = (allowNone: boolean) => <select name="accountId" defaultValue={p.accountId ?? ''} className={fieldClass}>
    <option value="" disabled={!allowNone}>{allowNone ? t('Not taken from an account') : t('Choose an account')}</option>
    {(options?.accounts ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
  </select>;
  const date = (name: string, value?: string | null, required = false) =>
    <input type="date" name={name} lang={language} defaultValue={value ?? ''} required={required} className={fieldClass} />;
  const grid = (children: ReactNode) => <div className="grid gap-3 sm:grid-cols-2">{children}</div>;

  switch (type) {
    case 'create_transaction': return grid(<>
      {field('Type', typeSelect)}
      {field('Amount', <AmountInput name="amount" required defaultValue={p.amount ?? undefined} />)}
      {field('Category', categorySelect(kind))}
      {field('Account', accountSelect(false))}
      {field('Date', date('date', p.date, true))}
      {field('Note', <input name="description" maxLength={500} defaultValue={p.description ?? ''} className={fieldClass} />)}
    </>);
    case 'create_category': return grid(<>
      {field('Name', <input name="name" required maxLength={100} defaultValue={p.name ?? ''} className={fieldClass} />)}
      {field('Type', typeSelect)}
    </>);
    case 'create_budget': return grid(<>
      {field('Category', categorySelect('Expense'))}
      {field('Limit', <AmountInput name="amount" required defaultValue={p.amount ?? undefined} />)}
      {field('Start date', date('startDate', p.startDate, true))}
      {field('End date', date('endDate', p.endDate, true))}
      {field('Warn at (%)', <input type="number" name="alertThreshold" min={1} max={100} required defaultValue={p.alertThreshold ?? 80} className={fieldClass} />)}
    </>);
    case 'create_savings_goal': return grid(<>
      {field('Name', <input name="name" required maxLength={150} defaultValue={p.name ?? ''} className={fieldClass} />)}
      {field('Target', <AmountInput name="targetAmount" required defaultValue={p.targetAmount ?? undefined} />)}
      {field('Deadline (optional)', date('deadline', p.deadline))}
    </>);
    case 'contribute_to_goal': return grid(<>
      {field('Fund', <select name="goalId" defaultValue={p.goalId ?? ''} className={fieldClass}>
        <option value="" disabled>{p.goalName ? t('“{name}” not found, choose one', { name: p.goalName }) : t('Choose a fund')}</option>
        {(options?.goals ?? []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>)}
      {field('Amount', <AmountInput name="amount" required defaultValue={p.amount ?? undefined} />)}
      {field('From account', accountSelect(true))}
    </>);
  }
}

/** The edited payload: every field shown in the form replaces the proposed one; ids also refresh their names. */
function readForm(type: AIActionType, p: AIActionPayload, data: FormData, options: Options | null): AIActionPayload {
  const text = (name: string) => { const v = data.get(name); return v === null ? undefined : String(v).trim() || null; };
  const number = (name: string) => { const v = text(name); return v === undefined ? undefined : v === null ? null : Number(v); };
  const out: AIActionPayload = { ...p };
  const set = <K extends keyof AIActionPayload>(key: K, value: AIActionPayload[K] | undefined) => { if (value !== undefined) out[key] = value; };
  set('type', text('type') as AIActionPayload['type']);
  set('amount', number('amount'));
  set('targetAmount', number('targetAmount'));
  set('categoryId', text('categoryId'));
  set('accountId', text('accountId'));
  set('goalId', text('goalId'));
  set('date', text('date'));
  set('startDate', text('startDate'));
  set('endDate', text('endDate'));
  set('deadline', text('deadline'));
  set('description', text('description'));
  set('name', text('name'));
  const threshold = number('alertThreshold');
  if (threshold !== undefined) out.alertThreshold = threshold;
  if (data.has('categoryId')) out.categoryName = options?.categories.find(c => c.id === out.categoryId)?.name ?? null;
  if (data.has('accountId')) out.accountName = options?.accounts.find(a => a.id === out.accountId)?.name ?? null;
  if (data.has('goalId')) out.goalName = options?.goals.find(g => g.id === out.goalId)?.name ?? null;
  // A transaction whose type changed may no longer match its category; the user must pick one of the new type.
  if (type === 'create_transaction' && out.categoryId && options && !options.categories.some(c => c.id === out.categoryId && c.type === out.type)) {
    out.categoryId = null;
  }
  return out;
}
