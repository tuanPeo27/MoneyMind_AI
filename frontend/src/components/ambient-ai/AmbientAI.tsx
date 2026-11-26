import { useLanguage } from '../../i18n';
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { m, useReducedMotion } from 'framer-motion';
import { Sparkles, ArrowUpRight } from 'lucide-react';
import { useAmbientAI, useAmbientAIView } from './AmbientAIProvider';
import { type Highlight } from './mockAssistant';
import { LiquidButton } from '../LiquidButton';
import { preloadAiIntro } from './aiIntro';

/** Android-style spring shared by every container transform. */
export const MORPH_SPRING = { type: 'spring', stiffness: 280, damping: 28 } as const;
/** While a surface is open the page behind shrinks slightly (see `html[data-depth] main` in index.css). */
export function useDepthBackdrop(active: boolean) {
  useEffect(() => {
    if (!active) return;
    document.documentElement.dataset.depth = '1';
    return () => { delete document.documentElement.dataset.depth; };
  }, [active]);
}
export function AmbientShell({ children }: { children: ReactNode }) {
  const { open } = useAmbientAI();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.inert = open;
  }, [open]);
  useDepthBackdrop(open);
  return <div ref={ref} aria-hidden={open || undefined} className="min-h-screen">{children}</div>;
}/** Floating button in the bottom-right corner (`data-ai-trigger`). The AI page grows out of its shape and shrinks back into it. */
/** Fired by the overlay once its closing animation has fully finished (it has become the button again). */
export const AI_CLOSED_EVENT = 'mm-ai-closed';
export function AmbientAIFab() {
  const { t } = useLanguage();
  const { open, openAssistant } = useAmbientAI();
  const reduce = useReducedMotion();
  // Warm up on intent: the AI page chunk and GSAP for its intro start downloading before the click.
  const warmUp = () => { preloadAIPage(); preloadAiIntro().catch(() => undefined); };
  // The button and the AI page are one object and never on screen together: the button disappears the instant the
  // page starts opening and only comes back when the closing page has shrunk all the way into it.
  const [hidden, setHidden] = useState(open);
  useEffect(() => {
    if (open) { setHidden(true); return; }
    const show = () => setHidden(false);
    window.addEventListener(AI_CLOSED_EVENT, show);
    return () => window.removeEventListener(AI_CLOSED_EVENT, show);
  }, [open]);
  return <div aria-hidden={hidden || undefined} className={`group/fab fixed bottom-24 right-4 z-30 hover:-translate-y-1 md:bottom-6 md:right-6 ${hidden ? 'pointer-events-none invisible' : 'transition-[translate] duration-300 ease-out'}`}>
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full transition-opacity duration-300 group-hover/fab:opacity-0 group-focus-within/fab:opacity-0 motion-safe:animate-[fab-ring_2.8s_ease-out_infinite]" />
    <m.button style={{ borderRadius: 28 }} transition={reduce ? { duration: 0 } : MORPH_SPRING}
      data-ai-trigger tabIndex={hidden ? -1 : 0} onPointerEnter={warmUp} onFocus={warmUp} onClick={() => openAssistant()} aria-label={t('Ask MoneyMind AI')} title={`${t('Ask MoneyMind AI')} (${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'} K)`}
      className="relative grid h-14 grid-cols-[auto_0fr] items-center bg-gradient-to-br from-ai-from via-ai-to to-ai-warm px-4 text-on-ai shadow-[0_0_30px_-4px_color-mix(in_oklab,var(--color-ai-from)_70%,transparent)] transition-[grid-template-columns,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/fab:grid-cols-[auto_1fr] group-hover/fab:shadow-[0_0_38px_-2px_color-mix(in_oklab,var(--color-ai-to)_70%,transparent)] focus-visible:grid-cols-[auto_1fr] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ai focus-visible:ring-offset-2 focus-visible:ring-offset-transparent active:scale-95">
      <Sparkles className="h-6 w-6 shrink-0 transition-transform duration-500 group-hover/fab:rotate-12 group-hover/fab:scale-110" aria-hidden="true" />
      <span className="min-w-0 overflow-hidden"><span className="block whitespace-nowrap pl-3 pr-1 text-sm font-semibold opacity-0 transition-opacity duration-300 group-hover/fab:opacity-100 group-focus-within/fab:opacity-100">{t('Ask MoneyMind AI')}</span></span>
    </m.button>
  </div>;
}const loadAIPage = () => import('./AmbientAIPage');
// Opened straight from a /assistant link: the AI page is the first screen, so fetch it alongside the main bundle
// instead of after the app has rendered.
if (window.location.pathname === '/assistant') void loadAIPage();
const AIPage = lazy(() => loadAIPage().then(module => ({ default: module.AmbientAIPage })));
/** Starts downloading the AI page (once). Called on hover / focus of the AI button and when the app is idle. */
export function preloadAIPage() { void loadAIPage(); }
/**
 * Mounts the AI page from its first opening on (then it stays mounted, so its closing animation and the
 * AnimatePresence inside it keep working). Until then nothing of the chat UI is downloaded or rendered.
 */
export function AmbientAIOverlay() {
  const { open } = useAmbientAI();
  const [mounted, setMounted] = useState(open);
  useEffect(() => { if (open) setMounted(true); }, [open]);
  return mounted ? <Suspense fallback={null}><AIPage /></Suspense> : null;
}
export function HighlightCard({ target, children, onInspect }: { target: Highlight; children: ReactNode; onInspect: () => void }) {
  const { t } = useLanguage();
  const { highlight } = useAmbientAIView();
  const active = highlight === target;
  // The outline sits 10px outside the content (outline-offset does not change layout), so rows and amounts keep
  // their spacing; the badge is centred on the outline's top edge instead of covering the first row.
  return <div id={`ai-${target}`} className={`relative h-full min-w-0 rounded-xl outline-offset-[10px] transition-[outline-color,filter] duration-500 motion-reduce:transition-none ${active ? 'z-10 outline outline-1 outline-ai-from/75 brightness-110' : 'outline-transparent'}`}>
    {active && <button onClick={onInspect} className="absolute right-4 top-0 z-20 flex h-8 -translate-y-[calc(50%+10px)] items-center gap-1.5 rounded-lg bg-gradient-to-br from-ai-from via-ai-to to-ai-warm text-on-ai px-3 text-xs font-semibold shadow-md shadow-ai-from/30 focus-visible:ring-2 focus-visible:ring-ai-from focus-visible:ring-offset-2"><Sparkles className="h-3.5 w-3.5" />{t("AI Insight")}<ArrowUpRight className="h-3.5 w-3.5" /></button>}
    {children}
  </div>;
}
export function AssistantHome() {
  const { t } = useLanguage();
  const { openAssistant, messages, prompts } = useAmbientAI();
  return <div className="flex min-h-[500px] flex-col items-center justify-center glass rounded-3xl px-6 py-12 text-center"><Sparkles className="mb-5 h-9 w-9 text-ai" /><h2 className="text-2xl font-medium tracking-tight">{t("A little clarity, wherever you are.")}</h2><p className="mt-3 max-w-md text-sm leading-6 text-muted">{t("Your assistant now lives across your workspace. Explore your finances without leaving what you’re doing.")}</p><div className="my-8"><LiquidButton onClick={() => openAssistant()} label={messages.length ? t("Continue conversation") : t("Ask AI Assistant")} /></div><div className="flex flex-wrap justify-center gap-2">{prompts.slice(0, 3).map(p => <button key={p} onClick={() => openAssistant(p)} className="glass min-h-11 rounded-xl px-3 text-sm text-muted transition-colors hover:text-ink">{p}</button>)}</div><p className="mt-6 text-xs text-muted">{t("Ctrl / ⌘ K from anywhere · Local simulation, not a live AI service")}</p></div>;
}
