import { useId } from 'react';
import type { Theme } from '../hooks/useTheme';

/**
 * Appearance icons with their own colour and motion:
 * sun (amber, rotating rays), moon (violet, gentle sway + twinkling stars), system (sky-blue screen split between day and night).
 * Hover animations are driven by a parent with the `theme-btn` class (see index.css).
 */
export function ThemeIcon({ value, className = 'size-[18px]' }: { value: Theme; className?: string }) {
  const id = useId();
  return <span key={value} aria-hidden="true" className="theme-pop inline-flex">
    {value === 'light' && <svg viewBox="0 0 24 24" className={`${className} theme-sun`} fill="none">
      <g className="theme-sun-rays" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round">
        {[0, 45, 90, 135, 180, 225, 270, 315].map(angle => <line key={angle} x1="12" y1="1.8" x2="12" y2="4.2" transform={`rotate(${angle} 12 12)`} />)}
      </g>
      <circle className="theme-sun-core" cx="12" cy="12" r="4.6" fill="#FBBF24" stroke="#F59E0B" strokeWidth="1.5" />
    </svg>}
    {value === 'dark' && <svg viewBox="0 0 24 24" className={`${className} theme-moon`} fill="none">
      <defs><linearGradient id={`${id}-m`} x1="4" y1="3" x2="20" y2="21"><stop stopColor="#C4B5FD" /><stop offset="1" stopColor="#7C3AED" /></linearGradient></defs>
      <path className="theme-moon-body" d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" fill={`url(#${id}-m)`} stroke="#A78BFA" strokeWidth="1.3" strokeLinejoin="round" />
      <path className="theme-star theme-star-a" d="M18.5 2.2l.55 1.45 1.45.55-1.45.55-.55 1.45-.55-1.45-1.45-.55 1.45-.55z" fill="#FDE68A" />
      <path className="theme-star theme-star-b" d="M22 8.4l.35.9.9.35-.9.35-.35.9-.35-.9-.9-.35.9-.35z" fill="#FDE68A" />
    </svg>}
    {value === 'system' && <svg viewBox="0 0 24 24" className={`${className} theme-system`} fill="none">
      <defs>
        <linearGradient id={`${id}-s`} x1="3" y1="4" x2="21" y2="16"><stop stopColor="#FBBF24" /><stop offset="0.5" stopColor="#F472B6" /><stop offset="1" stopColor="#7C3AED" /></linearGradient>
        <clipPath id={`${id}-c`}><rect x="4.2" y="5.2" width="15.6" height="9.6" rx="1.2" /></clipPath>
      </defs>
      <rect x="3" y="4" width="18" height="12" rx="2.2" stroke="#38BDF8" strokeWidth="1.8" />
      <g clipPath={`url(#${id}-c)`}>
        <rect x="4.2" y="5.2" width="15.6" height="9.6" fill={`url(#${id}-s)`} opacity="0.85" />
        <rect className="theme-sheen" x="-8" y="4" width="6" height="12" fill="#fff" opacity="0.5" transform="skewX(-20)" />
      </g>
      <path d="M8.5 20h7M12 16.2V20" stroke="#38BDF8" strokeWidth="1.8" strokeLinecap="round" />
    </svg>}
  </span>;
}
