using backend.Data;
using backend.DTOs;
using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.Implementations;

public sealed class AIChatService(
    AppDbContext db,
    IEncryptionService encryption,
    IAIOrchestrationService orchestration) : IAIChatService
{
    private const int ContextMessageLimit = 20;

    public async Task<PagedResult<ConversationResponse>> GetConversationsAsync(Guid userId, PagingQuery paging,
        CancellationToken cancellationToken = default)
    {
        var source = db.AIConversations.AsNoTracking()
            .Where(c => c.UserId == userId && c.DeletedAt == null);
        var total = await source.CountAsync(cancellationToken);
        var rows = await source.OrderByDescending(c => c.UpdatedAt)
            .Skip((paging.Page - 1) * paging.PageSize).Take(paging.PageSize)
            .ToListAsync(cancellationToken);

        var items = new List<ConversationResponse>(rows.Count);
        foreach (var row in rows)
            items.Add(await MapConversationAsync(userId, row, cancellationToken));
        return new PagedResult<ConversationResponse>(items, paging.Page, paging.PageSize, total);
    }

    public async Task<PagedResult<ChatMessageResponse>> GetMessagesAsync(Guid userId, Guid conversationId,
        PagingQuery paging, CancellationToken cancellationToken = default)
    {
        await FindConversationAsync(userId, conversationId, tracked: false, cancellationToken);
        var source = db.AIChatMessages.AsNoTracking().Where(m => m.ConversationId == conversationId);
        var total = await source.CountAsync(cancellationToken);
        var rows = await source.OrderByDescending(m => m.Sequence)
            .Skip((paging.Page - 1) * paging.PageSize).Take(paging.PageSize)
            .ToListAsync(cancellationToken);

        rows.Reverse();
        var items = new List<ChatMessageResponse>(rows.Count);
        foreach (var row in rows)
            items.Add(await MapMessageAsync(userId, row, cancellationToken));
        return new PagedResult<ChatMessageResponse>(items, paging.Page, paging.PageSize, total);
    }

    public async Task<SendChatMessageResponse> SendMessageAsync(Guid userId, SendChatMessageRequest request,
        CancellationToken cancellationToken = default)
    {
        var text = request.Message.Trim();
        AIConversation conversation;
        var createdConversation = request.ConversationId is null;
        if (request.ConversationId is { } id)
        {
            conversation = await FindConversationAsync(userId, id, tracked: true, cancellationToken);
            if (conversation.IsArchived) throw new BadRequestException("Hội thoại đã được lưu trữ.");
        }
        else
        {
            var title = await encryption.EncryptAsync(userId, CreateTitle(text), cancellationToken);
            conversation = new AIConversation
            {
                UserId = userId,
                TitleCipher = title.Cipher,
                TitleNonce = title.Nonce,
                KeyVersion = title.KeyVersion
            };
            db.AIConversations.Add(conversation);
        }

        var historyRows = await db.AIChatMessages.AsNoTracking()
            .Where(m => m.ConversationId == conversation.Id && m.Status == AIProcessingStatus.Completed)
            .OrderByDescending(m => m.Sequence).Take(ContextMessageLimit).ToListAsync(cancellationToken);
        historyRows.Reverse();
        var history = new List<AIChatTurn>(historyRows.Count);
        foreach (var row in historyRows)
        {
            var content = await encryption.DecryptAsync(userId, row.ContentCipher, row.Nonce, row.KeyVersion,
                cancellationToken);
            history.Add(new AIChatTurn(row.Role == ChatMessageRole.Assistant ? "assistant" : "user", content));
        }

        var nextSequence = await db.AIChatMessages
            .Where(m => m.ConversationId == conversation.Id)
            .MaxAsync(m => (int?)m.Sequence, cancellationToken) ?? 0;
        var encryptedUser = await encryption.EncryptAsync(userId, text, cancellationToken);
        var userMessage = new AIChatMessage
        {
            ConversationId = conversation.Id,
            Sequence = nextSequence + 1,
            Role = ChatMessageRole.User,
            ContentCipher = encryptedUser.Cipher,
            Nonce = encryptedUser.Nonce,
            KeyVersion = encryptedUser.KeyVersion,
            Status = AIProcessingStatus.Completed
        };
        db.AIChatMessages.Add(userMessage);
        conversation.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        AIChatResult result;
        try
        {
            result = await orchestration.ChatAsync(userId, text, history, request.Language, cancellationToken);
        }
        catch
        {
            // Do not leave user-only/orphan conversations when the provider rejects a request.
            if (createdConversation) db.AIConversations.Remove(conversation);
            else db.AIChatMessages.Remove(userMessage);
            await db.SaveChangesAsync(CancellationToken.None);
            throw;
        }

        var encryptedAssistant = await encryption.EncryptAsync(userId, result.Content, cancellationToken);
        var assistantMessage = new AIChatMessage
        {
            ConversationId = conversation.Id,
            Sequence = userMessage.Sequence + 1,
            Role = ChatMessageRole.Assistant,
            ContentCipher = encryptedAssistant.Cipher,
            Nonce = encryptedAssistant.Nonce,
            KeyVersion = encryptedAssistant.KeyVersion,
            Intent = result.Intent,
            Status = AIProcessingStatus.Completed,
            TokenUsage = result.TokenUsage
        };
        db.AIChatMessages.Add(assistantMessage);
        conversation.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return new SendChatMessageResponse(conversation.Id,
            MapMessage(userMessage, text), MapMessage(assistantMessage, result.Content));
    }

    public async Task<ConversationResponse> RenameConversationAsync(Guid userId, Guid conversationId,
        RenameConversationRequest request, CancellationToken cancellationToken = default)
    {
        var conversation = await FindConversationAsync(userId, conversationId, tracked: true, cancellationToken);
        var title = await encryption.EncryptAsync(userId, request.Title.Trim(), cancellationToken);
        conversation.TitleCipher = title.Cipher;
        conversation.TitleNonce = title.Nonce;
        conversation.KeyVersion = title.KeyVersion;
        conversation.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return await MapConversationAsync(userId, conversation, cancellationToken);
    }

    public async Task SetArchivedAsync(Guid userId, Guid conversationId, bool archived,
        CancellationToken cancellationToken = default)
    {
        var conversation = await FindConversationAsync(userId, conversationId, tracked: true, cancellationToken);
        conversation.IsArchived = archived;
        conversation.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteConversationAsync(Guid userId, Guid conversationId,
        CancellationToken cancellationToken = default)
    {
        var conversation = await FindConversationAsync(userId, conversationId, tracked: true, cancellationToken);
        conversation.DeletedAt = DateTime.UtcNow;
        conversation.IsArchived = true;
        conversation.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task SubmitFeedbackAsync(Guid userId, Guid messageId, ChatFeedbackRequest request,
        CancellationToken cancellationToken = default)
    {
        var ownsMessage = await (from m in db.AIChatMessages
                                 join c in db.AIConversations on m.ConversationId equals c.Id
                                 where m.Id == messageId && m.Role == ChatMessageRole.Assistant
                                     && c.UserId == userId && c.DeletedAt == null
                                 select m.Id).AnyAsync(cancellationToken);
        if (!ownsMessage) throw new NotFoundException("Không tìm thấy tin nhắn AI.");

        var feedback = await db.AIFeedbacks.FirstOrDefaultAsync(
            f => f.UserId == userId && f.MessageId == messageId, cancellationToken);
        if (feedback is null)
        {
            feedback = new AIFeedback { UserId = userId, MessageId = messageId };
            db.AIFeedbacks.Add(feedback);
        }
        feedback.Rating = request.Rating;
        feedback.FeedbackText = string.IsNullOrWhiteSpace(request.FeedbackText) ? null : request.FeedbackText.Trim();
        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task<AIConversation> FindConversationAsync(Guid userId, Guid id, bool tracked,
        CancellationToken cancellationToken)
    {
        var source = tracked ? db.AIConversations : db.AIConversations.AsNoTracking();
        return await source.FirstOrDefaultAsync(c => c.Id == id && c.UserId == userId && c.DeletedAt == null,
            cancellationToken) ?? throw new NotFoundException("Không tìm thấy hội thoại.");
    }

    private async Task<ConversationResponse> MapConversationAsync(Guid userId, AIConversation c,
        CancellationToken cancellationToken)
    {
        var title = await encryption.DecryptAsync(userId, c.TitleCipher, c.TitleNonce, c.KeyVersion,
            cancellationToken);
        return new ConversationResponse(c.Id, title, AsUtc(c.CreatedAt), AsUtc(c.UpdatedAt), c.IsArchived);
    }

    private async Task<ChatMessageResponse> MapMessageAsync(Guid userId, AIChatMessage m,
        CancellationToken cancellationToken) =>
        MapMessage(m, await encryption.DecryptAsync(userId, m.ContentCipher, m.Nonce, m.KeyVersion,
            cancellationToken));

    private static ChatMessageResponse MapMessage(AIChatMessage m, string content) =>
        new(m.Id, m.ConversationId, m.Sequence, m.Role, content, m.Intent, m.Status, AsUtc(m.CreatedAt));

    private static DateTime AsUtc(DateTime value) =>
        value.Kind == DateTimeKind.Utc ? value : DateTime.SpecifyKind(value, DateTimeKind.Utc);

    private static string CreateTitle(string message) => message.Length <= 60 ? message : $"{message[..57]}...";
}
