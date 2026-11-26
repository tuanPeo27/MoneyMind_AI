import { useEffect, useState } from 'react';
import { CalendarRange, CircleAlert, Info, Lightbulb, Sparkles, TriangleAlert, X } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { Button, Card } from '../ui';
import { aiChatApi, insightsApi, type AIActionResponse, type WeeklyRecommendation, type WeeklySummaryResponse } from '../../services';
import { useErrorText } from '../../pages/Auth';
import { AIActionCard, FINANCE_CHANGED_EVENT } from './AIActionCard';

const severityIcon = { info: Info, warning: TriangleAlert, critical: CircleAlert };
const severityColor = { info: 'text-muted', warning: 'text-amber-500', critical: 'text-negative' };

/** Weekly summary of last week (Smart Insights page): what changed, and up to 2 actions the user can confirm. */
export function WeeklySummary() {
  const { t } = useLanguage();
  const errorText = useErrorText();
  const [summary, setSummary] = useState<WeeklySummaryResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [note, setNote] = useState('');
  // Action cards opened from recommendations, by recommendation id.
  const [actions, setActions] = useState<Record<string, AIActionResponse>>({});

  useEffect(() => {
    let live = true;
    insightsApi.getLatestWeekly().then(result => {
      if (!live) return;
      setSummary(result);
      if (result && !result.isRead) void insightsApi.markRead(result.id).catch(() => undefined);
    }).catch(() => undefined).finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, []);

  async function generate() {
    setBusy(true); setError(''); setNote('');
    try {
      const result = await insightsApi.generateWeekly();
      if (result) setSummary(result);
      else setNote(t('No transactions last week, so there is nothing to summarize yet.'));
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  const replaceRecommendation = (updated: WeeklyRecommendation) => setSummary(s => s && {
    ...s, recommendations: s.recommendations.map(r => r.id === updated.id ? updated : r),
  });

  async function accept(r: WeeklyRecommendation) {
    setError('');
    try {
      const result = await insightsApi.acceptRecommendation(r.id);
      replaceRecommendation(result.recommendation);
      if (result.action) setActions(a => ({ ...a, [r.id]: result.action! }));
    } catch (e) { setError(errorText(e)); }
  }

  async function dismiss(r: WeeklyRecommendation) {
    try { replaceRecommendation(await insightsApi.dismissRecommendation(r.id)); }
    catch (e) { setError(errorText(e)); }
  }

  if (!loaded) return null;

  // Last week's summary already exists when it was created this week; otherwise offer to create it now.
  const monday = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; })();
  const current = summary && new Date(summary.createdAt) >= monday;

  return <Card className="space-y-4 p-5">
    <div className="flex flex-wrap items-center gap-3">
      <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-xl bg-ai/15 text-ai"><CalendarRange className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[1rem] font-semibold tracking-tight">{summary?.title ?? t('Weekly summary')}</h2>
        <p className="text-xs text-muted">{summary
          ? (summary.writtenByAI ? t('Written by AI from your numbers') : t('AI was unavailable; numbers only'))
          : t('Every Monday morning the AI reviews your last week.')}</p>
      </div>
      {(!current || !summary.writtenByAI) && <Button type="button" secondary disabled={busy} onClick={() => void generate()}>
        <Sparkles className="size-4" />{busy ? t('Writing...') : t(current ? 'Try again with AI' : 'Summarize last week')}
      </Button>}
    </div>

    {note && <p className="text-sm text-muted">{note}</p>}
    {error && <p role="alert" className="text-sm text-negative">{error}</p>}

    {summary && <>
      <p className="text-sm leading-relaxed">{summary.summary}</p>
      {summary.items.length > 0 && <ul className="space-y-2.5">{summary.items.map((item, index) => {
        const Icon = severityIcon[item.severity] ?? Info;
        return <li key={index} className="flex gap-2.5 text-sm">
          <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${severityColor[item.severity] ?? 'text-muted'}`} />
          <span><span className="font-medium">{item.title}</span>{' · '}<span className="text-muted">{item.content}</span></span>
        </li>;
      })}</ul>}

      {summary.recommendations.length > 0 && <div className="space-y-3 border-t border-line pt-4">
        {summary.recommendations.map(r => <div key={r.id} className="space-y-2">
          <div className="flex flex-wrap items-start gap-2.5">
            <Lightbulb aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ai" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">{r.title}</p>
              <p className="text-muted">{r.description}</p>
            </div>
            {r.status === 'Pending' && <div className="flex gap-2">
              <Button type="button" secondary onClick={() => void dismiss(r)}><X className="size-4" />{t('Dismiss')}</Button>
              <Button type="button" onClick={() => void accept(r)}>{t(r.dataJson ? 'Do it' : 'Got it')}</Button>
            </div>}
            {r.status === 'Dismissed' && <span className="text-xs text-muted">{t('Dismissed')}</span>}
          </div>
          {actions[r.id] && <AIActionCard action={actions[r.id]}
            onConfirm={async payload => {
              const updated = await aiChatApi.confirmAction(actions[r.id].id, payload);
              setActions(a => ({ ...a, [r.id]: updated }));
              window.dispatchEvent(new Event(FINANCE_CHANGED_EVENT));
            }}
            onCancel={async () => {
              const updated = await aiChatApi.cancelAction(actions[r.id].id);
              setActions(a => ({ ...a, [r.id]: updated }));
            }} />}
        </div>)}
      </div>}
    </>}
  </Card>;
}
