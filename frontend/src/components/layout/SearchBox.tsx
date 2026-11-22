import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, Clock, Tag, ReceiptText, X, CornerDownLeft } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { useLocal } from '../../hooks/useLocal';
import { type Transaction, type Category, money, dateLabel } from '../../data';

type Suggestion = { id: string; kind: 'recent' | 'category' | 'transaction'; value: string; meta?: string; amount?: string };

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const at = text.toLocaleLowerCase().indexOf(q.toLocaleLowerCase());
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark className="rounded bg-brand/20 px-0.5 text-ink">{text.slice(at, at + q.length)}</mark>{text.slice(at + q.length)}</>;
}

/** Header search with suggestions: recent searches and popular categories when empty, matching categories and transactions while typing. */
export function SearchBox({ value, onChange, onSubmit, transactions, categories }: {
  value: string; onChange: (value: string) => void; onSubmit: (value: string) => void;
  transactions: Transaction[]; categories: Category[];
}) {
  const { t, locale } = useLanguage();
  const [open, setOpen] = useState(false), [active, setActive] = useState(-1), [phoneOpen, setPhoneOpen] = useState(false);
  const [recent, setRecent] = useLocal<string[]>('mm-recent-searches-v1', []);
  const root = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const query = value.trim();

  const groups = useMemo(() => {
    const q = query.toLocaleLowerCase();
    const result: { title: string; items: Suggestion[] }[] = [];
    if (!q) {
      if (recent.length) result.push({ title: 'Recent searches', items: recent.slice(0, 5).map(r => ({ id: `r-${r}`, kind: 'recent', value: r })) });
      const usage = new Map<string, number>();
      transactions.forEach(tx => usage.set(tx.category, (usage.get(tx.category) || 0) + 1));
      const popular = [...usage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      if (popular.length) result.push({ title: 'Popular categories', items: popular.map(([name, count]) => ({ id: `p-${name}`, kind: 'category', value: name, meta: t('{count} transactions', { count }) })) });
      return result;
    }
    const cats = categories.filter(c => c.name.toLocaleLowerCase().includes(q)).slice(0, 3)
      .map<Suggestion>(c => ({ id: `c-${c.name}`, kind: 'category', value: c.name, meta: t(c.type === 'Income' ? 'Income category' : 'Expense category') }));
    const seen = new Set<string>();
    const txs = transactions.filter(tx => `${tx.description} ${tx.category} ${tx.account}`.toLocaleLowerCase().includes(q))
      .filter(tx => !seen.has(tx.description) && !!seen.add(tx.description)).slice(0, 5)
      .map<Suggestion>(tx => ({ id: `t-${tx.id}`, kind: 'transaction', value: tx.description, meta: `${tx.category} · ${dateLabel(tx.date, locale)}`, amount: `${tx.type === 'Income' ? '+' : '−'}${money(tx.amount)}` }));
    if (cats.length) result.push({ title: 'Categories', items: cats });
    if (txs.length) result.push({ title: 'Transactions', items: txs });
    return result;
  }, [query, recent, transactions, categories, t, locale]);
  const flat = groups.flatMap(g => g.items);

  useEffect(() => { setActive(-1); }, [query, open]);
  useEffect(() => { if (phoneOpen) { input.current?.focus(); setOpen(true); } }, [phoneOpen]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  function commit(text: string) {
    const clean = text.trim();
    onChange(text);
    if (clean) setRecent(old => [clean, ...old.filter(item => item.toLocaleLowerCase() !== clean.toLocaleLowerCase())].slice(0, 6));
    setOpen(false); setPhoneOpen(false);
    onSubmit(text);
  }
  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') { setOpen(false); setPhoneOpen(false); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      if (!flat.length) return;
      setActive(i => event.key === 'ArrowDown' ? (i + 1) % flat.length : (i <= 0 ? flat.length - 1 : i - 1));
    }
  }
  let position = -1;
  const showPanel = open && (flat.length > 0 || !!query);
  return <>
  <button type="button" aria-label={t('Search transactions...')} title={t('Search transactions...')} onClick={() => setPhoneOpen(true)} className="flex size-11 items-center justify-center rounded-xl text-muted transition-colors hover:bg-brand/10 hover:text-ink focus-visible:ring-2 focus-visible:ring-brand lg:hidden"><Search className="size-[18px]" aria-hidden="true" /></button>
  <form ref={root} role="search" className={phoneOpen ? 'fixed inset-x-0 top-0 z-[60] flex h-[76px] items-center gap-2 border-b border-line bg-[var(--color-popover)] px-3 lg:relative lg:block lg:h-auto lg:border-0 lg:bg-transparent lg:p-0' : 'relative hidden lg:block'} onSubmit={event => { event.preventDefault(); commit(active >= 0 && flat[active] ? flat[active].value : value); }}>
    <span className="relative block min-w-0 flex-1 lg:flex-none"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted" aria-hidden="true" />
    <input ref={input} role="combobox" aria-expanded={showPanel} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
      aria-label={t("Search transactions and press Enter")} placeholder={t("Search transactions...")} value={value} autoComplete="off"
      onChange={event => { onChange(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
      className="min-h-11 w-full rounded-xl border border-line bg-surface pl-10 pr-9 lg:w-[200px] text-sm outline-none transition-[width,box-shadow,border-color] duration-300 placeholder:text-muted lg:focus:w-[300px] focus:border-brand focus:ring-2 focus:ring-brand/20" />
    {value && <button type="button" aria-label={t("Clear search")} onClick={() => { onChange(''); setOpen(true); input.current?.focus(); }} className="absolute right-1.5 top-1.5 flex size-8 items-center justify-center rounded-lg text-muted hover:bg-brand/10 hover:text-ink"><X className="size-3.5" aria-hidden="true" /></button>}</span>
    {phoneOpen && <button type="button" onClick={() => { setPhoneOpen(false); setOpen(false); }} className="shrink-0 rounded-xl px-3 text-sm font-medium text-brand lg:hidden">{t("Cancel")}</button>}
    {showPanel && <div id={listId} role="listbox" aria-label={t("Search suggestions")} style={{ background: 'var(--color-popover)' }} className="glass-strong fixed inset-x-3 top-[84px] z-50 max-h-[70dvh] overflow-y-auto rounded-2xl p-2 lg:absolute lg:inset-x-auto lg:left-0 lg:top-full lg:mt-2 lg:w-[360px]">
      {groups.map(group => <Fragment key={group.title}>
        <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{t(group.title)}</p>
        {group.items.map(item => {
          position += 1;
          const index = position, Icon = item.kind === 'recent' ? Clock : item.kind === 'category' ? Tag : ReceiptText;
          return <div key={item.id} id={`${listId}-${index}`} role="option" aria-selected={index === active} onPointerMove={() => setActive(index)} onPointerDown={event => event.preventDefault()} onClick={() => commit(item.value)}
            className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-1.5 text-sm transition-colors ${index === active ? 'bg-brand/12' : ''}`}>
            <Icon className="size-4 shrink-0 text-muted" aria-hidden="true" />
            <span className="min-w-0 flex-1"><span className="block truncate"><Highlight text={item.value} query={query} /></span>{item.meta && <span className="block truncate text-xs text-muted">{item.meta}</span>}</span>
            {item.amount && <span className="shrink-0 text-xs font-medium tabular-nums">{item.amount}</span>}
            {item.kind === 'recent' && <button type="button" aria-label={t("Remove from recent searches")} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setRecent(old => old.filter(r => r !== item.value)); }} className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-brand/10 hover:text-ink"><X className="size-3.5" aria-hidden="true" /></button>}
          </div>;
        })}
      </Fragment>)}
      {!flat.length && <p className="px-3 py-6 text-center text-sm text-muted">{t('No matches for "{query}"', { query })}</p>}
      {!!query && <div className="mt-1 flex items-center gap-2 border-t border-line px-3 pb-1 pt-2.5 text-xs text-muted"><CornerDownLeft className="size-3.5" aria-hidden="true" />{t('Press Enter to search "{query}"', { query })}</div>}
    </div>}
  </form>
  </>;
}
