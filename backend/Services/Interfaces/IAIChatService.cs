using backend.DTOs.Requests;
using backend.DTOs.Responses;

namespace backend.Services.Interfaces;

/// <param name="OnStarted">The conversation id (new or existing) and the stored user message.</param>
/// <param name="OnDelta">A piece of the assistant's answer, in order.</param>
public sealed record ChatStreamCallbacks(
    Func<Guid, ChatMessageResponse, Task>? OnStarted = null,
    Func<string, Task>? OnDelta = null);

public interface IAIChatService
{
    Task<PagedResult<ConversationResponse>> GetConversationsAsync(Guid userId, PagingQuery paging,
        CancellationToken cancellationToken = default);
    Task<PagedResult<ChatMessageResponse>> GetMessagesAsync(Guid userId, Guid conversationId, PagingQuery paging,
        CancellationToken cancellationToken = default);
    /// <param name="callbacks">Streaming hooks: told once the user's message is stored, then each piece of the answer.</param>
    Task<SendChatMessageResponse> SendMessageAsync(Guid userId, SendChatMessageRequest request,
        ChatStreamCallbacks? callbacks = null, CancellationToken cancellationToken = default);
    Task<ConversationResponse> RenameConversationAsync(Guid userId, Guid conversationId,
        RenameConversationRequest request, CancellationToken cancellationToken = default);
    Task SetArchivedAsync(Guid userId, Guid conversationId, bool archived,
        CancellationToken cancellationToken = default);
    Task DeleteConversationAsync(Guid userId, Guid conversationId, CancellationToken cancellationToken = default);
    Task SubmitFeedbackAsync(Guid userId, Guid messageId, ChatFeedbackRequest request,
        CancellationToken cancellationToken = default);
}
