import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export type SelectOption = { value: string; label: string; icon?: ReactNode };
type SelectProps = {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
};

// A ixed popup is positioned against the nearest ancestor that has a transform/filter/backdrop-filter.
// Glass dialogs use backdrop-filter, so portal to <body> there; otherwise stay inside the dialog.
function popupHost(trigger: HTMLElement | null): HTMLElement {
  const dialog = trigger?.closest<HTMLElement>('[role="dialog"]');
  if (!dialog) return document.body;
  const style = getComputedStyle(dialog);
  const contains = [style.backdropFilter, style.filter, style.transform, style.perspective].some(v => v && v !== 'none');
  return contains ? document.body : dialog;
}
export function Select({ label, value, options, onChange, disabled, placeholder = '—', className = '' }: SelectProps) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', time: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 240 });
  const selected = options.find(option => option.value === value);
  function expand() {
    if (!trigger.current || disabled || !options.length) return;
    const rect = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    const above = rect.top;
    const upwards = below < 220 && above > below;
    const maxHeight = Math.min(248, options.length * 44 + 10, Math.max(80, (upwards ? above : below) - 16));
    const width = Math.min(Math.max(rect.width, 180), window.innerWidth - 24);
    setPosition({
      top: upwards ? rect.top - maxHeight - 6 : rect.bottom + 6,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      width, maxHeight,
    });
    setActive(Math.max(0, options.findIndex(option => option.value === value)));
    setOpen(true);
  }
  function choose(index: number) {
    if (!options[index]) return;
    onChange(options[index].value);
    setOpen(false);
    trigger.current?.focus();
  }
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) setOpen(false);
    };
    const scroll = (event: Event) => {
      if (!list.current?.contains(event.target as Node)) setOpen(false);
    };
    const resize = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', resize);
    };
  }, [open]);
  useEffect(() => {
    if (open) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);
  return <div className={`min-w-0 ${className}`}>
    <button
      ref={trigger} type="button" role="combobox" aria-label={label}
      aria-expanded={open} aria-haspopup="listbox" aria-controls={open ? id : undefined}
      aria-activedescendant={open ? `${id}-${active}` : undefined}
      disabled={disabled || !options.length}
      onClick={() => open ? setOpen(false) : expand()}
      onKeyDown={event => {
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
        if (event.key === 'Tab') { setOpen(false); return; }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
          event.preventDefault();
          if (!open) { expand(); return; }
          if (event.key === 'Enter' || event.key === ' ') choose(active);
          else if (event.key === 'Home') setActive(0);
          else if (event.key === 'End') setActive(options.length - 1);
          else setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
        } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          if (!open) expand();
          const now = Date.now();
          const text = (now - typed.current.time < 700 ? typed.current.text : '') + event.key.toLocaleLowerCase();
          typed.current = { text, time: now };
          const index = options.findIndex(option => option.label.toLocaleLowerCase().startsWith(text));
          if (index >= 0) setActive(index);
        }
      }}
      className={`flex min-h-11 w-full items-center gap-2.5 rounded-xl border bg-surface px-3 text-left text-sm text-ink outline-none transition-colors hover:border-muted/50 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20 disabled:cursor-not-allowed ${open ? 'border-brand ring-2 ring-brand/15' : 'border-line'}`}
    >
      {selected?.icon}
      <span className={`min-w-0 flex-1 truncate ${selected ? '' : 'text-muted'}`}>{selected?.label || placeholder}</span>
      <ChevronDown aria-hidden="true" strokeWidth={1.75} className={`size-4 shrink-0 text-muted transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && createPortal(<div ref={list} id={id} role="listbox" aria-label={label} style={position}
      className="fixed z-[100] overflow-y-auto overscroll-contain glass-strong rounded-xl p-1 text-ink [scrollbar-color:var(--color-line)_transparent] [scrollbar-width:thin] origin-top motion-safe:animate-[message-in_160ms_ease-out]">
      {options.map((option, index) => <div
        key={option.value} id={`${id}-${index}`} data-index={index}
        role="option" aria-selected={option.value === value}
        onPointerMove={() => setActive(index)}
        onPointerDown={event => event.preventDefault()}
        onClick={() => choose(index)}
        className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm ${index === active ? 'bg-brand/10' : ''} ${option.value === value ? 'font-medium text-brand' : 'text-ink'}`}
      >
        {option.icon}<span className="min-w-0 flex-1 truncate">{option.label}</span>
        {option.value === value && <Check aria-hidden="true" className="size-4 shrink-0 text-brand" />}
      </div>)}
    </div>, popupHost(trigger.current))}
  </div>;
}
