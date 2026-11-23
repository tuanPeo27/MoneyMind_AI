import { useEffect, useState } from 'react';
import { Infinity as InfinityIcon, MessageSquare } from 'lucide-react';
import { Badge, Button, Card, Modal, SectionHead } from '../components/ui';
import { adminUsersApi, AI_UNLIMITED, type AdminUserResponse } from '../services';
import { useErrorText } from '../pages/Auth';

/** The limits an admin can grant. Kept in sync with the backend (AIQuota.AllowedLimits). */
export const AI_LIMIT_OPTIONS = [10, 20, 50, AI_UNLIMITED] as const;

export const limitLabel = (limit: number | null) => limit === null || limit === AI_UNLIMITED ? 'Unlimited' : `${limit} / day`;

/** "7 / 20 today", or "7 today · Unlimited". */
export function QuotaBadge({ user }: { user: AdminUserResponse }) {
  const q = user.aiQuota;
  const full = !q.isUnlimited && q.effectiveLimit !== null && q.usedToday >= q.effectiveLimit;
  return <span className="inline-flex flex-col items-start gap-1">
    <Badge tone={q.isUnlimited ? 'blue' : full ? 'negative' : 'neutral'}>
      {q.isUnlimited ? <><InfinityIcon className="size-3" aria-hidden="true" />{q.usedToday} today</> : `${q.usedToday} / ${q.effectiveLimit} today`}
    </Badge>
    {q.customLimit === null && <span className="text-[11px] text-muted">System default</span>}
  </span>;
}

/** Grant 10, 20, 50 or unlimited messages per day, or return the user to the system default. */
export function QuotaDialog({ user, defaultLimit, onClose, onSaved }: {
  user: AdminUserResponse; defaultLimit: number | null; onClose: () => void; onSaved: (user: AdminUserResponse) => void;
}) {
  const errorText = useErrorText();
  // 0 = follow the system default.
  const [choice, setChoice] = useState<number>(user.aiQuota.customLimit ?? 0);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const options: { value: number; label: string; note?: string }[] = [
    { value: 0, label: 'System default', note: defaultLimit === null ? undefined : limitLabel(defaultLimit) },
    ...AI_LIMIT_OPTIONS.map(value => ({ value, label: limitLabel(value) })),
  ];
  async function save() {
    setBusy(true); setError('');
    try { onSaved(await adminUsersApi.setAIQuota(user.id, choice === 0 ? null : choice)); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  return <Modal title="AI message limit" onClose={() => !busy && onClose()}>
    <p className="text-sm leading-6 text-muted">{user.fullName} ({user.email}) has used <span className="font-medium text-ink">{user.aiQuota.usedToday}</span> AI messages today.
      The count starts again at midnight in the user's time zone.</p>
    <fieldset className="mt-5 grid gap-2 sm:grid-cols-2">
      <legend className="sr-only">Daily AI message limit</legend>
      {options.map(o => <label key={o.value} className="cursor-pointer">
        <input type="radio" name="ai-limit" className="peer sr-only" checked={choice === o.value} onChange={() => setChoice(o.value)} />
        <span className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-line px-4 py-3 text-sm peer-checked:border-brand peer-checked:bg-brand/10 peer-focus-visible:ring-2 peer-focus-visible:ring-brand">
          <span className="font-medium">{o.label}</span>{o.note && <span className="text-xs text-muted">{o.note}</span>}
        </span>
      </label>)}
    </fieldset>
    {choice !== 0 && choice !== AI_UNLIMITED && user.aiQuota.usedToday >= choice && <p className="mt-4 text-sm text-negative">This user has already used {user.aiQuota.usedToday} messages today, so they cannot send more until tomorrow.</p>}
    {choice === AI_UNLIMITED && <p className="mt-4 text-sm text-muted">Every message still uses the shared Gemini quota. Grant unlimited only to accounts you trust.</p>}
    {error && <p role="alert" className="mt-4 text-sm text-negative">{error}</p>}
    <div className="mt-6 flex justify-end gap-3">
      <Button secondary disabled={busy} onClick={onClose}>Cancel</Button>
      <Button disabled={busy || choice === (user.aiQuota.customLimit ?? 0)} onClick={() => void save()}>{busy ? 'Saving...' : 'Save limit'}</Button>
    </div>
  </Modal>;
}

/** The limit for every user an admin has not set one for. */
export function DefaultQuotaCard() {
  const errorText = useErrorText();
  const [current, setCurrent] = useState<number | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => {
    adminUsersApi.getAIQuotaSettings()
      .then(s => { setCurrent(s.defaultDailyLimit); setChoice(s.defaultDailyLimit); })
      .catch(e => setError(errorText(e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    if (choice === null) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const s = await adminUsersApi.setDefaultAIQuota(choice);
      setCurrent(s.defaultDailyLimit); setChoice(s.defaultDailyLimit);
      setNotice(`Default limit is now ${limitLabel(s.defaultDailyLimit).toLowerCase()}.`);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  return <Card className="p-6">
    <SectionHead title="AI message limit" subtitle="Messages each user can send to the AI assistant per day, unless you set a different limit for that user on the Users page." action={<MessageSquare className="size-4 text-brand" aria-hidden="true" />} />
    {current === null && !error ? <p role="status" className="text-sm text-muted">Loading...</p> : <>
      <fieldset className="grid gap-2 sm:grid-cols-4">
        <legend className="sr-only">Default daily AI message limit</legend>
        {AI_LIMIT_OPTIONS.map(value => <label key={value} className="cursor-pointer">
          <input type="radio" name="default-ai-limit" className="peer sr-only" checked={choice === value} onChange={() => { setChoice(value); setNotice(''); }} />
          <span className="flex min-h-12 items-center justify-center rounded-xl border border-line px-3 text-sm font-medium peer-checked:border-brand peer-checked:bg-brand/10 peer-focus-visible:ring-2 peer-focus-visible:ring-brand">{limitLabel(value)}</span>
        </label>)}
      </fieldset>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-4">
        {notice && <span role="status" className="text-sm text-positive">{notice}</span>}
        {error && <span role="alert" className="text-sm text-negative">{error}</span>}
        <Button type="button" disabled={busy || choice === current} onClick={() => void save()}>{busy ? 'Saving...' : 'Save default'}</Button>
      </div>
    </>}
    <div className="mt-6 border-t border-line pt-5">
      <p className="text-sm font-medium">AI model</p>
      <p className="mt-1 text-sm leading-6 text-muted">Chosen by the system, not by users. When the main Gemini model runs out of quota or is unavailable, the next model in the list answers instead. The list is set in <code className="rounded bg-line/60 px-1">ai-service/.env</code>, and the model that answered each request is shown in the AI processing log.</p>
    </div>
  </Card>;
}
