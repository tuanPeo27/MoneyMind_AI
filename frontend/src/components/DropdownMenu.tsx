import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';

/**
 * Shared action menu (profile menu, appearance menu, ...). One look and one behaviour everywhere:
 * - rendered into <body> and positioned against the trigger, so cards, sticky headers or transforms never clip it;
 * - flips above the trigger when there is no room below, and stays inside the viewport horizontally;
 * - closes on outside click, Escape, Tab, scroll and resize, and returns focus to the trigger;
 * - arrow keys / Home / End move between items, typing a letter jumps to the matching item.
 * Value pickers (one choice out of a list, inside forms and filters) use <Select> instead.
 */

type TriggerProps = {
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
};
type MenuContext = { close: (refocus?: boolean) => void };
const Ctx = createContext<MenuContext | null>(null);

export function DropdownMenu({ label, trigger, children, width = 260, align = 'end', className = '' }: {
  /** Accessible name of the menu. */
  label: string;
  /** Renders the button that opens the menu. Spread the given props onto it. */
  trigger: (props: TriggerProps) => ReactNode;
  children: ReactNode;
  width?: number;
  /** Which edge of the trigger the menu lines up with. */
  align?: 'start' | 'end';
  className?: string;
}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<{ top: number; left: number; width: number; maxHeight: number; transformOrigin: string }>();

  const focusTrigger = () => anchor.current?.querySelector<HTMLElement>('button, [href], [tabindex]')?.focus();
  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) requestAnimationFrame(focusTrigger);
  }, []);
  // Enabled, visible items only: an item can be hidden at some breakpoints (e.g. `md:hidden`).
  const items = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('[data-menu-item]:not([disabled])') ?? [])
    .filter(el => el.getClientRects().length > 0);

  function place() {
    const box = anchor.current?.getBoundingClientRect();
    if (!box) return;
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const w = Math.min(width, vw - 24);
    const below = vh - box.bottom, above = box.top;
    const up = below < 240 && above > below;
    const left = Math.max(12, Math.min(align === 'end' ? box.right - w : box.left, vw - w - 12));
    setStyle({
      top: up ? Math.max(12, box.top - 8) : box.bottom + 8, left, width: w,
      maxHeight: Math.max(160, (up ? above : below) - 20),
      transformOrigin: `${align === 'end' ? 'right' : 'left'} ${up ? 'bottom' : 'top'}`,
    });
  }

  // Opening upward: anchor the panel's bottom edge to the trigger once its height is known.
  useLayoutEffect(() => {
    if (!open || !panel.current || !style || style.transformOrigin.endsWith('top')) return;
    const box = anchor.current!.getBoundingClientRect();
    panel.current.style.top = `${Math.max(12, box.top - 8 - panel.current.offsetHeight)}px`;
  }, [open, style]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => (items().find(el => el.getAttribute('aria-checked') === 'true') ?? items()[0])?.focus());
    const outside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) close(false);
    };
    const scroll = (e: Event) => { if (!panel.current?.contains(e.target as Node)) close(false); };
    const resize = () => close(false);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', resize);
    };
  }, [open, close]);

  function toggle() { if (open) close(false); else { place(); setOpen(true); } }

  function onPanelKey(e: KeyboardEvent) {
    const list = items(), index = list.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => { e.preventDefault(); list[(next + list.length) % list.length]?.focus(); };
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close(false);
    else if (e.key === 'ArrowDown') move(index + 1);
    else if (e.key === 'ArrowUp') move(index - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(list.length - 1);
    else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const key = e.key.toLocaleLowerCase();
      const start = index + 1;
      const hit = [...list.slice(start), ...list.slice(0, start)].find(el => el.textContent?.trim().toLocaleLowerCase().startsWith(key));
      hit?.focus();
    }
  }

  const triggerProps: TriggerProps = {
    onClick: toggle,
    onKeyDown: e => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); place(); setOpen(true); } },
    'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': open ? id : undefined,
  };
  return <span ref={anchor} className={`relative inline-flex ${className}`}>
    {trigger(triggerProps)}
    {open && style && createPortal(<Ctx.Provider value={{ close }}>
      <div ref={panel} id={id} role="menu" aria-label={label} onKeyDown={onPanelKey} style={style}
        className="fixed z-[100] overflow-y-auto overscroll-contain glass-strong rounded-2xl p-1.5 text-sm text-ink [scrollbar-width:none] [&::-webkit-scrollbar]:hidden motion-safe:animate-[menu-in_160ms_cubic-bezier(0.22,1,0.36,1)]">
        {children}
      </div>
    </Ctx.Provider>, document.body)}
  </span>;
}

const itemClass = 'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-muted outline-none transition-colors hover:bg-line hover:text-ink focus-visible:bg-line focus-visible:text-ink disabled:pointer-events-none disabled:opacity-50';

/** A menu action. Closes the menu after `onSelect` unless `keepOpen` is set. */
export function MenuItem({ icon, children, onSelect, trailing, keepOpen = false, disabled, className = '' }: {
  icon?: ReactNode; children: ReactNode; onSelect: () => void; trailing?: ReactNode; keepOpen?: boolean; disabled?: boolean; className?: string;
}) {
  const menu = useContext(Ctx);
  return <button type="button" role="menuitem" data-menu-item tabIndex={-1} disabled={disabled} className={`${itemClass} ${className}`}
    onClick={() => { onSelect(); if (!keepOpen) menu?.close(); }}>
    {icon}<span className="min-w-0 flex-1 truncate">{children}</span>{trailing}
  </button>;
}

/** One option of a single-choice group inside a menu (e.g. Light / Dark / System). */
export function MenuRadioItem({ icon, children, checked, onSelect, className = '' }: {
  icon?: ReactNode; children: ReactNode; checked: boolean; onSelect: () => void; className?: string;
}) {
  const menu = useContext(Ctx);
  return <button type="button" role="menuitemradio" aria-checked={checked} data-menu-item tabIndex={-1}
    className={`${itemClass} ${checked ? '!text-brand' : ''} ${className}`} onClick={() => { onSelect(); menu?.close(); }}>
    {icon}<span className="min-w-0 flex-1 truncate">{children}</span>{checked && <Check aria-hidden="true" className="size-4 shrink-0 text-brand" />}
  </button>;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p role="presentation" className="px-3 pb-1.5 pt-2 text-xs font-medium text-muted">{children}</p>;
}
export function MenuSeparator() {
  return <div role="separator" className="my-1.5 border-t border-line" />;
}
/** Non-interactive block at the top of a menu (e.g. the signed-in user's name and email). */
export function MenuHeader({ children }: { children: ReactNode }) {
  return <div role="presentation" className="mb-1 border-b border-line px-3 pb-3 pt-2">{children}</div>;
}
