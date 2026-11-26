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
    IAIOrchestrationService orchestration,
    IAIQuotaService quota,
    UserRequestGate gate,
    IAIActionService actions) : IAIChatService
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
        var proposed = await actions.GetForMessagesAsync(userId,
            rows.Where(r => r.Role == ChatMessageRole.Assistant).Select(r => r.Id).ToList(), cancellationToken);
        var items = new List<ChatMessageResponse>(rows.Count);
        foreach (var row in rows)
            items.Add(MapMessage(row, await DecryptAsync(userId, row, cancellationToken), proposed.GetValueOrDefault(row.Id)));
        return new PagedResult<ChatMessageResponse>(items, paging.Page, paging.PageSize, total);
    }

    public async Task<SendChatMessageResponse> SendMessageAsync(Guid userId, SendChatMessageRequest request,
        ChatStreamCallbacks? callbacks = null, CancellationToken cancellationToken = default)
    {
        // One request per user at a time, and a limit check before anything is stored or sent to the AI.
        using var slot = gate.TryEnter(userId)
            ?? throw new ConflictException("Bạn đang có một yêu cầu AI đang xử lý. Vui lòng đợi hoàn tất.");
        await quota.EnsureAvailableAsync(userId, cancellationToken);

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
        // Earlier proposals and whether the user confirmed them, so the model does not propose the same thing twice.
        var earlierActions = await actions.GetForMessagesAsync(userId,
            historyRows.Where(r => r.Role == ChatMessageRole.Assistant).Select(r => r.Id).ToList(), cancellationToken);
        var history = new List<AIChatTurn>(historyRows.Count);
        foreach (var row in historyRows)
        {
            var turn = await DecryptAsync(userId, row, cancellationToken);
            if (earlierActions.TryGetValue(row.Id, out var outcomes))
                turn = string.Join('\n', [turn, .. outcomes.Select(AIActionService.DescribeForHistory)]);
            history.Add(new AIChatTurn(row.Role == ChatMessageRole.Assistant ? "assistant" : "user", turn));
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
        if (callbacks?.OnStarted is { } started) await started(conversation.Id, MapMessage(userMessage, text));

        AIChatResult result;
        string content;
        IReadOnlyList<AIProposedAction> proposals;
        try
        {
            result = await orchestration.ChatAsync(userId, text, history, request.Language, callbacks?.OnDelta, cancellationToken);
            proposals = (result.Actions ?? []).Where(a => AIActionTypes.All.Contains(a.Name)).Take(AIActionTypes.MaxPerMessage).ToList();
            // A model that only calls functions writes no text, so the reply explains what is waiting for the user.
            content = result.Content.Length > 0 ? result.Content
                : proposals.Count > 0 ? ActionsReady(proposals.Count, request.Language)
                : throw new ServiceUnavailableException("Dịch vụ AI không trả lời được câu hỏi này. Vui lòng thử lại.");
        }
        catch
        {
            // Do not leave user-only/orphan conversations when the provider rejects a request.
            if (createdConversation) db.AIConversations.Remove(conversation);
            else db.AIChatMessages.Remove(userMessage);
            await db.SaveChangesAsync(CancellationToken.None);
            throw;
        }

        var assistantMessage = new AIChatMessage
        {
            ConversationId = conversation.Id,
            Sequence = userMessage.Sequence + 1,
            Role = ChatMessageRole.Assistant,
            Intent = result.Intent ?? IntentFor(proposals),
            Status = AIProcessingStatus.Completed,
            TokenUsage = result.TokenUsage
        };
        db.AIChatMessages.Add(assistantMessage);
        var proposed = await actions.ProposeAsync(userId, assistantMessage.Id, proposals, cancellationToken);
        // The text is settled once the proposals have been checked: a budget proposal the backend had to drop (every
        // category already has a budget, or none is valid) must not leave "see below" with nothing below.
        var droppedBudgets = proposals.Any(p => p.Name == AIActionTypes.ProposeBudgets)
            && !proposed.Any(p => p.Type == AIActionTypes.ProposeBudgets);
        if (result.Content.Length == 0)
            content = proposed.Count > 0 ? ActionsReady(proposed, request.Language) : NoBudgetProposal(request.Language);
        else if (droppedBudgets)
            content = $"{content.TrimEnd()}\n\n{NoBudgetProposal(request.Language)}";
        var encryptedAssistant = await encryption.EncryptAsync(userId, content, cancellationToken);
        assistantMessage.ContentCipher = encryptedAssistant.Cipher;
        assistantMessage.Nonce = encryptedAssistant.Nonce;
        assistantMessage.KeyVersion = encryptedAssistant.KeyVersion;
        conversation.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        var usage = (await quota.GetStatusAsync(userId, cancellationToken)).ToUsage();
        return new SendChatMessageResponse(conversation.Id,
            MapMessage(userMessage, text), MapMessage(assistantMessage, content, proposed), usage);
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

    private Task<string> DecryptAsync(Guid userId, AIChatMessage m, CancellationToken cancellationToken) =>
        encryption.DecryptAsync(userId, m.ContentCipher, m.Nonce, m.KeyVersion, cancellationToken);

    private static ChatMessageResponse MapMessage(AIChatMessage m, string content,
        IReadOnlyList<AIActionResponse>? proposed = null) =>
        new(m.Id, m.ConversationId, m.Sequence, m.Role, content, m.Intent, m.Status, AsUtc(m.CreatedAt), proposed ?? []);

    private static string ActionsReady(IReadOnlyList<AIActionResponse> proposed, string? language) =>
        proposed is [{ Type: AIActionTypes.ProposeBudgets }]
            ? language == "en"
                ? "Here is a budget proposal based on your recent spending. Pick the categories, adjust any amount, then create them."
                : "Mình đã lập đề xuất ngân sách dựa trên chi tiêu gần đây. Chọn danh mục, sửa số tiền nếu cần rồi bấm Tạo ngân sách đã chọn."
            : ActionsReady(proposed.Count, language);

    private static string NoBudgetProposal(string? language) => language == "en"
        ? "I could not prepare a budget proposal: the matching categories already have a budget for this period, or there is not enough spending history yet."
        : "Mình chưa lập được đề xuất ngân sách: các danh mục phù hợp đã có ngân sách trong kỳ này, hoặc chưa đủ dữ liệu chi tiêu.";

    private static string ActionsReady(int count, string? language) => language == "en"
        ? (count == 1 ? "I've prepared 1 action below. Check it, then press Confirm to save it."
            : $"I've prepared {count} actions below. Check each one, then press Confirm to save it.")
        : (count == 1 ? "Mình đã chuẩn bị 1 thao tác bên dưới. Kiểm tra lại rồi bấm Xác nhận để lưu."
            : $"Mình đã chuẩn bị {count} thao tác bên dưới. Kiểm tra từng mục rồi bấm Xác nhận để lưu.");

    /// <summary>Highlight for a reply that only proposes actions (the model writes no intent tag then).</summary>
    private static string? IntentFor(IReadOnlyList<AIProposedAction> proposals) => proposals.FirstOrDefault()?.Name switch
    {
        AIActionTypes.CreateTransaction or AIActionTypes.CreateCategory => "transaction_help",
        AIActionTypes.CreateBudget or AIActionTypes.ProposeBudgets => "budget_advice",
        AIActionTypes.CreateSavingsGoal or AIActionTypes.ContributeToGoal => "saving_goal",
        _ => null
    };

    private static DateTime AsUtc(DateTime value) =>
        value.Kind == DateTimeKind.Utc ? value : DateTime.SpecifyKind(value, DateTimeKind.Utc);

    private static string CreateTitle(string message) => message.Length <= 60 ? message : $"{message[..57]}...";
}
