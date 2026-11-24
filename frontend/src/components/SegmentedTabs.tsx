import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

type Option<T extends string> = { value: T; label: string };

/**
 * A segmented tab bar whose highlight slides to the selected tab. The pill is measured from the selected button,
 * so it follows label widths in any language and re-measures when the bar resizes. Arrow keys, Home and End move
 * the selection (roving tabindex). Under prefers-reduced-motion the pill jumps instead of sliding.
 */
export function SegmentedTabs<T extends string>({ label, value, options, onChange, className = '' }: {
  label: string; value: T; options: Option<T>[]; onChange: (value: T) => void; className?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  // No slide on the first measurement: the pill appears in place, then animates on later changes.
  const [animate, setAnimate] = useState(false);
  const index = Math.max(0, options.findIndex(o => o.value === value));

  useLayoutEffect(() => {
    const measure = () => {
      const tab = tabs.current[index];
      if (tab) setPill({ left: tab.offsetLeft, width: tab.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (list.current) observer.observe(list.current);
    return () => observer.disconnect();
  }, [index, options.length]);
  useLayoutEffect(() => {
    if (!pill || animate) return;
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, [pill, animate]);

  function onKeyDown(event: KeyboardEvent) {
    const last = options.length - 1;
    const next = event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? last : -1;
    if (next < 0) return;
    event.preventDefault();
    onChange(options[next].value);
    tabs.current[next]?.focus();
  }

  return <div ref={list} role="tablist" aria-label={label} onKeyDown={onKeyDown}
    className={`relative isolate flex rounded-lg border border-line bg-surface p-1 ${className}`}>
    {pill && <span aria-hidden="true" style={{ width: pill.width, transform: `translateX(${pill.left - 4}px)` }}
      className={`pointer-events-none absolute inset-y-1 left-1 -z-10 rounded-md bg-line shadow-sm motion-reduce:transition-none ${animate ? 'transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]' : ''}`} />}
    {options.map((option, i) => <button key={option.value} ref={el => { tabs.current[i] = el; }} type="button"
      role="tab" aria-selected={i === index} tabIndex={i === index ? 0 : -1} onClick={() => onChange(option.value)}
      className={`min-h-11 rounded-md px-5 text-sm transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${i === index ? 'text-ink' : 'text-muted hover:text-ink'}`}>
      {option.label}
    </button>)}
  </div>;
}
