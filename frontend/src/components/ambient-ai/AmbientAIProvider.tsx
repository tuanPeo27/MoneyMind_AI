import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocal } from '../../hooks/useLocal';
import { emptyContext, getPrompts, simulateFinancialResponse, type FinancialContext, type Highlight, type AIResponse } from './mockAssistant';

export type AIMessageData = AIResponse & {
  id: string; role: 'user' | 'assistant'; time: string; context?: string;
};
type AmbientState = {
  open: boolean;
  busy: boolean;
  messages: AIMessageData[];
  financial: FinancialContext;
  highlight: Highlight;
  prompts: string[];
  storageError: boolean;
  setContext: (value: FinancialContext) => void;
  openAssistant: (question?: string) => void;
  closeAssistant: () => void;
  send: (question: string) => void;
  clear: () => void;
  clearHighlight: () => void;
  inspect: (target: Highlight) => void;
  registerNavigator: (callback: (target: Highlight) => void) => void;
};
const Context = createContext<AmbientState | null>(null);
export const useAmbientAI = () => {
  const value = useContext(Context);
  if (!value) throw new Error('AmbientAIProvider is required');
  return value;
};
export function AmbientAIProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [financial, setContext] = useState<FinancialContext>(emptyContext);
  const [highlight, setHighlight] = useState<Highlight>(null);
  const [messages, setMessages, storageError] = useLocal<AIMessageData[]>('mm-ambient-chat-v1', () => {
    try {
      const legacy = JSON.parse(localStorage.getItem('mm-chat') || '[]');
      return Array.isArray(legacy) ? legacy.filter(m => m.id !== 'welcome').map(m => ({ ...m, context: 'Previous local conversation' })) : [];
    } catch { return []; }
  });
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const fadeTimer = useRef<ReturnType<typeof setTimeout>>();
  const navigate = useRef<(target: Highlight) => void>(() => {});
  const locked = useRef(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  const lastTarget = useRef<Highlight>(null);
  const registerNavigator = useCallback((callback: (target: Highlight) => void) => { navigate.current = callback; }, []);
  const clearHighlight = useCallback(() => { setHighlight(null); clearTimeout(fadeTimer.current); }, []);
  const closeAssistant = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => {
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
      else document.querySelector<HTMLButtonElement>('[data-ai-trigger]')?.focus();
    });
    clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => setHighlight(null), 25000);
  }, []);
  function send(question: string) {
    if (!question.trim() || locked.current) return;
    locked.current = true;
    setBusy(true);
    const time = new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
    const snapshot = financial;
    setMessages(old => [...old, { id: crypto.randomUUID(), role: 'user', text: question.trim(), time, context: snapshot.page }]);
    clearTimeout(fadeTimer.current);
    timer.current = setTimeout(() => {
      const response = simulateFinancialResponse(question, snapshot, lastTarget.current);
      lastTarget.current = response.highlight || null;
      setHighlight(response.highlight || null);
      setMessages(old => [...old, { ...response, id: crypto.randomUUID(), role: 'assistant', time: new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }), context: `${snapshot.page} · ${snapshot.period}` }]);
      setBusy(false);
      locked.current = false;
    }, 800);
  }
  function openAssistant(question?: string) {
    previousFocus.current = document.activeElement as HTMLElement;
    setOpen(true);
    if (question) send(question);
  }
  function inspect(target: Highlight) {
    setHighlight(target);
    closeAssistant();
    navigate.current(target);
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const element = e.target as HTMLElement;
      const typing = element.matches('input, textarea, select, [contenteditable="true"]');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !typing && !document.querySelector('[aria-modal="true"]')) {
        e.preventDefault();
        previousFocus.current = document.activeElement as HTMLElement;
        setOpen(true);
      }
    };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); };
  }, []);
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(fadeTimer.current); }, []);
  return <Context.Provider value={{
    open, busy, financial, highlight, messages, storageError,
    prompts: getPrompts(financial.route.startsWith('/admin') ? 'Admin' : financial.page), setContext, openAssistant, closeAssistant,
    send, inspect, clearHighlight, registerNavigator,
    clear: () => { if (!locked.current) { setMessages([]); clearHighlight(); lastTarget.current = null; } },
  }}>{children}</Context.Provider>;
}
