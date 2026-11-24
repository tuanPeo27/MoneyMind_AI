import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { emptyContext, getPrompts, type FinancialContext, type Highlight, type AIResponse } from './mockAssistant';
import { aiChatApi, ApiError, useSession, type AIActionPayload, type AIActionResponse, type AIChatMessageResponse, type AIConversationResponse, type AIUsageResponse } from '../../services';
import { FINANCE_CHANGED_EVENT } from './AIActionCard';
import { useLanguage } from '../../i18n';

export type AIMessageData = AIResponse & {
  id: string; role: 'user' | 'assistant'; time: string; context?: string;
  /** Changes this reply proposed (the user confirms or cancels each one). */
  actions?: AIActionResponse[];
  /** The answer is still being written. */
  streaming?: boolean;
};
type AmbientState = {
  open: boolean;
  busy: boolean;
  messages: AIMessageData[];
  conversations: AIConversationResponse[];
  conversationId: string | null;
  historyBusy: boolean;
  /** Today's AI message limit; null until loaded. */
  usage: AIUsageResponse | null;
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
  confirmAction: (messageId: string, actionId: string, payload?: AIActionPayload) => Promise<void>;
  cancelAction: (messageId: string, actionId: string) => Promise<void>;
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
    actions: message.actions?.length ? message.actions : undefined,
  };
}

const Context = createContext<AmbientState | null>(null);
export const useAmbientAI = () => {
  const value = useContext(Context);
  if (!value) throw new Error('AmbientAIProvider is required');
  return value;
};
type AmbientView = Pick<AmbientState, 'highlight' | 'openAssistant' | 'clearHighlight'>;
/**
 * What the dashboard needs from the assistant: the card it points at, and stable functions to open it or clear
 * the highlight. Unlike useAmbientAI(), this does not change when the assistant opens, closes or streams a reply,
 * so pages behind the AI page (Overview and its charts) do not re-render during its open / close animation.
 */
const ViewContext = createContext<AmbientView | null>(null);
export const useAmbientAIView = () => {
  const value = useContext(ViewContext);
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
  const [usage, setUsage] = useState<AIUsageResponse | null>(null);
  const refreshUsage = useCallback(() => { aiChatApi.getUsage().then(setUsage).catch(() => undefined); }, []);
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
    // The reply appears as it is written: an empty assistant message grows with each piece the server sends.
    const draftId = crypto.randomUUID();
    const startedNew = conversationId === null;
    setMessages(old => [...old, { id: crypto.randomUUID(), role: 'user', text, time, context: financial.page },
      { id: draftId, role: 'assistant', text: '', time, streaming: true, context: 'Gemini · Encrypted history' }]);
    clearTimeout(fadeTimer.current);

    try {
      const response = await aiChatApi.streamMessage(conversationId, text, language, {
        onStart: id => setConversationId(id),
        onDelta: piece => setMessages(old => old.map(m => m.id === draftId ? { ...m, text: m.text + piece } : m)),
      });
      setUsage(response.usage);
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
      setMessages(old => old.map(m => m.id === draftId ? { ...mapServerMessage(response.assistantMessage, locale, timeZone), highlight: target } : m));
    } catch (e) {
      // 429: out of messages today. 409: another request is still running. Show the server's explanation.
      const known = e instanceof ApiError && (e.status === 429 || e.status === 409);
      if (e instanceof ApiError && e.status === 429) refreshUsage();
      // The server removes a conversation whose first answer failed, so do not keep sending to it.
      if (startedNew) {
        setConversationId(null);
        if (session?.user.id) localStorage.removeItem(`mm-ai-conversation-${session.user.id}`);
      }
      setMessages(old => old.map(m => m.id === draftId ? {
        ...m, streaming: false, text: known ? e.message : t('AI service is unavailable. Please try again.'),
        time: chatTime(new Date(), locale, timeZone), context: 'Request failed', // translated when shown
      } : m));
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

  const replaceAction = (messageId: string, updated: AIActionResponse) =>
    setMessages(old => old.map(m => m.id === messageId
      ? { ...m, actions: m.actions?.map(a => a.id === updated.id ? updated : a) } : m));

  async function confirmAction(messageId: string, actionId: string, payload?: AIActionPayload) {
    replaceAction(messageId, await aiChatApi.confirmAction(actionId, payload));
    // Budgets, funds and the transaction list changed on the server; budget alerts may have been created too.
    window.dispatchEvent(new Event(FINANCE_CHANGED_EVENT));
  }

  async function cancelAction(messageId: string, actionId: string) {
    replaceAction(messageId, await aiChatApi.cancelAction(actionId));
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
    setUsage(null);
    if (!userId) return () => { cancelled = true; };
    refreshUsage();

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
  // openAssistant is re-created on every render (it closes over send); the view context hands out a stable wrapper.
  const openLatest = useRef(openAssistant);
  openLatest.current = openAssistant;
  const stableOpen = useCallback((question?: string) => openLatest.current(question), []);
  const view = useMemo<AmbientView>(() => ({ highlight, openAssistant: stableOpen, clearHighlight }), [highlight, stableOpen, clearHighlight]);
  return <ViewContext.Provider value={view}><Context.Provider value={{
    open, busy, financial, highlight, messages, conversations, conversationId, historyBusy, usage, storageError,
    // Suggestions in the current language; the chip sends the same (translated) text it shows.
    prompts: getPrompts(financial.route.startsWith('/admin') ? 'Admin' : financial.page).map(prompt => t(prompt)), setContext, openAssistant, closeAssistant,
    send, selectConversation, removeConversation, confirmAction, cancelAction, inspect, clearHighlight, registerNavigator,
    clear: () => {
      if (!locked.current) {
        if (session?.user.id) localStorage.removeItem(`mm-ai-conversation-${session.user.id}`);
        setMessages([]); setConversationId(null); clearHighlight(); lastTarget.current = null;
      }
    },
  }}>{children}</Context.Provider></ViewContext.Provider>;
}
