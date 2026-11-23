import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react';
import { AlertCircle } from 'lucide-react';
import { useLanguage } from '../i18n';
import { fieldClass } from './ui';
import { fractionDigits, fromDisplay, toDisplay, type Currency } from '../lib/currency';

const MAX_INTEGER_DIGITS = 12;

/** Separators of the display currency: VND groups with "." and has no decimals; USD groups with "," and uses ".". */
const separators = (c: Currency) => c === 'USD' ? { group: ',', decimal: '.' } : { group: '.', decimal: null };

/** Keeps digits (and one decimal point for USD, at most 2 decimals) and regroups every three digits. */
function normalize(raw: string, currency: Currency) {
  const { group, decimal } = separators(currency);
  let int = '', frac: string | null = null;
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') {
      if (frac === null) { if (int.length < MAX_INTEGER_DIGITS) int += ch; }
      else if (frac.length < fractionDigits()) frac += ch;
    } else if (decimal && ch === decimal && frac === null) frac = '';
  }
  int = int.replace(/^0+(?=\d)/, '');
  if (!int && frac !== null) int = '0';
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return { text: frac === null ? grouped : `${grouped}${decimal}${frac}`, number: int ? Number(`${int}.${frac || 0}`) : null };
}
/** Characters that are never allowed (anything that is not a digit, a separator or a space). */
const hasInvalid = (raw: string) => /[^\d.,\s]/.test(raw);
/** Count of digits and decimal points before `index`: used to put the caret back after regrouping. */
const significantBefore = (text: string, index: number, decimal: string | null) =>
  [...text.slice(0, index)].filter(ch => (ch >= '0' && ch <= '9') || ch === decimal).length;

/**
 * Money input in the display currency. Shows grouped digits (100.000.000 / 3,846.15), has no spinner,
 * refuses letters (including "e") with an inline message, and submits the value **in VND** through a hidden
 * input named `name`, so forms keep reading `Number(data.get(name))` as before.
 */
export function AmountInput({ name, defaultValue, required, minVnd = 1, placeholder, className = '', autoFocus }: {
  name: string; defaultValue?: number; required?: boolean; minVnd?: number; placeholder?: string; className?: string; autoFocus?: boolean;
}) {
  const { t, currency } = useLanguage();
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const display = (value: number | null | undefined) => value ? normalize(toDisplay(value).toFixed(fractionDigits()), currency).text : '';
  const [text, setText] = useState(() => display(defaultValue));
  // Unchanged values submit the original VND exactly (no USD round-trip drift).
  const [vnd, setVnd] = useState<number | null>(defaultValue ?? null);
  const [warning, setWarning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  // Language switched while the form is open: show the same VND amount in the new currency.
  const shown = useRef(currency);
  useEffect(() => {
    if (shown.current === currency) return;
    shown.current = currency;
    setText(display(vnd));
  }, [currency, vnd]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (caret.current === null || !input.current) return;
    input.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [text]);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Native validation message for empty / too small amounts (the visible input is a text field).
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.setCustomValidity(vnd !== null && vnd < minVnd ? t('Enter an amount greater than 0.') : '');
  }, [vnd, minVnd, t]);

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value, pos = e.target.selectionStart ?? raw.length;
    if (hasInvalid(raw)) {
      setWarning(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setWarning(false), 3000);
    }
    const { decimal } = separators(currency);
    const next = normalize(raw, currency);
    // Put the caret after the same number of digits it was after before regrouping.
    const keep = significantBefore(raw, pos, decimal);
    let index = 0, seen = 0;
    while (index < next.text.length && seen < keep) {
      const ch = next.text[index];
      if ((ch >= '0' && ch <= '9') || ch === decimal) seen++;
      index++;
    }
    caret.current = index;
    setText(next.text);
    setVnd(next.number === null ? null : fromDisplay(next.number));
  }

  return <div>
    <span className="relative block">
      <input ref={input} type="text" inputMode={currency === 'USD' ? 'decimal' : 'numeric'} autoComplete="off" required={required} autoFocus={autoFocus}
        value={text} onChange={onChange} placeholder={placeholder ?? (currency === 'USD' ? '0.00' : '0')}
        aria-invalid={warning || undefined} aria-describedby={warning ? `${name}-amount-warning` : undefined}
        className={`${fieldClass} pr-14 tabular-nums ${warning ? '!border-negative' : ''} ${className}`} />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-muted">{currency}</span>
    </span>
    <input type="hidden" name={name} value={vnd ?? ''} />
    {warning && <p id={`${name}-amount-warning`} role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs text-negative">
      <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />{t('Only numbers can be entered here.')}
    </p>}
  </div>;
}
