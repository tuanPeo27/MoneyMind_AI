import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, CircleCheck, CircleX, Pencil, Sparkles, X } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { money } from '../../data';
import { AmountInput } from '../AmountInput';
import { Button, Modal } from '../ui';
import { CategoryIcon, getCategoryIcon } from '../CategoryIcon';
import { categoryLabel } from '../../i18n/labels';
import type { AIActionPayload, AIActionResponse, AIBudgetProposalItem } from '../../services';
import { useErrorText } from '../../pages/Auth';
import { useActionOptions } from './AIActionCard';

const MAX_AMOUNT = 999_999_999_999_999;

/** "2026-11" in the reader's language: "tháng 11 năm 2026" / "November 2026". */
const periodLabel = (period: string | null | undefined, locale: string) =>
  period ? new Date(`${period}-01T12:00:00`).toLocaleDateString(locale, { month: 'long', year: 'numeric' }) : '';
const currentPeriod = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

/**
 * A `propose_budgets` action: several monthly budgets the AI suggested, shown under its answer. The user ticks the
 * categories to keep and can change any amount (no new AI call). Nothing is saved until the confirmation dialog;
 * then the backend creates the selected budgets in one transaction (all or none), through the same confirm endpoint
 * as every other AI action, so a second click or a retry cannot create them twice.
 */
export function BudgetProposalCard({ action, onConfirm, onCancel }: {
  action: AIActionResponse;
  /** Resolves when saved; rejects with the server's error (the card stays editable). */
  onConfirm: (payload: AIActionPayload) => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const { t, locale, language } = useLanguage();
  const errorText = useErrorText();
  const options = useActionOptions();
  const p = action.payload;
  const items = (p.budgets ?? []).filter((i): i is AIBudgetProposalItem & { categoryId: string } => !!i.categoryId);
  const pending = action.status === 'Pending';
  const [selected, setSelected] = useState<Record<string, boolean>>(() => Object.fromEntries(items.map(i => [i.categoryId, true])));
  const [amounts, setAmounts] = useState<Record<string, number>>(() => Object.fromEntries(items.map(i => [i.categoryId, i.amount ?? 0])));
  const [editing, setEditing] = useState<string | null>(null);
  const [editError, setEditError] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [skipping, setSkipping] = useState(false);

  const chosen = items.filter(i => selected[i.categoryId]);
  const total = chosen.reduce((s, i) => s + (amounts[i.categoryId] ?? 0), 0);
  const name = (i: AIBudgetProposalItem) => categoryLabel(i.categoryName ?? '', language);
  const icon = (i: AIBudgetProposalItem) => {
    const server = options?.categories.find(c => c.id === i.categoryId)?.icon;
    return getCategoryIcon(i.categoryName ?? '', server ?? undefined);
  };
  const period = periodLabel(p.period, locale);

  function saveAmount(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const value = Number(new FormData(event.currentTarget).get('amount'));
    if (!(value > 0)) { setEditError(t('Enter an amount greater than 0.')); return; }
    if (value > MAX_AMOUNT) { setEditError(t('This amount is too large.')); return; }
    setAmounts(old => ({ ...old, [id]: Math.round(value) }));
    setEditing(null); setEditError('');
  }
  async function create() {
    if (busy || !chosen.length) return;
    setBusy(true); setError('');
    try {
      // Only the kept categories, with their final amounts. Names, reasons and history stay as the server stored them.
      await onConfirm({ ...p, budgets: chosen.map(i => ({ categoryId: i.categoryId, amount: amounts[i.categoryId] })) });
      setReviewing(false);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  const status = action.status === 'Confirmed'
    ? <span className="flex items-center gap-1 rounded-full bg-positive/10 px-2.5 py-1 text-xs font-medium text-positive"><CircleCheck aria-hidden="true" className="size-3.5" />{t('Created')}</span>
    : action.status === 'Cancelled'
      ? <span className="flex items-center gap-1 rounded-full bg-muted/10 px-2.5 py-1 text-xs font-medium text-muted"><CircleX aria-hidden="true" className="size-3.5" />{t('Skipped')}</span>
      : <span className="rounded-full bg-ai/15 px-2.5 py-1 text-xs font-medium text-ai">{t('Proposal')}</span>;

  return <section aria-label={t('Budget proposal from AI')} className="glass overflow-hidden rounded-2xl">
    <header className="border-b border-line px-4 py-3.5">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-ai-from via-ai-to to-ai-warm text-on-ai"><Sparkles className="size-3.5" /></span>
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-ai">{t('Budget proposal from AI')}</p>
        {status}
      </div>
      <p className="mt-2 text-sm leading-6 text-muted">
        {p.summary ? `${p.summary} · ` : ''}{t('Monthly budgets for {period}.', { period })}
      </p>
    </header>

    <ul className="divide-y divide-line/70">{items.map(i => {
      const id = i.categoryId, on = !!selected[id], amount = amounts[id] ?? 0;
      const basis = [
        i.averageSpent != null && (i.historyMonths ?? 0) > 0 ? t('Average {amount}/month over {count} months', { amount: money(i.averageSpent), count: i.historyMonths! }) : t('No full month of history yet'),
        i.currentSpent ? t('{amount} so far this month', { amount: money(i.currentSpent) }) : null,
      ].filter(Boolean).join(' · ');
      return <li key={id} className={`px-4 py-3 transition-opacity ${pending && !on ? 'opacity-55' : ''}`}>
        <div className="flex items-start gap-3">
          {pending
            ? <input type="checkbox" checked={on} onChange={e => setSelected(old => ({ ...old, [id]: e.target.checked }))} disabled={busy}
              aria-label={t('Include {name}', { name: name(i) })} className="mt-2.5 size-4 shrink-0 cursor-pointer accent-[var(--color-accent)]" />
            : action.status === 'Confirmed' ? <CircleCheck aria-hidden="true" className="mt-2.5 size-4 shrink-0 text-positive" /> : null}
          <CategoryIcon name={i.categoryName ?? ''} icon={icon(i)} small />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <p className="min-w-0 truncate text-sm font-semibold">{name(i)}</p>
              {editing !== id && <p className="shrink-0 text-sm font-semibold tabular-nums">{money(amount)}</p>}
            </div>
            {i.reason && <p className="mt-0.5 text-xs leading-5 text-muted">{i.reason}</p>}
            <p className="mt-0.5 text-[11px] leading-5 text-muted/90">{basis}</p>
            {editing === id && <form className="mt-2 flex flex-wrap items-start gap-2" onSubmit={e => saveAmount(e, id)}>
              <div className="min-w-[160px] flex-1"><AmountInput name="amount" required defaultValue={amount} autoFocus /></div>
              <Button type="submit"><Check aria-hidden="true" className="size-4" />{t('Save')}</Button>
              <Button type="button" secondary onClick={() => { setEditing(null); setEditError(''); }}>{t('Cancel')}</Button>
              {editError && <p role="alert" className="w-full text-xs text-negative">{editError}</p>}
            </form>}
          </div>
          {pending && editing !== id && <button type="button" disabled={busy} onClick={() => { setEditing(id); setEditError(''); setSelected(old => ({ ...old, [id]: true })); }}
            aria-label={t('Edit the amount for {name}', { name: name(i) })} title={t('Edit amount')}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-brand/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40">
            <Pencil aria-hidden="true" className="size-4" />
          </button>}
        </div>
      </li>;
    })}</ul>
    {p.skippedCategories?.length ? <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
      {t('Already budgeted for this period, left out: {names}.', { names: p.skippedCategories.map(n => categoryLabel(n, language)).join(', ') })}
    </p> : null}

    <footer className="space-y-3 border-t border-line px-4 py-3.5">
      {pending && <>
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-muted">{t('{count} of {total} selected', { count: chosen.length, total: items.length })}</span>
          <span className="font-semibold tabular-nums">{t('Total')} {money(total)}</span>
        </div>
        {error && !reviewing && <p role="alert" className="text-sm text-negative">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" secondary disabled={busy || skipping} onClick={async () => {
            setSkipping(true); setError('');
            try { await onCancel(); } catch (e) { setError(errorText(e)); } finally { setSkipping(false); }
          }}><X aria-hidden="true" className="size-4" />{t('Skip')}</Button>
          <Button type="button" disabled={!chosen.length || busy || editing !== null} onClick={() => { setError(''); setReviewing(true); }}>
            <Check aria-hidden="true" className="size-4" />{t('Create selected budgets')}
          </Button>
        </div>
        {!chosen.length && <p className="text-right text-xs text-muted">{t('Select at least one category.')}</p>}
      </>}
      {action.status === 'Confirmed' && <div role="status" className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-positive">{t('{count} budgets created for {period}.', { count: items.length, period })}</p>
        <Button type="button" secondary onClick={() => {
          // Leaving /assistant closes the AI page (App keeps the URL and the assistant in sync).
          window.history.replaceState({}, '', '/budgets');
          window.dispatchEvent(new PopStateEvent('popstate'));
        }}>{t('View budgets')}<ArrowRight aria-hidden="true" className="size-4" /></Button>
        {p.period && p.period !== currentPeriod() && <p className="w-full text-xs text-muted">{t('The Budgets page shows them once {period} starts.', { period })}</p>}
      </div>}
    </footer>

    {reviewing && <Modal title={t('Create these budgets?')} onClose={() => { if (!busy) setReviewing(false); }} footer={
      <div className="flex flex-wrap justify-end gap-2.5">
        <Button type="button" secondary disabled={busy} onClick={() => setReviewing(false)}>{t('Back to editing')}</Button>
        <Button type="button" disabled={busy || !chosen.length} onClick={() => void create()} aria-busy={busy}>
          <Check aria-hidden="true" className="size-4" />{busy ? t('Creating...') : t('Confirm and create')}
        </Button>
      </div>
    }>
      <p className="text-sm text-muted">{t('Period')}: <span className="font-medium text-ink">{period}</span></p>
      <ul className="mt-4 divide-y divide-line/70 rounded-xl border border-line">{chosen.map(i => <li key={i.categoryId} className="flex items-center gap-3 px-4 py-2.5">
        <CategoryIcon name={i.categoryName ?? ''} icon={icon(i)} small />
        <span className="min-w-0 flex-1 truncate text-sm">{name(i)}</span>
        <span className="text-sm font-semibold tabular-nums">{money(amounts[i.categoryId] ?? 0)}</span>
      </li>)}</ul>
      <p className="mt-4 flex items-baseline justify-between text-sm"><span className="text-muted">{t('Total budget')}</span><span className="text-[1rem] font-semibold tabular-nums">{money(total)}</span></p>
      <p className="mt-3 text-xs text-muted">{t('All of them are created together. If one cannot be created, none is saved.')}</p>
      {error && <p role="alert" className="mt-3 text-sm text-negative">{error}</p>}
    </Modal>}
  </section>;
}
