import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { emptyContext, getPrompts, type FinancialContext, type Highlight, type AIResponse } from './mockAssistant';
import { aiChatApi, useSession, type AIChatMessageResponse, type AIConversationResponse } from '../../services';
import { useLanguage } from '../../i18n';

export type AIMessageData = AIResponse & {
  id: string; role: 'user' | 'assistant'; time: string; context?: string;
};
type AmbientState = {
  open: boolean;
  busy: boolean;
  messages: AIMessageData[];
  conversations: AIConversationResponse[];
  conversationId: string | null;
  historyBusy: boolean;
  financial: FinancialContext;
  highlight: Highlight;
  prompts: string[];
  storageError: boolean;
  setContext: (value: FinancialContext) => void;
  openAssistant: (question?: string) => void;
  closeAssistant: () => void;
  send: (question: string) => void;
  selectConversation: (id: string) => Promise<void>;
  removeConversation: (id: string) => Promise<void>;
  clear: () => void;
  clearHighlight: () => void;
  inspect: (target: Highlight) => void;
  registerNavigator: (callback: (target: Highlight) => void) => void;
};

function intentHighlight(intent?: string | null): Highlight {
  if (intent === 'spending_analysis') return 'expenses';
  if (intent === 'budget_advice') return 'budgets';
  if (intent === 'transaction_help') return 'transactions';
  if (intent === 'saving_goal' || intent === 'account_help') return 'summary';
  return null;
}

function utcDate(value: string): Date {
  // SQL Server DateTime values from older backend versions have no offset, but all chat dates are stored as UTC.
  return new Date(/[zZ]$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`);
}

function chatTime(value: string | Date, locale: string, timeZone: string): string {
  const date = typeof value === 'string' ? utcDate(value) : value;
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone });
}

function mapServerMessage(message: AIChatMessageResponse, locale: string, timeZone: string): AIMessageData {
  return {
    id: message.id,
    role: message.role === 'Assistant' ? 'assistant' : 'user',
    text: message.content,
    time: chatTime(message.createdAt, locale, timeZone),
    context: message.role === 'Assistant' ? 'Gemini · Encrypted history' : undefined,
    highlight: intentHighlight(message.intent),
  };
}

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
  const { session } = useSession();
  const { locale, language, t } = useLanguage();
  const timeZone = session?.user.timeZoneId || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Ho_Chi_Minh';
  const [messages, setMessages] = useState<AIMessageData[]>([]);
  const [conversations, setConversations] = useState<AIConversationResponse[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const storageError = false;
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
  async function send(question: string) {
    const text = question.trim();
    if (!text || locked.current) return;
    locked.current = true;
    setBusy(true);
    const time = chatTime(new Date(), locale, timeZone);
    setMessages(old => [...old, { id: crypto.randomUUID(), role: 'user', text, time, context: financial.page }]);
    clearTimeout(fadeTimer.current);

    try {
      const response = await aiChatApi.sendMessage(conversationId, text, language);
      setConversationId(response.conversationId);
      if (session?.user.id) localStorage.setItem(`mm-ai-conversation-${session.user.id}`, response.conversationId);
      setConversations(old => {
        const existing = old.find(item => item.id === response.conversationId);
        const now = response.assistantMessage.createdAt;
        if (existing) return [{ ...existing, updatedAt: now }, ...old.filter(item => item.id !== existing.id)];
        return [{ id: response.conversationId, title: text.length <= 60 ? text : `${text.slice(0, 57)}...`, createdAt: now, updatedAt: now, isArchived: false }, ...old];
      });
      const target = intentHighlight(response.assistantMessage.intent);
      lastTarget.current = target;
      setHighlight(target);
      setMessages(old => [...old, {
        id: response.assistantMessage.id,
        role: 'assistant',
        text: response.assistantMessage.content,
        time: chatTime(response.assistantMessage.createdAt, locale, timeZone),
        context: 'Gemini · Encrypted history',
        highlight: target,
      }]);
    } catch {
      setMessages(old => [...old, {
        id: crypto.randomUUID(), role: 'assistant', text: t('AI service is unavailable. Please try again.'),
        time: chatTime(new Date(), locale, timeZone), context: 'Request failed', // translated when shown
      }]);
    } finally {
      setBusy(false);
      locked.current = false;
    }
  }
  async function selectConversation(id: string) {
    if (locked.current || id === conversationId) return;
    setHistoryBusy(true);
    try {
      const history = await aiChatApi.getMessages(id);
      setConversationId(id);
      setMessages(history.items.map(message => mapServerMessage(message, locale, timeZone)));
      if (session?.user.id) localStorage.setItem(`mm-ai-conversation-${session.user.id}`, id);
    } finally {
      setHistoryBusy(false);
    }
  }

  async function removeConversation(id: string) {
    if (locked.current) return;
    setHistoryBusy(true);
    try {
      await aiChatApi.deleteConversation(id);
      const remaining = conversations.filter(item => item.id !== id);
      setConversations(remaining);
      if (id === conversationId) {
        setConversationId(null); setMessages([]);
        if (session?.user.id) localStorage.removeItem(`mm-ai-conversation-${session.user.id}`);
        const next = remaining.find(item => !item.isArchived);
        if (next) await selectConversation(next.id);
      }
    } finally {
      setHistoryBusy(false);
    }
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
    let cancelled = false;
    const userId = session?.user.id;
    setMessages([]);
    setConversations([]);
    setConversationId(null);
    if (!userId) return () => { cancelled = true; };

    // Remove legacy plaintext chat copies; server-side history is encrypted at rest.
    localStorage.removeItem('mm-ambient-chat-v1');
    localStorage.removeItem('mm-chat');

    void (async () => {
      try {
        const conversations = await aiChatApi.getConversations();
        if (cancelled) return;
        const available = conversations.items.filter(item => !item.isArchived);
        setConversations(available);
        const storageKey = `mm-ai-conversation-${userId}`;
        const savedId = localStorage.getItem(storageKey);
        const id = available.some(item => item.id === savedId) ? savedId : available[0]?.id ?? null;
        if (!id || cancelled) return;

        const history = await aiChatApi.getMessages(id);
        if (cancelled) return;
        setConversationId(id);
        localStorage.setItem(storageKey, id);
        setMessages(history.items.map(message => mapServerMessage(message, locale, timeZone)));
      } catch {
        localStorage.removeItem(`mm-ai-conversation-${userId}`);
      }
    })();
    return () => { cancelled = true; };
  }, [session?.user.id, locale, timeZone]);

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
  useEffect(() => () => { clearTimeout(fadeTimer.current); }, []);
  return <Context.Provider value={{
    open, busy, financial, highlight, messages, conversations, conversationId, historyBusy, storageError,
    // Suggestions in the current language; the chip sends the same (translated) text it shows.
    prompts: getPrompts(financial.route.startsWith('/admin') ? 'Admin' : financial.page).map(prompt => t(prompt)), setContext, openAssistant, closeAssistant,
    send, selectConversation, removeConversation, inspect, clearHighlight, registerNavigator,
    clear: () => {
      if (!locked.current) {
        if (session?.user.id) localStorage.removeItem(`mm-ai-conversation-${session.user.id}`);
        setMessages([]); setConversationId(null); clearHighlight(); lastTarget.current = null;
      }
    },
  }}>{children}</Context.Provider>;
}
