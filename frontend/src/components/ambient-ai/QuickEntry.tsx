import { useState, type FormEvent } from 'react';
import { CheckCheck, Sparkles, X } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { Button, Card, fieldClass } from '../ui';
import { aiChatApi, ApiError, type AIActionResponse } from '../../services';
import type { Transaction } from '../../data';
import { useErrorText } from '../../pages/Auth';
import { AIActionCard, FINANCE_CHANGED_EVENT, missing } from './AIActionCard';

const fold = (value?: string | null) =>
  (value ?? '').trim().toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ');

/**
 * Reads the first amount in a quick entry without AI: "35k", "35.000", "1tr5", "1,5 triệu". Used to prefill the manual
 * form when the AI is not available. The rest of the text becomes the description.
 */
export function parseQuickEntry(text: string): Partial<Transaction> {
  const match = /(\d+(?:[.,]\d{3})*(?:[.,]\d+)?)\s*(k|nghìn|ngàn|tr|triệu|củ)?(\d)?(?![\p{L}\d])/iu.exec(text);
  if (!match) return { description: text.trim() };
  let amount = Number(match[1].replace(/[.,](?=\d{3}(?:\D|$))/g, '').replace(',', '.'));
  const unit = match[2]?.toLowerCase();
  if (unit === 'k' || unit === 'nghìn' || unit === 'ngàn') amount *= 1_000;
  else if (unit) amount = amount * 1_000_000 + (match[3] ? Number(match[3]) * 100_000 : 0);
  const description = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).replace(/\s+/g, ' ').trim();
  return { amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount) : undefined, description };
}

/**
 * Pending actions that can be saved without asking anything: complete ones, plus transactions whose only gap is a
 * category proposed in the same batch (it is saved first, and the server matches the name again on confirm).
 * Categories come first for that reason.
 */
function readyToSave(actions: AIActionResponse[]): AIActionResponse[] {
  const pending = actions.filter(a => a.status === 'Pending');
  const newCategories = pending.filter(a => a.type === 'create_category' && !missing(a.type, a.payload).length);
  const ready = pending.filter(a => {
    const gaps = missing(a.type, a.payload);
    if (!gaps.length) return true;
    return a.type === 'create_transaction' && gaps.length === 1 && gaps[0] === 'category'
      && newCategories.some(c => fold(c.payload.name) === fold(a.payload.categoryName)
        && (c.payload.type ?? 'Expense') === (a.payload.type ?? 'Expense'));
  });
  return [...ready.filter(a => a.type === 'create_category'), ...ready.filter(a => a.type !== 'create_category')];
}

/** Quick entry on the overview: type "cà phê 35k, grab 50k", check the cards, save. */
export function QuickEntry({ onManual }: {
  /** Opens the manual transaction form with what could be read from the text (used when the AI is unavailable). */
  onManual: (draft: Partial<Transaction>) => void;
}) {
  const { t, language } = useLanguage();
  const errorText = useErrorText();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false), [savingAll, setSavingAll] = useState(false);
  const [error, setError] = useState(''), [note, setNote] = useState('');
  const [actions, setActions] = useState<AIActionResponse[]>([]);

  const replace = (updated: AIActionResponse) => setActions(list => list.map(a => a.id === updated.id ? updated : a));
  const ready = readyToSave(actions);
  const hasPending = actions.some(a => a.status === 'Pending');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const entry = text.trim();
    if (!entry || busy) return;
    setBusy(true); setError(''); setNote('');
    try {
      const response = await aiChatApi.captureEntry(entry, language);
      const proposed = response.assistantMessage.actions ?? [];
      setActions(proposed);
      // No action means the AI needs more (usually the amount); its one-line answer says what.
      if (!proposed.length) setNote(response.assistantMessage.content);
      else setText('');
    } catch (e) {
      if (e instanceof ApiError && (e.status === 429 || e.status === 503)) {
        setError(e.status === 429 ? t('You have used all AI messages for today. Enter the transaction manually.')
          : t('The AI is unavailable right now. Enter the transaction manually.'));
        onManual(parseQuickEntry(entry));
      } else setError(errorText(e));
    } finally { setBusy(false); }
  }

  async function saveAll() {
    setSavingAll(true); setError('');
    let failed = 0;
    for (const action of ready) {
      try { replace(await aiChatApi.confirmAction(action.id)); }
      catch { failed += 1; }
    }
    setSavingAll(false);
    window.dispatchEvent(new Event(FINANCE_CHANGED_EVENT));
    if (failed) setError(t('{count} items could not be saved. Check them below.', { count: failed }));
  }

  async function confirmOne(action: AIActionResponse, payload?: Parameters<typeof aiChatApi.confirmAction>[1]) {
    replace(await aiChatApi.confirmAction(action.id, payload));
    window.dispatchEvent(new Event(FINANCE_CHANGED_EVENT));
  }

  return <Card className="space-y-3 p-4 sm:p-5">
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">{t('Quick add')}</span>
        <Sparkles aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ai" />
        <input value={text} onChange={e => setText(e.target.value)} maxLength={500} disabled={busy}
          placeholder={t('Quick add, e.g. “coffee 35k, grab 50k yesterday”')}
          className={`${fieldClass} pl-9 placeholder:text-muted/75`} />
      </label>
      <Button type="submit" disabled={busy || !text.trim()}>{busy ? t('Reading...') : t('Add with AI')}</Button>
    </form>

    {note && <p className="text-sm text-muted">{note}</p>}
    {error && <p role="alert" className="text-sm text-negative">{error}</p>}

    {actions.length > 0 && <div className="space-y-3">
      {actions.map(action => <AIActionCard key={action.id} action={action}
        onConfirm={payload => confirmOne(action, payload)}
        onCancel={async () => replace(await aiChatApi.cancelAction(action.id))} />)}
      <div className="flex flex-wrap justify-end gap-2">
        {!hasPending && <Button type="button" secondary onClick={() => { setActions([]); setError(''); }}><X className="size-4" />{t('Close')}</Button>}
        {ready.length > 1 && <Button type="button" disabled={savingAll} onClick={() => void saveAll()}>
          <CheckCheck className="size-4" />{savingAll ? t('Saving...') : t('Save all ({count})', { count: ready.length })}
        </Button>}
      </div>
    </div>}
  </Card>;
}
