import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLanguage } from '../i18n';
import { Select } from './Select';

export type Pager<T> = {
  items: T[]; page: number; pageCount: number; size: number; total: number; start: number;
  setPage: (page: number) => void; setSize: (size: number) => void;
};

/**
 * Client-side pagination. `resetKey` (e.g. a string of the active filters) sends the list back to page 1 when it changes.
 * The current page is clamped, so deleting the last item of the last page lands on the new last page.
 */
export function usePagination<T>(list: T[], defaultSize = 10, resetKey: string | number = ''): Pager<T> {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(defaultSize);
  useEffect(() => { setPage(1); }, [resetKey, size]);
  const pageCount = Math.max(1, Math.ceil(list.length / size));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * size;
  return { items: list.slice(start, start + size), page: current, pageCount, size, total: list.length, start, setPage, setSize };
}

function pageList(page: number, count: number): (number | 'gap-start' | 'gap-end')[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const pages = new Set([1, count, page - 1, page, page + 1]);
  if (page <= 3) { pages.add(2); pages.add(3); pages.add(4); }
  if (page >= count - 2) { pages.add(count - 1); pages.add(count - 2); pages.add(count - 3); }
  const sorted = [...pages].filter(p => p >= 1 && p <= count).sort((a, b) => a - b);
  const result: (number | 'gap-start' | 'gap-end')[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) result.push(i < sorted.length / 2 ? 'gap-start' : 'gap-end');
    result.push(p);
  });
  return result;
}

const control = 'inline-flex size-9 items-center justify-center rounded-xl text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-40';

export function Pagination<T>({ pager, sizes = [10, 20, 50], className = '' }: { pager: Pager<T>; sizes?: number[]; className?: string }) {
  const { t } = useLanguage();
  if (pager.total === 0 || (pager.pageCount === 1 && pager.total <= Math.min(...sizes))) return null;
  const from = pager.start + 1, to = Math.min(pager.start + pager.size, pager.total);
  return <div className={`flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-xs text-muted ${className}`}>
    <span aria-live="polite">{t('Showing {from}–{to} of {total}', { from, to, total: pager.total })}</span>
    <div className="flex flex-wrap items-center gap-3">
      <Select className="w-[132px]" label={t('Rows per page')} value={String(pager.size)} onChange={value => pager.setSize(Number(value))}
        options={sizes.map(n => ({ value: String(n), label: t('{n} / page', { n }) }))} />
      <nav aria-label={t('Pagination')} className="flex items-center gap-1">
        <button type="button" aria-label={t('Previous page')} disabled={pager.page === 1} onClick={() => pager.setPage(pager.page - 1)} className={`${control} text-ink hover:bg-brand/10`}><ChevronLeft className="size-4" aria-hidden="true" /></button>
        {pageList(pager.page, pager.pageCount).map(item => typeof item === 'string'
          ? <span key={item} aria-hidden="true" className="inline-flex size-9 items-center justify-center">…</span>
          : <button key={item} type="button" aria-label={t('Page {n}', { n: item })} aria-current={item === pager.page ? 'page' : undefined} onClick={() => pager.setPage(item)}
            className={`${control} ${item === pager.page ? 'bg-gradient-to-br from-accent to-accent-2 font-semibold text-on-accent shadow-md shadow-accent/30' : 'text-ink hover:bg-brand/10'}`}>{item}</button>)}
        <button type="button" aria-label={t('Next page')} disabled={pager.page === pager.pageCount} onClick={() => pager.setPage(pager.page + 1)} className={`${control} text-ink hover:bg-brand/10`}><ChevronRight className="size-4" aria-hidden="true" /></button>
      </nav>
    </div>
  </div>;
}
