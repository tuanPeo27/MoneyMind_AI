import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { IconButton } from './ui';
import { MORPH_SPRING } from './ambient-ai/AmbientAI';

/**
 * Container transform: the small card (a `motion` element with `layoutId={`card-${id}`}`) grows into this full-screen
 * surface with a spring and shrinks back into the same card on close. The card's summary fades out in 100ms and the
 * detail fades in once the surface has opened.
 */
export function ExpandedCard({ id, title, closeLabel, onClose, children }: { id: string | null; title: string; closeLabel: string; onClose: () => void; children: ReactNode }) {
  return createPortal(<AnimatePresence>{id && <Surface key={id} id={id} title={title} closeLabel={closeLabel} onClose={onClose}>{children}</Surface>}</AnimatePresence>, document.body);
}

function Surface({ id, title, closeLabel, onClose, children }: { id: string; title: string; closeLabel: string; onClose: () => void; children: ReactNode }) {
  const reduce = useReducedMotion();
  const spring = reduce ? { duration: 0 } : MORPH_SPRING;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('[data-close] button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      if (event.key === 'Tab') {
        const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input, select, [tabindex="0"]') ?? []);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', key, true); previous?.focus?.(); };
  }, [onClose]);
  return <motion.div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[75]">
    <motion.div aria-hidden="true" className="absolute inset-0 backdrop-blur-md" style={{ background: 'light-dark(rgba(40, 25, 60, 0.45), rgba(11, 15, 25, 0.8))' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} onClick={onClose} />
    <motion.div aria-hidden="true" layoutId={`card-${id}`} style={{ borderRadius: 0 }} transition={spring} exit={{ opacity: 0.99 }} className="glass-strong absolute inset-0 !border-0" />
    <motion.div className="absolute inset-0 overflow-y-auto ai-scroll" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.14, duration: 0.26 } }} exit={{ opacity: 0, transition: { duration: 0.1 } }}>
      <div className="mx-auto max-w-6xl px-4 pb-10 pt-4 sm:px-8 sm:pt-6">
        <div className="mb-6 flex items-center justify-between gap-3">
          <h2 className="text-[1.35rem] font-semibold tracking-tight">{title}</h2>
          <span data-close><IconButton icon={X} label={closeLabel} onClick={onClose} /></span>
        </div>
        {children}
      </div>
    </motion.div>
  </motion.div>;
}
