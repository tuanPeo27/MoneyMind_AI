/**
 * Headline cards (total balance, income, expenses, savings). Shared by Overview, Reports and Workspace, so it lives
 * outside pages/Overview.tsx: importing it from there pulled the Overview chunk, and with it the charting library
 * (recharts, ~110 KB gzip), into pages that show no chart.
 */
import { useContext } from 'react';
import { Wallet, TrendingUp, TrendingDown, Landmark, Sparkles, Eye, EyeOff } from 'lucide-react';
import { useLanguage } from '../i18n';
import { currencySymbol, formatAmount } from '../lib/currency';
import { BalanceContext, percentChange, type Totals } from '../lib/totals';
import { Card, Change } from './ui';
import { Skeleton, SkeletonText, useFadeIn } from './Skeleton';
import { useAmbientAIView } from './ambient-ai/AmbientAIProvider';
export function SummaryCards({ totals, previous, hidden = false, onToggleHidden, layout = 'row', loading = false }: { totals: Totals; previous: Totals; hidden?: boolean; onToggleHidden?: (next: boolean) => void; layout?: 'row' | 'grid' | 'stack'; loading?: boolean }) {
  const { t } = useLanguage();
  const fade = useFadeIn(loading);
  const { highlight, openAssistant } = useAmbientAIView();
  const balance = useContext(BalanceContext);
  const symbol = currencySymbol();
  const allCards = [
    { label: 'Total balance', value: balance?.current ?? totals.balance, previous: balance?.previous ?? previous.balance, icon: Wallet },
    { label: 'Total income', value: totals.income, previous: previous.income, icon: TrendingUp },
    { label: 'Total expenses', value: totals.expense, previous: previous.expense, icon: TrendingDown, inverse: true },
    { label: 'Savings', value: totals.savings, previous: previous.savings, icon: Landmark },
  ];
  // 'stack' (Overview): Total balance across the top, income and expenses side by side below, no Savings card.
  const stack = layout === 'stack';
  const cards = stack ? allCards.slice(0, 3) : allCards;
  // The card the AI points at for a "summary" answer: Savings, or Total balance when there is no Savings card.
  const aiCard = stack ? 0 : 3;
  return <div id="ai-summary" className={`grid grid-cols-2 gap-3 sm:gap-4 ${layout === 'row' ? 'xl:grid-cols-[1.15fr_1fr_1fr_1fr]' : ''}`}>{cards.map(({ label, value, previous: old, icon: Icon, inverse }, index) =>
    <Card key={label} className={`relative px-3.5 py-3.5 sm:px-5 sm:py-5 transition-all duration-300 motion-safe:hover:-translate-y-0.5 ${index === 0 ? 'hero-card' : ''} ${stack && index === 0 ? 'col-span-2' : ''} ${highlight === 'summary' && index === aiCard ? 'ring-1 ring-ai-from/75 brightness-110 shadow-[0_0_24px_-14px_var(--color-ai-from)]' : ''}`}>
      {highlight === 'summary' && index === aiCard && <button onClick={() => openAssistant('How can I improve my savings?')} className="absolute -top-6 right-3 flex min-h-11 items-center gap-1.5 rounded-lg bg-gradient-to-br from-ai-from via-ai-to to-ai-warm text-on-ai px-3 text-xs font-semibold shadow-md shadow-ai-from/30"><Sparkles className="h-3 w-3" />{t("AI Insight")}</button>}
      <div className="flex items-center justify-between gap-2"><span className="truncate text-xs text-muted sm:text-sm">{t(label)}</span>{index === 0 && onToggleHidden ? <button type="button" onClick={() => onToggleHidden(!hidden)} aria-pressed={hidden} aria-label={hidden ? t("Show account balance") : t("Hide account balance")} className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-brand/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{hidden ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}</button> : <Icon className={`h-4 w-4 shrink-0 ${index === 1 ? 'text-positive' : index === 2 ? 'text-negative' : 'text-muted'}`} aria-hidden="true" />}</div>
      {loading ? <>
        {/* Same heights as the amount (its font size, leading-none) and the change line (16px). */}
        <div className="mt-3 sm:mt-4"><Skeleton className={index === 0 ? 'h-[20px] w-28 sm:h-[29px] sm:w-36 2xl:h-[34px]' : 'h-[19px] w-24 sm:h-[26px] sm:w-32 2xl:h-[30px]'} /></div>
        <SkeletonText className="mt-3 h-4 sm:mt-4" bar="h-2.5" width="w-20 sm:w-32" />
      </> : <div className={fade}>
      <div className="mt-3 flex items-baseline gap-1 sm:mt-4 sm:gap-1.5"><span className={`font-semibold leading-none tracking-[-0.045em] tabular-nums ${index === 0 ? 'text-[20px] sm:text-[29px] 2xl:text-[34px]' : 'text-[19px] sm:text-[26px] 2xl:text-[30px]'}`}>{formatAmount(value)}</span>{!hidden && <span className={`text-sm text-muted ${symbol.before ? '-order-1' : ''}`}>{symbol.symbol}</span>}</div>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-0.5 sm:mt-4">{index === 0 && hidden ? <span className="text-xs text-muted">{t("Balance hidden")}</span> : <><Change value={percentChange(value, old)} inverse={inverse} /><span className="hidden text-xs text-muted sm:inline">{index === 3 ? t('{rate}% savings rate', { rate: totals.rate.toFixed(1) }) : t("vs. previous period")}</span></>}</div>
      </div>}
    </Card>,
  )}</div>;
}
