import { useLanguage } from '../i18n';
import { useEffect, useId, useRef, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowUpRight, ArrowDownRight, type LucideIcon } from 'lucide-react';
import { LiquidButton } from './LiquidButton';

export const fieldClass = 'w-full min-h-11 rounded-xl border border-line bg-surface px-3.5 text-sm text-ink outline-none transition-shadow placeholder:text-muted/70 hover:border-muted/50 focus:border-brand focus:ring-2 focus:ring-brand/20';
export function Button({ children, secondary, className = '', ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { secondary?: boolean; children?: ReactNode }) {
  return <LiquidButton {...props} variant={secondary ? 'secondary' : 'primary'} className={className}>{children}</LiquidButton>;
}
export function IconButton({ icon: Icon, label, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  const { t } = useLanguage();
  return <LiquidButton {...props} variant="icon" aria-label={t(label)} title={t(label)}><Icon className="h-4 w-4 shrink-0" aria-hidden="true" /></LiquidButton>;
}export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`glass min-w-0 rounded-2xl text-ink transition-shadow duration-300 ${className}`}>{children}</section>;
}
export function SectionHead({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  const { t } = useLanguage();
  return <div className="mb-5 flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-[1rem] font-semibold tracking-[-0.02em] text-ink">{t(title)}</h2>{subtitle && <p className="mt-1 text-sm text-muted">{t(subtitle)}</p>}</div>{action}</div>;
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'positive' | 'negative' | 'neutral' | 'blue' }) {
  const colors = { positive: 'bg-positive/10 text-positive', negative: 'bg-negative/10 text-negative', neutral: 'bg-muted/10 text-muted', blue: 'bg-brand/10 text-brand' };
  return <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${colors[tone]}`}>{children}</span>;
}
export function Change({ value, inverse = false }: { value: number; inverse?: boolean }) {
  const positive = inverse ? value <= 0 : value >= 0;
  const Icon = value >= 0 ? ArrowUpRight : ArrowDownRight;
  return <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${positive ? 'text-positive' : 'text-negative'}`}><Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{Math.abs(value).toFixed(1)}%</span>;
}
export function Progress({ value, color = 'var(--color-brand)', label }: { value: number; color?: string; label: string }) {
  return <div role="progressbar" aria-label={label} aria-valuenow={Math.min(100, Math.max(0, Math.round(value)))} aria-valuemin={0} aria-valuemax={100} className="h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full transition-all duration-500 ease-out motion-reduce:transition-none" style={{ width: `${Math.min(100, Math.max(0, value))}%`, backgroundColor: color }} /></div>;
}
export function Empty({ title = 'Nothing here yet', text = 'Try a different filter or add your first item.' }: { title?: string; text?: string }) {
  const { t } = useLanguage();
  return <div className="px-6 py-14 text-center"><p className="text-[1rem] font-medium">{t(title)}</p><p className="mt-2 text-sm text-muted">{t(text)}</p></div>;
}
export function Modal({ title, children, onClose, footer, wide = false }: { title: string; children: ReactNode; onClose: () => void; footer?: ReactNode; wide?: boolean }) {
  const { t } = useLanguage();
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const panel = ref.current!;
    const focusable = () => Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]'));
    (focusable().find(el => el.tagName === 'INPUT') || focusable()[0])?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') {
        const all = focusable(), first = all[0], last = all[all.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  // Rendered into <body>: an ancestor with a transform (e.g. a .glass card) would otherwise become the containing
  // block of `position: fixed`, so the dialog would be centred and blurred inside that card instead of the screen.
  return createPortal(<div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#1b0f2a]/35 p-3 backdrop-blur-md sm:p-6" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`flex max-h-[calc(100dvh-24px)] w-full flex-col overflow-hidden glass-strong rounded-3xl text-ink sm:max-h-[min(90dvh,800px)] ${wide ? 'max-w-xl' : 'max-w-lg'}`}>
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-5 py-3 sm:px-6">
        <h2 id={titleId} className="text-lg font-semibold tracking-tight text-ink">{t(title)}</h2>
        <IconButton icon={X} label={t("Close dialog")} onClick={onClose} />
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-5 [scrollbar-color:var(--color-line)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-line [&::-webkit-scrollbar-track]:bg-transparent sm:px-6 sm:py-6">{children}</div>
      {footer && <div className="shrink-0 border-t border-line px-5 py-4 sm:px-6">{footer}</div>}
    </div>
  </div>, document.body);
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-2 text-sm font-medium"><span>{label}</span>{children}</label>;
}
