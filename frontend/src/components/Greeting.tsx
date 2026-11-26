import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n';

/** Translation keys (English source text) for each part of the day. */
const PARTS = ['Good morning,', 'Good midday,', 'Good afternoon,', 'Good evening,'] as const;
type Part = typeof PARTS[number];

/** Hour (0-23) now in `timeZone`; the device's own zone when it is missing or invalid. */
function hourIn(timeZone?: string): number {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date()));
  } catch {
    return new Date().getHours();
  }
}
/** Morning 04:00–10:59, midday 11:00–12:59, afternoon 13:00–17:59, evening 18:00–03:59. */
export function partOfDay(hour: number): Part {
  if (hour >= 4 && hour < 11) return 'Good morning,';
  if (hour >= 11 && hour < 13) return 'Good midday,';
  if (hour >= 13 && hour < 18) return 'Good afternoon,';
  return 'Good evening,';
}
/** The name to greet: the last word of the full name ("HLA Tuấn" -> "Tuấn"). */
export function greetingName(fullName: string): string {
  return fullName.trim().split(/\s+/).filter(Boolean).pop() ?? '';
}

/**
 * "Chào buổi sáng, Tuấn." on the Overview header. Re-checks the time every minute and when the tab becomes visible
 * again (after sleep), so the greeting changes on its own at 11:00, 13:00, 18:00 and 04:00. Only this component
 * re-renders on the timer, not the page around it.
 */
export function Greeting({ fullName, timeZone }: { fullName: string; timeZone?: string }) {
  const { t } = useLanguage();
  const [part, setPart] = useState(() => partOfDay(hourIn(timeZone)));
  useEffect(() => {
    const update = () => setPart(partOfDay(hourIn(timeZone)));
    update();
    const timer = window.setInterval(update, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') update(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [timeZone]);
  const name = greetingName(fullName);
  // Without a name the comma goes: "Chào buổi sáng."
  return <>{name ? `${t(part)} ${name}` : t(part).replace(/,$/, '')}<span className="ml-1 text-muted">.</span></>;
}
