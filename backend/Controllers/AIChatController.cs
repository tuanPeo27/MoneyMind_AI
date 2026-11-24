using System.Text.Json;
using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace backend.Controllers;

[Route("api/ai/chat")]
[EnableRateLimiting("ai")]
public sealed class AIChatController(IAIChatService service, ICurrentUserService currentUser,
    IOptions<JsonOptions> jsonOptions, ILogger<AIChatController> logger)
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
        Ok(await service.SendMessageAsync(UserId, request, cancellationToken: ct));

    /// <summary>
    /// Same as POST messages, streamed as newline-delimited JSON so the answer appears while it is written:
    /// <c>start</c> (conversationId, userMessage), then <c>delta</c> (text) pieces, then <c>done</c> (the same body as
    /// POST messages) or <c>error</c> (status, message). Errors found before the answer starts (limit reached, another
    /// request running, invalid input) are normal HTTP errors instead.
    /// </summary>
    [HttpPost("messages/stream")]
    [Produces("application/x-ndjson")]
    public async Task StreamMessage(SendChatMessageRequest request, CancellationToken ct)
    {
        var json = jsonOptions.Value.JsonSerializerOptions;
        var started = false;

        async Task Write(object evt)
        {
            if (!started)
            {
                started = true;
                Response.ContentType = "application/x-ndjson; charset=utf-8";
                Response.Headers.CacheControl = "no-cache";
                Response.Headers["X-Accel-Buffering"] = "no"; // stop reverse proxies from holding the stream back
            }
            await JsonSerializer.SerializeAsync(Response.Body, evt, evt.GetType(), json, ct);
            await Response.Body.WriteAsync("\n"u8.ToArray(), ct);
            await Response.Body.FlushAsync(ct);
        }

        try
        {
            var result = await service.SendMessageAsync(UserId, request, new ChatStreamCallbacks(
                OnStarted: (conversationId, userMessage) => Write(new { type = "start", conversationId, userMessage }),
                OnDelta: text => Write(new { type = "delta", text })), ct);
            await Write(new { type = "done", result });
        }
        catch (AppException ex) when (started)
        {
            await Write(new { type = "error", status = ex.StatusCode, message = ex.Message });
        }
        catch (Exception ex) when (started && ex is not OperationCanceledException)
        {
            logger.LogError(ex, "AI chat stream failed for user {UserId}", UserId);
            await Write(new { type = "error", status = StatusCodes.Status500InternalServerError, message = "Đã có lỗi xảy ra. Vui lòng thử lại." });
        }
    }

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
