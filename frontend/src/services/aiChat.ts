import { ApiError, getData, http, postStream } from './client';
import type {
  AIActionPayload, AIActionResponse, AIChatMessageResponse, AIConversationResponse, AIUsageResponse, PagedResult,
  SendAIChatMessageResponse,
} from './types';

export const getConversations = () =>
  getData(http.get<PagedResult<AIConversationResponse>>('/ai/chat/conversations', { params: { page: 1, pageSize: 100 } }));

export const getMessages = (conversationId: string) =>
  getData(http.get<PagedResult<AIChatMessageResponse>>(
    `/ai/chat/conversations/${conversationId}/messages`,
    { params: { page: 1, pageSize: 100 } },
  ));

/** Today's AI message limit for the signed-in user. */
export const getUsage = () => getData(http.get<AIUsageResponse>('/ai/usage'));

export const deleteConversation = (conversationId: string) =>
  http.delete(`/ai/chat/conversations/${conversationId}`).then(() => undefined);

/** Sends a message through ASP.NET and waits for the whole answer. The browser never receives the Gemini API key. */
export const sendMessage = (conversationId: string | null, message: string, language?: 'vi' | 'en') =>
  getData(http.post<SendAIChatMessageResponse>(
    '/ai/chat/messages',
    { conversationId, message, language },
    { timeout: 65_000 },
  ));

export type StreamHandlers = {
  /** The user's message is stored; `conversationId` is new when this message started the conversation. */
  onStart?: (conversationId: string, userMessage: AIChatMessageResponse) => void;
  /** The next piece of the answer. */
  onDelta?: (text: string) => void;
};

/**
 * Sends a message and shows the answer while it is written. Resolves with the same result as {@link sendMessage}.
 * Errors before the answer starts (limit reached, another request running) reject with the server's ApiError;
 * a failure during the answer rejects with an ApiError carrying the server's message.
 */
export async function streamMessage(conversationId: string | null, message: string, language: 'vi' | 'en' | undefined,
  handlers: StreamHandlers, signal?: AbortSignal): Promise<SendAIChatMessageResponse> {
  let result: SendAIChatMessageResponse | undefined;
  let failure: ApiError | undefined;
  await postStream('/ai/chat/messages/stream', { conversationId, message, language }, event => {
    if (event.type === 'start') handlers.onStart?.(event.conversationId, event.userMessage);
    else if (event.type === 'delta') handlers.onDelta?.(event.text);
    else if (event.type === 'done') result = event.result;
    else if (event.type === 'error') failure = new ApiError(event.message || 'REQUEST_FAILED', event.status ?? 503);
  }, signal);
  if (failure) throw failure;
  if (!result) throw new ApiError('NETWORK', 0);
  return result;
}

/** Carries out a proposed action. Pass the edited details, or nothing to confirm what the AI proposed. */
export const confirmAction = (id: string, payload?: AIActionPayload) =>
  getData(http.post<AIActionResponse>(`/ai/actions/${id}/confirm`, { payload: payload ?? null }));

export const cancelAction = (id: string) => getData(http.post<AIActionResponse>(`/ai/actions/${id}/cancel`));
