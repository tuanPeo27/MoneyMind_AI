using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace backend.Controllers;

[Route("api/ai/chat")]
[EnableRateLimiting("ai")]
public sealed class AIChatController(IAIChatService service, ICurrentUserService currentUser)
    : UserControllerBase(currentUser)
{
    [HttpGet("conversations")]
    public async Task<ActionResult<PagedResult<ConversationResponse>>> GetConversations(
        [FromQuery] PagingQuery paging, CancellationToken ct) =>
        Ok(await service.GetConversationsAsync(UserId, paging, ct));

    [HttpGet("conversations/{conversationId:guid}/messages")]
    public async Task<ActionResult<PagedResult<ChatMessageResponse>>> GetMessages(Guid conversationId,
        [FromQuery] PagingQuery paging, CancellationToken ct) =>
        Ok(await service.GetMessagesAsync(UserId, conversationId, paging, ct));

    /// <summary>Creates a conversation when conversationId is null, then sends the message to Gemini.</summary>
    [HttpPost("messages")]
    public async Task<ActionResult<SendChatMessageResponse>> SendMessage(SendChatMessageRequest request,
        CancellationToken ct) =>
        Ok(await service.SendMessageAsync(UserId, request, ct));

    [HttpPut("conversations/{conversationId:guid}/title")]
    public async Task<ActionResult<ConversationResponse>> Rename(Guid conversationId,
        RenameConversationRequest request, CancellationToken ct) =>
        Ok(await service.RenameConversationAsync(UserId, conversationId, request, ct));

    [HttpPut("conversations/{conversationId:guid}/archive")]
    public async Task<IActionResult> Archive(Guid conversationId, CancellationToken ct)
    {
        await service.SetArchivedAsync(UserId, conversationId, true, ct);
        return NoContent();
    }

    [HttpDelete("conversations/{conversationId:guid}/archive")]
    public async Task<IActionResult> Unarchive(Guid conversationId, CancellationToken ct)
    {
        await service.SetArchivedAsync(UserId, conversationId, false, ct);
        return NoContent();
    }

    [HttpDelete("conversations/{conversationId:guid}")]
    public async Task<IActionResult> DeleteConversation(Guid conversationId, CancellationToken ct)
    {
        await service.DeleteConversationAsync(UserId, conversationId, ct);
        return NoContent();
    }

    [HttpPost("messages/{messageId:guid}/feedback")]
    public async Task<IActionResult> SubmitFeedback(Guid messageId, ChatFeedbackRequest request,
        CancellationToken ct)
    {
        await service.SubmitFeedbackAsync(UserId, messageId, request, ct);
        return NoContent();
    }
}
