import { useLanguage } from '../../i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Sparkles, ArrowUp, ArrowUpRight, ArrowLeft, Plus, ShieldCheck, ChevronRight, History, Trash2 } from 'lucide-react';
import { useAmbientAI, type AIMessageData } from './AmbientAIProvider';
import { type Highlight } from './mockAssistant';
import { Button, IconButton, Modal } from '../ui';
import { LiquidButton } from '../LiquidButton';

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
}export function AIInput({ onSubmit, busy = false, initial = '', className = '' }: { onSubmit: (text: string) => void; busy?: boolean; initial?: string; className?: string }) {
  const { t } = useLanguage();
  const [input, setInput] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return <form onSubmit={e => { e.preventDefault(); if (input.trim() && !busy) { onSubmit(input); setInput(''); } }} className={`glass-strong flex items-center gap-3 rounded-2xl !border-[#8B5CF6]/30 px-4 py-2 transition-[box-shadow,border-color] duration-300 focus-within:!border-[#8B5CF6]/70 focus-within:ring-4 focus-within:ring-[#8B5CF6]/15 ${className}`}>
    <Sparkles className="h-5 w-5 shrink-0 text-ai" aria-hidden="true" />
    <input ref={ref} aria-label={t("Ask your financial assistant")} value={input} onChange={e => setInput(e.target.value)} maxLength={1500} placeholder={t("Ask anything about your money...")} className="min-h-12 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted" />
    <button type="submit" disabled={!input.trim() || busy} aria-label={t("Send message")} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#EC4899] text-white shadow-md shadow-[#8B5CF6]/35 transition-[scale,filter,background-color] duration-300 hover:brightness-110 active:scale-90 focus-visible:ring-2 focus-visible:ring-ai disabled:cursor-not-allowed disabled:bg-ink/10 disabled:bg-none disabled:text-ink/60 disabled:shadow-none"><ArrowUp className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" /></button>
  </form>;
}
function PromptChips({ limit = 4 }: { limit?: number }) {
  const { prompts, send, busy } = useAmbientAI();
  return <div className="flex flex-wrap justify-center gap-2">{prompts.slice(0, limit).map(prompt => <button key={prompt} onClick={() => send(prompt)} disabled={busy} className="flex min-h-11 items-center gap-2 glass rounded-xl px-3.5 py-2 text-left text-sm text-muted transition-[translate,box-shadow,color] duration-300 hover:-translate-y-0.5 hover:text-ink hover:shadow-[0_8px_30px_-12px_#8B5CF6] focus-visible:ring-2 focus-visible:ring-ai disabled:cursor-not-allowed motion-reduce:transform-none">{prompt}<ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /></button>)}</div>;
}
/** Floating button in the bottom-right corner (`data-ai-trigger`). The AI page grows out of its shape and shrinks back into it. */
/** Fired by the overlay once its closing animation has fully finished (it has become the button again). */
const AI_CLOSED_EVENT = 'mm-ai-closed';
export function AmbientAIFab() {
  const { t } = useLanguage();
  const { open, openAssistant } = useAmbientAI();
  const reduce = useReducedMotion();
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
    <motion.button style={{ borderRadius: 28 }} transition={reduce ? { duration: 0 } : MORPH_SPRING}
      data-ai-trigger tabIndex={hidden ? -1 : 0} onClick={() => openAssistant()} aria-label={t('Ask AI Assistant')} title={`${t('Ask AI Assistant')} (${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'} K)`}
      className="relative grid h-14 grid-cols-[auto_0fr] items-center bg-gradient-to-br from-[#8B5CF6] to-[#EC4899] px-4 text-white shadow-[0_0_30px_-4px_rgba(139,92,246,0.7)] transition-[grid-template-columns,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/fab:grid-cols-[auto_1fr] group-hover/fab:shadow-[0_0_38px_-2px_rgba(236,72,153,0.7)] focus-visible:grid-cols-[auto_1fr] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ai focus-visible:ring-offset-2 focus-visible:ring-offset-transparent active:scale-95">
      <Sparkles className="h-6 w-6 shrink-0 transition-transform duration-500 group-hover/fab:rotate-12 group-hover/fab:scale-110" aria-hidden="true" />
      <span className="min-w-0 overflow-hidden"><span className="block whitespace-nowrap pl-3 pr-1 text-sm font-semibold opacity-0 transition-opacity duration-300 group-hover/fab:opacity-100 group-focus-within/fab:opacity-100">{t('Ask AI Assistant')}</span></span>
    </motion.button>
  </div>;
}export function AIMessage({ message }: { message: AIMessageData }) {
  const { t } = useLanguage();
  const { inspect } = useAmbientAI();
  return <article className={`motion-safe:animate-[message-in_250ms_ease-out] ${message.role === 'user' ? 'ml-auto max-w-[90%] glass rounded-2xl px-4 py-3' : 'space-y-3 py-3'}`}>
    <div className="flex items-center gap-2 text-xs text-muted">{message.role === 'assistant' && <Sparkles className="h-3.5 w-3.5 shrink-0 text-ai" aria-hidden="true" />}<span>{message.role === 'user' ? t("You") : 'MoneyMind · Gemini'}</span><span className="ml-auto">{message.time}</span></div>
    <p className="break-words text-sm leading-7 text-ink">{message.text}</p>
    {message.metrics && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{message.metrics.map(metric => <div key={metric.label} className="glass rounded-xl px-4 py-3"><p className="text-xs text-muted">{metric.label}</p><p className="mt-1 text-[1rem] font-semibold tabular-nums">{metric.value}</p></div>)}</div>}
    {message.role === 'assistant' && message.highlight && <button onClick={() => inspect(message.highlight!)} className="flex min-h-11 items-center gap-2 text-sm font-medium text-ai hover:text-ink focus-visible:ring-2 focus-visible:ring-ai">{t("Show me in my dashboard")}<ArrowUpRight className="h-4 w-4 shrink-0" /></button>}
    {message.role === 'assistant' && message.context && <p className="text-xs text-muted">{t(message.context)}</p>}
  </article>;
}
export function EdgeGlow() {
  return <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
    <div className="absolute -left-[12%] -top-[18%] h-[62vmax] w-[62vmax] rounded-full bg-[#a78bfa]/40 blur-[110px] motion-safe:animate-[ai-aurora-a_16s_ease-in-out_infinite] dark:bg-[#8b5cf6]/30" />
    <div className="absolute -bottom-[22%] -right-[10%] h-[56vmax] w-[56vmax] rounded-full bg-[#f9a8d4]/45 blur-[110px] motion-safe:animate-[ai-aurora-b_19s_ease-in-out_infinite] dark:bg-[#ec4899]/22" />
    <div className="absolute left-1/2 top-1/3 h-[34vmax] w-[34vmax] -translate-x-1/2 rounded-full bg-white/50 blur-[120px] dark:bg-[#6366f1]/15" />
  </div>;
}/** The AI page grows with the window: 1x at 1280x760, up to 1.5x on large displays. */
function useViewportZoom() {
  const calc = () => Math.round(Math.min(1.5, Math.max(1, Math.min(window.innerWidth / 1280, window.innerHeight / 760))) * 100) / 100;
  const [zoom, setZoom] = useState(calc);
  useEffect(() => { const update = () => setZoom(calc()); window.addEventListener('resize', update); return () => window.removeEventListener('resize', update); }, []);
  return zoom;
}
export function AmbientAIOverlay() {
  const { t } = useLanguage();
  const { open, closeAssistant, financial, messages, conversations, conversationId, historyBusy, selectConversation, removeConversation, busy, clear, storageError, send } = useAmbientAI();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const zoom = useViewportZoom();
  // `custom` reaches the exiting surface at the moment of closing, so it shrinks into where the button is now
  // (at rest), not where it was when the assistant opened (possibly lifted by hover or pressed in).
  return <AnimatePresence custom={open ? undefined : aiButtonShape(true)} onExitComplete={() => window.dispatchEvent(new Event(AI_CLOSED_EVENT))}>{open && <FocusedAssistant key="ai" onClose={closeAssistant}>
    <EdgeGlow />
    <div style={{ zoom, height: `calc(100dvh / ${zoom})` }} className={`relative z-10 mx-auto flex w-full max-w-[780px] flex-col px-5 pb-5 pt-5 sm:px-8 sm:py-8`}>
      <div className="ai-rise mb-5 flex shrink-0 items-center justify-between gap-3"><span className="flex items-center gap-2 text-sm font-medium"><IconButton icon={ArrowLeft} label={t("Back")} onClick={closeAssistant} /><kbd className="-ml-1 mr-1 hidden rounded-md border border-line px-1.5 py-0.5 font-sans text-[11px] font-normal text-muted sm:block">esc</kbd><Sparkles className="h-4 w-4 text-ai" />MoneyMind<span className="text-muted">/</span><span className="text-muted">{t("AI Assistant")}</span></span><div className="flex items-center gap-2"><IconButton icon={History} label={t("Chat history")} onClick={() => setHistoryOpen(value => !value)} disabled={busy} /><IconButton icon={Plus} label={t("Start a new conversation")} onClick={() => { clear(); setHistoryOpen(false); }} disabled={busy} /></div></div>
      {historyOpen && <div className="mb-4 max-h-60 shrink-0 overflow-y-auto rounded-2xl border border-line bg-surface/80 p-2 backdrop-blur-xl">
        <div className="flex items-center justify-between px-2 py-2"><p className="text-sm font-semibold">{t('Chat history')}</p><span className="text-xs text-muted">{conversations.length}</span></div>
        {!conversations.length ? <p className="px-2 py-4 text-sm text-muted">{t('No saved conversations yet.')}</p> : <div className="space-y-1">{conversations.map(item => <div key={item.id} className={`flex items-center gap-2 rounded-xl ${item.id === conversationId ? 'bg-brand/15' : 'hover:bg-base/60'}`}>
          <button type="button" disabled={historyBusy} onClick={() => void selectConversation(item.id).then(() => setHistoryOpen(false))} className="min-w-0 flex-1 px-3 py-3 text-left text-sm focus-visible:ring-2 focus-visible:ring-ai"><span className="block truncate font-medium">{item.title}</span></button>
          <button type="button" disabled={historyBusy} aria-label={t('Delete conversation')} onClick={() => setPendingDelete({ id: item.id, title: item.title })} className="mr-2 flex size-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-negative/10 hover:text-negative focus-visible:ring-2 focus-visible:ring-negative"><Trash2 className="size-4" /></button>
        </div>)}</div>}
      </div>}
      <div style={{ animationDelay: '70ms' }} className="ai-rise mb-4 flex shrink-0 flex-wrap items-center justify-center gap-2 text-xs text-muted"><span className="h-1.5 w-1.5 rounded-full bg-positive" />{t(financial.page)}<ChevronRight className="h-3 w-3" /><span>{t(financial.period)}</span>{financial.selection?.transaction && <span>· {financial.selection.transaction.description}</span>}</div>
      {!messages.length ? <div className="flex min-h-0 flex-1 flex-col justify-center"><div style={{ animationDelay: '140ms' }} className="ai-rise mb-8 text-center"><div className="glass mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl !border-[#8B5CF6]/30 bg-gradient-to-br from-[#8B5CF6]/20 to-[#EC4899]/15"><Sparkles className="h-7 w-7 text-ai" /></div><p className="mb-3 text-xs font-medium tracking-[0.16em] text-ai">{t("A LITTLE CLARITY GOES A LONG WAY")}</p><h2 id="ambient-title" className="text-[26px] font-medium leading-tight tracking-[-0.04em] sm:text-[32px]">{t("How can I help with")}<br className="hidden sm:block" />{' ' + t("your finances today?")}</h2><p className="mt-4 text-sm text-muted">{t("Your numbers. Your context. A clearer perspective.")}</p></div><div style={{ animationDelay: '260ms' }} className="ai-rise mb-5"><AIInput onSubmit={send} busy={busy} /></div><div style={{ animationDelay: '380ms' }} className="ai-rise"><PromptChips /></div></div> : <><h2 id="ambient-title" className="sr-only">{t("Your financial conversation")}</h2><Conversation /><div className="shrink-0 space-y-3 pt-4"><PromptChips limit={2} /><AIInput onSubmit={send} busy={busy} /></div></>}
      <p style={{ animationDelay: '480ms' }} className="ai-rise mt-5 flex shrink-0 items-center justify-center gap-2 text-center text-xs leading-5 text-muted"><ShieldCheck className="h-3.5 w-3.5 shrink-0" />{storageError ? t("Storage unavailable · Conversation lasts until refresh.") : t("Gemini AI · Encrypted chat history · Not financial advice")}</p>
      {pendingDelete && <Modal title={t('Delete this conversation?')} onClose={() => !deleting && setPendingDelete(null)}>
        <p className="text-sm leading-6 text-muted">{t('“{title}” and all of its messages will be deleted permanently. This cannot be undone.', { title: pendingDelete.title })}</p>
        <div className="mt-6 flex justify-end gap-3">
          <Button secondary disabled={deleting} onClick={() => setPendingDelete(null)}>{t('Cancel')}</Button>
          <Button className="!bg-negative !text-on-negative" disabled={deleting} onClick={() => {
            setDeleting(true);
            void removeConversation(pendingDelete.id).finally(() => { setDeleting(false); setPendingDelete(null); });
          }}>{t('Delete')}</Button>
        </div>
      </Modal>}
    </div>
  </FocusedAssistant>}</AnimatePresence>;
}
/**
 * `clip-path` matching the floating AI button: its box with fully rounded ends (circle, or pill when expanded).
 * The size comes from offsetWidth/offsetHeight, which ignore the `active:scale-95` press, so a click does not
 * shrink the shape. `collapsed` uses the resting circle (square, aligned to the right edge) for closing.
 */
type ButtonShape = { clip: string; left: number; top: number; width: number; height: number };
function aiButtonShape(collapsed: boolean): ButtonShape {
  const el = document.querySelector<HTMLElement>('[data-ai-trigger]');
  // The overlay is `fixed inset-0`, so it spans the viewport *without* the scrollbar (reserved by scrollbar-gutter).
  // innerWidth includes the scrollbar and would push the right inset ~15px too far, notching the circle.
  const w = document.documentElement.clientWidth, h = document.documentElement.clientHeight;
  const box = el?.getBoundingClientRect();
  const height = el?.offsetHeight || 56, width = collapsed ? height : (el?.offsetWidth || 56);
  // Centre of the button as drawn (includes the hover lift), then the unscaled size around it.
  const cy = box?.width ? box.top + box.height / 2 : h - 52;
  const right = box?.width ? box.left + box.width / 2 + (el!.offsetWidth / 2) : w - 24;
  const top = cy - height / 2, left = right - width;
  return { clip: `inset(${top}px ${w - right}px ${h - (top + height)}px ${left}px round ${height / 2}px)`, left, top, width, height };
}
function FocusedAssistant({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  // The surface is clipped to the button's own box with rounded corners (a circle, or a pill while the button is
  // expanded on hover) and opens into the full-screen rectangle. Closing reverses it into the button's circle.
  const [openFrom] = useState(() => aiButtonShape(false));
  const full = 'inset(0px 0px 0px 0px round 0px)';
  const ease = [0.22, 1, 0.36, 1] as const;
  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]'));
    (ref.current?.querySelector('input') as HTMLInputElement)?.focus();
    const key = (e: KeyboardEvent) => {
      // A confirm dialog opened on top of the assistant handles its own Escape and Tab.
      if ([...document.querySelectorAll('[aria-modal="true"]')].some(el => el !== ref.current)) return;
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key !== 'Tab') return;
      const all = focusable(), first = all[0], last = all[all.length - 1];
      if (e.shiftKey && (document.activeElement === first || !ref.current?.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', key); };
  }, [onClose]);
  return <motion.div ref={ref} role="dialog" aria-modal="true" aria-labelledby="ambient-title" className="fixed inset-0 z-[80]">
    {/* dims and blurs the dashboard that is shrinking behind */}
    <motion.div aria-hidden="true" className="absolute inset-0 backdrop-blur-md" style={{ background: 'light-dark(rgba(40, 25, 60, 0.45), rgba(11, 15, 25, 0.8))' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} />
    {/* the surface: circle/pill at the button -> full-screen rectangle, and back into the circle on close */}
    <motion.div aria-hidden="true" className="ai-backdrop absolute inset-0" style={{ willChange: 'clip-path' }}
      initial={{ clipPath: openFrom.clip }} animate={{ clipPath: full, transition: reduce ? { duration: 0 } : { duration: 0.55, ease } }}
      variants={{ closed: (to?: ButtonShape) => ({ clipPath: (to ?? aiButtonShape(true)).clip, transition: reduce ? { duration: 0 } : { delay: 0.1, duration: 0.45, ease } }) }}
      exit="closed">
      {/* A copy of the button (gradient + icon) sitting exactly on it. It is gone within the first ~5% of opening
          (0.03s of 0.55s) and fades back in during the last part of closing, so the page turns into the button. */}
      <motion.div className="absolute flex items-center justify-center bg-gradient-to-br from-[#8B5CF6] to-[#EC4899] text-white"
        style={{ left: openFrom.left, top: openFrom.top, width: openFrom.width, height: openFrom.height, borderRadius: 9999 }}
        initial={{ opacity: 1 }} animate={{ opacity: 0, transition: { duration: reduce ? 0 : 0.03 } }}
        variants={{ closed: (to?: ButtonShape) => {
          const b = to ?? aiButtonShape(true);
          const jump = { duration: 0 };
          return { opacity: 1, left: b.left, top: b.top, width: b.width, height: b.height,
            transition: { left: jump, top: jump, width: jump, height: jump, opacity: reduce ? jump : { delay: 0.3, duration: 0.25 } } };
        } }}
        exit="closed">
        <Sparkles className="h-6 w-6" aria-hidden="true" />
      </motion.div>
    </motion.div>
    {/* Opening is the close played backwards: the surface first grows out of the button to full screen, and only
        then the page fades in (closing fades the page out first, then shrinks the surface). The staggered
        ai-rise entrance is switched off here so the content does not scale up on its own while the surface grows. */}
    <motion.div className="absolute inset-0 overflow-y-auto ai-scroll [&_.ai-rise]:![animation:none] [&_.ai-rise]:!opacity-100" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: reduce ? 0 : 0.4, duration: 0.1 } }} exit={{ opacity: 0, transition: { duration: 0.1 } }}>{children}</motion.div>
  </motion.div>;
}function Conversation() {
  const { t } = useLanguage();
  const { messages, busy } = useAmbientAI();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [messages.length, busy]);
  return <div ref={ref} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-2"><div aria-live="polite" aria-relevant="additions" className="space-y-4">{messages.map(message => <AIMessage key={message.id} message={message} />)}</div>{busy && <div role="status" className="space-y-3 py-5"><span className="flex items-center gap-2 text-xs text-ai"><Sparkles className="h-4 w-4 motion-safe:animate-pulse" />{t("Reading your financial context")}<span className="flex gap-1">{[0, 1, 2].map(i => <span key={i} className="h-1 w-1 rounded-full bg-ai motion-safe:animate-pulse" style={{ animationDelay: `${i * 180}ms` }} />)}</span></span><div className="h-2.5 w-5/6 rounded bg-line motion-safe:animate-pulse" /><div className="h-2.5 w-2/3 rounded bg-line motion-safe:animate-pulse" /></div>}</div>;
}
export function HighlightCard({ target, children, onInspect }: { target: Highlight; children: ReactNode; onInspect: () => void }) {
  const { t } = useLanguage();
  const { highlight, open } = useAmbientAI();
  const active = highlight === target;
  return <div id={`ai-${target}`} className={`relative h-full min-w-0 rounded-xl transition-all duration-500 motion-reduce:transition-none ${active ? 'z-10 ring-1 ring-[#8B5CF6]/75 shadow-[0_0_24px_-14px_#8B5CF6] brightness-110' : ''}`}>
    {active && <button onClick={onInspect} className="absolute -top-3 right-4 z-20 flex min-h-11 items-center gap-1.5 glass-strong rounded-lg px-3 text-xs text-ai focus-visible:ring-2 focus-visible:ring-ai"><Sparkles className="h-3.5 w-3.5" />{t("AI Insight")}<ArrowUpRight className="h-3.5 w-3.5" /></button>}
    {children}
  </div>;
}
export function AssistantHome() {
  const { t } = useLanguage();
  const { openAssistant, messages, prompts } = useAmbientAI();
  return <div className="flex min-h-[500px] flex-col items-center justify-center glass rounded-3xl px-6 py-12 text-center"><Sparkles className="mb-5 h-9 w-9 text-ai" /><h2 className="text-2xl font-medium tracking-tight">{t("A little clarity, wherever you are.")}</h2><p className="mt-3 max-w-md text-sm leading-6 text-muted">{t("Your assistant now lives across your workspace. Explore your finances without leaving what you’re doing.")}</p><div className="my-8"><LiquidButton onClick={() => openAssistant()} label={messages.length ? t("Continue conversation") : t("Ask AI Assistant")} /></div><div className="flex flex-wrap justify-center gap-2">{prompts.slice(0, 3).map(p => <button key={p} onClick={() => openAssistant(p)} className="glass min-h-11 rounded-xl px-3 text-sm text-muted transition-colors hover:text-ink">{p}</button>)}</div><p className="mt-6 text-xs text-muted">{t("Ctrl / ⌘ K from anywhere · Local simulation, not a live AI service")}</p></div>;
}
