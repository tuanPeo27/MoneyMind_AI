import { getData, http } from './client';
import type { AIChatMessageResponse, AIConversationResponse, AIUsageResponse, PagedResult, SendAIChatMessageResponse } from './types';

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

/**
 * Sends a message through ASP.NET; the browser never receives the Gemini API key.
 * `language` is the UI language: the assistant answers in it whatever language the question uses.
 */
export const sendMessage = (conversationId: string | null, message: string, language?: 'vi' | 'en') =>
  getData(http.post<SendAIChatMessageResponse>(
    '/ai/chat/messages',
    { conversationId, message, language },
    { timeout: 65_000 },
  ));
