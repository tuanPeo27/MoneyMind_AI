using backend.DTOs.Requests;
using backend.DTOs.Responses;

namespace backend.Services.Interfaces;

public interface IAIChatService
{
    Task<PagedResult<ConversationResponse>> GetConversationsAsync(Guid userId, PagingQuery paging,
        CancellationToken cancellationToken = default);
    Task<PagedResult<ChatMessageResponse>> GetMessagesAsync(Guid userId, Guid conversationId, PagingQuery paging,
        CancellationToken cancellationToken = default);
    Task<SendChatMessageResponse> SendMessageAsync(Guid userId, SendChatMessageRequest request,
        CancellationToken cancellationToken = default);
    Task<ConversationResponse> RenameConversationAsync(Guid userId, Guid conversationId,
        RenameConversationRequest request, CancellationToken cancellationToken = default);
    Task SetArchivedAsync(Guid userId, Guid conversationId, bool archived,
        CancellationToken cancellationToken = default);
    Task DeleteConversationAsync(Guid userId, Guid conversationId, CancellationToken cancellationToken = default);
    Task SubmitFeedbackAsync(Guid userId, Guid messageId, ChatFeedbackRequest request,
        CancellationToken cancellationToken = default);
}
