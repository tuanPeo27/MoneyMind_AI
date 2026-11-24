import { useState } from 'react';
import { ChartNoAxesCombined } from 'lucide-react';

/** App icon served from frontend/public (also used as the browser tab icon in index.html). */
export const LOGO_SRC = '/logo-96.png'; // 96 px covers the 32-40 px logo on 2-3x screens (logo.png is the 500 px source)

/**
 * MoneyMind logo mark. Shows /logo.png; if the file is missing or fails to load it falls back to the previous
 * chart icon on the brand colour, so the layout never shows a broken image.
 */
export function BrandLogo({ className = 'size-8', rounded = 'rounded-lg' }: { className?: string; rounded?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span aria-hidden="true" className={`flex shrink-0 items-center justify-center bg-gradient-to-br from-accent to-accent-2 text-on-accent ${rounded} ${className}`}>
      <ChartNoAxesCombined className="size-[60%]" />
    </span>;
  }
  return <img src={LOGO_SRC} alt="" aria-hidden="true" draggable={false} width={96} height={96} decoding="async" onError={() => setFailed(true)}
    className={`shrink-0 object-cover ${rounded} ${className}`} />;
}
