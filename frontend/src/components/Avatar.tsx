import { useEffect, useMemo, useState } from 'react';

export function initialsOf(name: string) {
  return name.split(' ').filter(Boolean).slice(-2).map(part => part[0]).join('').toUpperCase();
}

// Palettes that fit the app's violet / pink look, in light and dark mode alike.
const PALETTES = [
  ['#8B5CF6', '#F9A8D4', '#1E1B4B'], ['#EC4899', '#FDE68A', '#3B0764'], ['#6366F1', '#A7F3D0', '#1E1B4B'],
  ['#14B8A6', '#FBCFE8', '#134E4A'], ['#F97316', '#DDD6FE', '#431407'], ['#0EA5E9', '#FBCFE8', '#0C4A6E'],
  ['#A855F7', '#BAE6FD', '#2E1065'], ['#F43F5E', '#C7D2FE', '#4C0519'],
];

/** FNV-1a: a small, stable string hash so the same account always gets the same avatar. */
function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * Demo avatar drawn locally as an SVG: a friendly face whose colours, rotation, eyes and mouth are derived
 * from `seed` (the account email). Nothing is sent to a third-party service.
 */
export function demoAvatar(seed: string) {
  const h = hash(seed || 'moneymind');
  const pick = (shift: number, n: number) => (h >>> shift) % n;
  const [bg, face, ink] = PALETTES[pick(0, PALETTES.length)];
  const rotate = pick(4, 40) - 20;
  const dx = pick(9, 11) - 5, dy = pick(13, 9) - 4;
  const round = [18, 26, 40][pick(17, 3)];
  const eye = pick(19, 3), mouth = pick(21, 4);
  const eyes = eye === 0
    ? `<circle cx="38" cy="44" r="4"/><circle cx="62" cy="44" r="4"/>`
    : eye === 1
      ? `<rect x="33" y="42" width="10" height="4" rx="2"/><rect x="57" y="42" width="10" height="4" rx="2"/>`
      : `<path d="M33 46q5-6 10 0M57 46q5-6 10 0" fill="none" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>`;
  const mouths = [
    `<path d="M40 60q10 9 20 0" fill="none" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>`,
    `<path d="M41 59h18q-2 9-9 9t-9-9z"/>`,
    `<rect x="44" y="60" width="12" height="4" rx="2"/>`,
    `<circle cx="50" cy="62" r="4.5"/>`,
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${bg}"/>`
    + `<g transform="translate(${dx} ${dy}) rotate(${rotate} 50 50)"><rect x="18" y="18" width="64" height="64" rx="${round}" fill="${face}"/>`
    + `<g fill="${ink}">${eyes}${mouths[mouth]}</g></g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Round avatar: the account's photo when there is one, otherwise a demo avatar generated from `seed`
 * (defaults to the name). A photo that fails to load (expired link, offline) also falls back to the demo avatar.
 */
export function Avatar({ name, src, seed, className = 'size-9 text-xs' }: { name: string; src?: string; seed?: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  const fallback = useMemo(() => demoAvatar(seed || name), [seed, name]);
  return <span aria-hidden="true" title={initialsOf(name) || undefined} className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-line font-semibold text-white ${className}`}>
    <img src={src && !broken ? src : fallback} alt="" onError={() => setBroken(true)} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
  </span>;
}
