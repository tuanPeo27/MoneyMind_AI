using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using backend.DTOs;
using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Middleware;
using backend.Models;
using backend.Services.Implementations;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.IdentityModel.JsonWebTokens;

namespace backend.Tests;

// ---------------------------------------------------------------- fakes

public static class TestCache
{
    public static FinancialContextCache New() => new(new Microsoft.Extensions.Caching.Memory.MemoryCache(
        new Microsoft.Extensions.Caching.Memory.MemoryCacheOptions()));
}

public sealed class FakeActions : IAIActionService
{
    public List<(Guid MessageId, IReadOnlyList<AIProposedAction> Proposals)> Proposed { get; } = [];
    public Dictionary<Guid, IReadOnlyList<AIActionResponse>> Existing { get; } = [];

    public Task<IReadOnlyList<AIActionResponse>> ProposeAsync(Guid userId, Guid messageId,
        IReadOnlyList<AIProposedAction> proposals, CancellationToken cancellationToken = default)
    {
        Proposed.Add((messageId, proposals));
        IReadOnlyList<AIActionResponse> list = proposals.Select(p => new AIActionResponse(Guid.NewGuid(), p.Name,
            AIActionStatus.Pending, new AIActionPayload(), null, DateTime.UtcNow, null)).ToList();
        return Task.FromResult(list);
    }

    public Task<IReadOnlyDictionary<Guid, IReadOnlyList<AIActionResponse>>> GetForMessagesAsync(Guid userId,
        IReadOnlyCollection<Guid> messageIds, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyDictionary<Guid, IReadOnlyList<AIActionResponse>>>(
            Existing.Where(kv => messageIds.Contains(kv.Key)).ToDictionary(kv => kv.Key, kv => kv.Value));

    public Task<AIActionResponse> ConfirmAsync(Guid userId, Guid actionId, AIActionPayload? edited,
        CancellationToken cancellationToken = default) => throw new NotSupportedException();

    public Task<AIActionResponse> CancelAsync(Guid userId, Guid actionId, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();
}

public sealed class FakeOrchestration : IAIOrchestrationService
{
    public Exception? Throw { get; set; }
    public string Reply { get; set; } = "assistant reply";
    public string? Intent { get; set; } = "advice";
    public int? Tokens { get; set; } = 12;
    public IReadOnlyList<AIProposedAction> Actions { get; set; } = [];
    public Func<string, Task>? LastOnDelta { get; private set; }
    public List<(string Message, IReadOnlyList<AIChatTurn> History, string? Language)> Calls { get; } = [];
    public List<string> Modes { get; } = [];

    public Task<AIChatResult> ChatAsync(Guid userId, string message, IReadOnlyList<AIChatTurn> history,
        string? language = null, Func<string, Task>? onDelta = null, string mode = AIChatModes.Chat,
        CancellationToken cancellationToken = default)
    {
        LastOnDelta = onDelta;
        Calls.Add((message, history.ToList(), language));
        Modes.Add(mode);
        if (Throw is not null) throw Throw;
        return Task.FromResult(new AIChatResult(Reply, Intent, Tokens, "gemini", "m1", Actions));
    }

    public AICategorizeResult? CategorizeResult { get; set; }
    public List<IReadOnlyList<AICategoryOption>> CategorizeCalls { get; } = [];

    public Task<AICategorizeResult?> CategorizeAsync(Guid userId, string description, decimal? amount,
        TransactionType type, IReadOnlyList<AICategoryOption> categories, CancellationToken cancellationToken = default)
    {
        CategorizeCalls.Add(categories);
        return Task.FromResult(CategorizeResult);
    }

    public AIInsightResult? InsightResult { get; set; }
    public List<string> InsightFacts { get; } = [];

    public Task<AIInsightResult?> GenerateInsightsAsync(Guid userId, string facts, CancellationToken cancellationToken = default)
    {
        InsightFacts.Add(facts);
        return Task.FromResult(InsightResult);
    }
}

public sealed class FakeAIClient : IAIServiceClient
{
    public Exception? Throw { get; set; }
    public AIChatResult Result { get; set; } = new("hi", "chat", 7, "gemini", "model-x");
    public List<AIChatPayload> Payloads { get; } = [];
    public AICategorizeReply? CategorizeReply { get; set; }
    public AIInsightResult? InsightResult { get; set; }

    public Task<AIChatResult> ChatAsync(AIChatPayload payload, CancellationToken cancellationToken = default)
    {
        Payloads.Add(payload);
        if (Throw is not null) throw Throw;
        return Task.FromResult(Result);
    }

    public List<AIChatPayload> StreamPayloads { get; } = [];
    public List<string> Deltas { get; } = [];

    public async Task<AIChatResult> StreamChatAsync(AIChatPayload payload, Func<string, Task>? onDelta,
        CancellationToken cancellationToken = default)
    {
        StreamPayloads.Add(payload);
        Payloads.Add(payload);
        if (Throw is not null) throw Throw;
        foreach (var delta in Deltas) if (onDelta is not null) await onDelta(delta);
        return Result;
    }

    public List<AICategorizePayload> CategorizePayloads { get; } = [];

    public Task<AICategorizeReply> CategorizeAsync(AICategorizePayload payload, CancellationToken cancellationToken = default)
    {
        CategorizePayloads.Add(payload);
        if (Throw is not null) throw Throw;
        return Task.FromResult(CategorizeReply!);
    }

    public Task<AIInsightResult> GenerateInsightsAsync(AIInsightPayload payload, CancellationToken cancellationToken = default)
    {
        if (Throw is not null) throw Throw;
        return Task.FromResult(InsightResult ?? new AIInsightResult("s", [], [], null, "gemini", "m"));
    }

    public Task<bool> IsHealthyAsync(CancellationToken cancellationToken = default) => Task.FromResult(true);
}

public sealed class FakeAnalysis : IFinancialAnalysisService
{
    public string Context { get; set; } = "{\"ctx\":true}";
    public List<Guid> ContextRequests { get; } = [];

    public Task<string> BuildContextAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        ContextRequests.Add(userId);
        return Task.FromResult(Context);
    }

    public string CaptureContext { get; set; } = "{\"capture\":true}";

    public Task<string> BuildCaptureContextAsync(Guid userId, CancellationToken cancellationToken = default) =>
        Task.FromResult(CaptureContext);

    public Task<FinancialSummary> GetSummaryAsync(Guid userId, DateTime from, DateTime to,
        CancellationToken cancellationToken = default) => throw new NotSupportedException();

    public Task<IReadOnlyList<InsightCandidate>> DetectInsightsAsync(Guid userId,
        CancellationToken cancellationToken = default) => throw new NotSupportedException();
}

public sealed class FakeProcessingLogs : IAIProcessingLogService
{
    public bool Throw { get; set; }
    public List<(Guid? UserId, string TaskType, string? Provider, AIProcessingStatus Status, string? ErrorCode, int? Tokens)> Entries { get; } = [];

    public Task LogAsync(Guid? userId, Guid requestId, string taskType, string? provider, int durationMs,
        AIProcessingStatus status, string? errorCode = null, int? tokenUsage = null,
        CancellationToken cancellationToken = default)
    {
        if (Throw) throw new InvalidOperationException("db down");
        Entries.Add((userId, taskType, provider, status, errorCode, tokenUsage));
        return Task.CompletedTask;
    }

    public Task<PagedResult<AIProcessingLogResponse>> GetPagedAsync(AIProcessingLogQuery query,
        CancellationToken cancellationToken = default) => throw new NotSupportedException();

    public Task<AIUsageStatsResponse> GetStatsAsync(DateTime from, DateTime to,
        CancellationToken cancellationToken = default) => throw new NotSupportedException();
}

public sealed class StubHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> respond) : HttpMessageHandler
{
    public List<(HttpMethod Method, string Path, string Body)> Requests { get; } = [];

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
        Requests.Add((request.Method, request.RequestUri!.AbsolutePath, body));
        return await respond(request);
    }
}

// ---------------------------------------------------------------- AIChatService

public class AIChatServiceTests : DbTestBase
{
    private readonly FakeOrchestration _orchestration = new();
    private FakeActions Actions { get; } = new();
    private readonly UserRequestGate _gate = new();
    private readonly AIChatService _sut;
    private readonly EncryptionService _encryption = new(new FakeKeys());

    public AIChatServiceTests()
    {
        var current = new FakeCurrentUser(UserId, true);
        var quota = new AIQuotaService(Db, current, new FakeAudit());
        _sut = new AIChatService(Db, _encryption, _orchestration, quota, _gate, Actions);
    }

    private Task<SendChatMessageResponse> Send(string text = "hello", Guid? conversationId = null, string? language = null,
        Guid? userId = null) =>
        _sut.SendMessageAsync(userId ?? UserId, new SendChatMessageRequest(conversationId, text, language));

    private void ExhaustQuota()
    {
        Db.Users.Single(u => u.Id == UserId).AIDailyMessageLimit = 10;
        for (var i = 0; i < 10; i++)
            Db.AIProcessingLogs.Add(new AIProcessingLog
            {
                UserId = UserId, RequestId = Guid.NewGuid(), TaskType = AITasks.Chat, Status = AIProcessingStatus.Completed
            });
        Db.SaveChanges();
    }

    // ---- SendMessage ----

    [Fact]
    public async Task Send_NewConversation_ReturnsBothMessagesInOrder()
    {
        var result = await Send("hi there");
        Assert.NotNull(result.ConversationId);
        Assert.Equal(1, result.UserMessage.Sequence);
        Assert.Equal(2, result.AssistantMessage.Sequence);
        Assert.Equal(ChatMessageRole.User, result.UserMessage.Role);
        Assert.Equal(ChatMessageRole.Assistant, result.AssistantMessage.Role);
        Assert.Equal("hi there", result.UserMessage.Content);
        Assert.Equal("assistant reply", result.AssistantMessage.Content);
        Assert.Equal("advice", result.AssistantMessage.Intent);
    }

    [Fact]
    public async Task Send_StoresContentEncrypted()
    {
        await Send("my secret salary");
        Assert.All(Db.AIChatMessages.ToList(), m =>
            Assert.DoesNotContain("secret", Encoding.UTF8.GetString(m.ContentCipher)));
        Assert.Equal(2, Db.AIChatMessages.Count());
    }

    [Fact]
    public async Task Send_TrimsTheMessage()
    {
        var result = await Send("   padded   ");
        Assert.Equal("padded", result.UserMessage.Content);
        Assert.Equal("padded", _orchestration.Calls[0].Message);
    }

    [Fact]
    public async Task Send_ShortMessageBecomesTheTitle()
    {
        var result = await Send("short title");
        var page = await _sut.GetConversationsAsync(UserId, new PagingQuery());
        Assert.Equal("short title", Assert.Single(page.Items).Title);
        Assert.Equal(result.ConversationId, page.Items[0].Id);
    }

    [Fact]
    public async Task Send_LongMessageTitleIsCutTo60Characters()
    {
        await Send(new string('a', 100));
        var title = (await _sut.GetConversationsAsync(UserId, new PagingQuery())).Items[0].Title;
        Assert.Equal(60, title.Length);
        Assert.EndsWith("...", title);
    }

    [Fact]
    public async Task Send_MessageOfExactly60Characters_IsNotCut()
    {
        await Send(new string('b', 60));
        Assert.Equal(60, (await _sut.GetConversationsAsync(UserId, new PagingQuery())).Items[0].Title.Length);
        Assert.DoesNotContain("...", (await _sut.GetConversationsAsync(UserId, new PagingQuery())).Items[0].Title);
    }

    [Fact]
    public async Task Send_FirstMessageHasEmptyHistory()
    {
        await Send();
        Assert.Empty(_orchestration.Calls[0].History);
    }

    [Fact]
    public async Task Send_FollowUpPassesPreviousTurnsAsHistory()
    {
        var first = await Send("question one");
        _orchestration.Reply = "answer two";
        await Send("question two", first.ConversationId);
        var history = _orchestration.Calls[1].History;
        Assert.Equal([("user", "question one"), ("assistant", "assistant reply")], history.Select(t => (t.Role, t.Content)));
    }

    [Fact]
    public async Task Send_FollowUpContinuesTheSequence()
    {
        var first = await Send();
        var second = await Send("again", first.ConversationId);
        Assert.Equal(3, second.UserMessage.Sequence);
        Assert.Equal(4, second.AssistantMessage.Sequence);
        Assert.Equal(first.ConversationId, second.ConversationId);
        Assert.Single(Db.AIConversations);
    }

    [Theory]
    [InlineData("vi")]
    [InlineData("en")]
    [InlineData(null)]
    public async Task Send_PassesLanguageToTheOrchestrator(string? language)
    {
        await Send(language: language);
        Assert.Equal(language, _orchestration.Calls[0].Language);
    }

    [Fact]
    public async Task Send_ReturnsUpdatedUsage()
    {
        Db.Users.Single(u => u.Id == UserId).AIDailyMessageLimit = 10;
        Db.SaveChanges();
        var result = await Send();
        Assert.Equal(10, result.Usage.DailyLimit);
        Assert.False(result.Usage.IsUnlimited);
    }

    [Fact]
    public async Task Send_StoresTokenUsageOnTheAssistantMessage()
    {
        await Send();
        Assert.Equal(12, Db.AIChatMessages.Single(m => m.Role == ChatMessageRole.Assistant).TokenUsage);
    }

    [Fact]
    public async Task Send_UnknownConversation_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => Send(conversationId: Guid.NewGuid()));

    [Fact]
    public async Task Send_ConversationOfAnotherUser_ThrowsNotFound()
    {
        var theirs = await Send(userId: OtherUserId);
        await Assert.ThrowsAsync<NotFoundException>(() => Send(conversationId: theirs.ConversationId));
    }

    [Fact]
    public async Task Send_ArchivedConversation_ThrowsBadRequest()
    {
        var first = await Send();
        await _sut.SetArchivedAsync(UserId, first.ConversationId!.Value, true);
        await Assert.ThrowsAsync<BadRequestException>(() => Send("more", first.ConversationId));
    }

    [Fact]
    public async Task Send_DeletedConversation_ThrowsNotFound()
    {
        var first = await Send();
        await _sut.DeleteConversationAsync(UserId, first.ConversationId!.Value);
        await Assert.ThrowsAsync<NotFoundException>(() => Send("more", first.ConversationId));
    }

    [Fact]
    public async Task Send_QuotaExhausted_ThrowsTooManyRequestsAndStoresNothing()
    {
        ExhaustQuota();
        await Assert.ThrowsAsync<TooManyRequestsException>(() => Send());
        Assert.Empty(Db.AIConversations);
        Assert.Empty(Db.AIChatMessages);
        Assert.Empty(_orchestration.Calls);
    }

    [Fact]
    public async Task Send_WhileAnotherRequestRuns_ThrowsConflict()
    {
        using var held = _gate.TryEnter(UserId);
        await Assert.ThrowsAsync<ConflictException>(() => Send());
        Assert.Empty(_orchestration.Calls);
    }

    [Fact]
    public async Task Send_ReleasesTheGateAfterwards()
    {
        await Send();
        await Send();
    }

    [Fact]
    public async Task Send_ReleasesTheGateEvenWhenTheAIFails()
    {
        _orchestration.Throw = new ServiceUnavailableException("down");
        await Assert.ThrowsAsync<ServiceUnavailableException>(() => Send());
        _orchestration.Throw = null;
        await Send();
    }

    [Fact]
    public async Task Send_AIFailureOnNewConversation_RemovesTheConversationAndMessages()
    {
        _orchestration.Throw = new ServiceUnavailableException("down");
        await Assert.ThrowsAsync<ServiceUnavailableException>(() => Send());
        Assert.Empty(Db.AIConversations);
        Assert.Empty(Db.AIChatMessages);
    }

    [Fact]
    public async Task Send_AIFailureOnExistingConversation_RemovesOnlyTheNewUserMessage()
    {
        var first = await Send();
        _orchestration.Throw = new ServiceUnavailableException("down");
        await Assert.ThrowsAsync<ServiceUnavailableException>(() => Send("again", first.ConversationId));
        Assert.Equal(2, Db.AIChatMessages.Count());
        Assert.Single(Db.AIConversations);
    }

    [Fact]
    public async Task Send_OnlyCountsCompletedMessagesInHistory()
    {
        var first = await Send();
        var conversationId = first.ConversationId!.Value;
        var encrypted = await _encryption.EncryptAsync(UserId, "never completed");
        Db.AIChatMessages.Add(new AIChatMessage
        {
            ConversationId = conversationId, Sequence = 99, Role = ChatMessageRole.User, ContentCipher = encrypted.Cipher,
            Nonce = encrypted.Nonce, KeyVersion = encrypted.KeyVersion, Status = AIProcessingStatus.Failed
        });
        Db.SaveChanges();
        await Send("next", conversationId);
        Assert.DoesNotContain(_orchestration.Calls[1].History, t => t.Content == "never completed");
    }

    // ---- Listing ----

    [Fact]
    public async Task GetConversations_NewestActivityFirst()
    {
        var a = await Send("first");
        var b = await Send("second");
        await Send("touch first", a.ConversationId);
        var page = await _sut.GetConversationsAsync(UserId, new PagingQuery());
        Assert.Equal([a.ConversationId, b.ConversationId], page.Items.Select(c => (Guid?)c.Id));
    }

    [Fact]
    public async Task GetConversations_OnlyOwnAndNotDeleted()
    {
        var mine = await Send("mine");
        var gone = await Send("gone");
        await Send("theirs", userId: OtherUserId);
        await _sut.DeleteConversationAsync(UserId, gone.ConversationId!.Value);
        var page = await _sut.GetConversationsAsync(UserId, new PagingQuery());
        Assert.Equal(mine.ConversationId, Assert.Single(page.Items).Id);
        Assert.Equal(1, page.TotalCount);
    }

    [Fact]
    public async Task GetConversations_Pages()
    {
        for (var i = 0; i < 5; i++) await Send("c" + i);
        var page = await _sut.GetConversationsAsync(UserId, new PagingQuery { Page = 2, PageSize = 2 });
        Assert.Equal(2, page.Items.Count);
        Assert.Equal(3, page.TotalPages);
    }

    [Fact]
    public async Task GetConversations_TimestampsAreUtc()
    {
        await Send();
        var item = (await _sut.GetConversationsAsync(UserId, new PagingQuery())).Items[0];
        Assert.Equal(DateTimeKind.Utc, item.CreatedAt.Kind);
        Assert.Equal(DateTimeKind.Utc, item.UpdatedAt.Kind);
    }

    [Fact]
    public async Task GetMessages_ReturnsDecryptedMessagesOldestFirst()
    {
        var first = await Send("q1");
        await Send("q2", first.ConversationId);
        var page = await _sut.GetMessagesAsync(UserId, first.ConversationId!.Value, new PagingQuery());
        Assert.Equal([1, 2, 3, 4], page.Items.Select(m => m.Sequence));
        Assert.Equal("q1", page.Items[0].Content);
        Assert.Equal(4, page.TotalCount);
    }

    [Fact]
    public async Task GetMessages_PagingTakesTheNewestMessagesFirst()
    {
        var first = await Send("q1");
        await Send("q2", first.ConversationId);
        var page = await _sut.GetMessagesAsync(UserId, first.ConversationId!.Value, new PagingQuery { PageSize = 2 });
        Assert.Equal([3, 4], page.Items.Select(m => m.Sequence));
    }

    [Fact]
    public async Task GetMessages_OtherUsersConversation_ThrowsNotFound()
    {
        var theirs = await Send(userId: OtherUserId);
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _sut.GetMessagesAsync(UserId, theirs.ConversationId!.Value, new PagingQuery()));
    }

    // ---- Rename / archive / delete ----

    [Fact]
    public async Task Rename_ChangesTheTitle()
    {
        var first = await Send("old");
        var result = await _sut.RenameConversationAsync(UserId, first.ConversationId!.Value, new RenameConversationRequest("  New name  "));
        Assert.Equal("New name", result.Title);
        Assert.Equal("New name", (await _sut.GetConversationsAsync(UserId, new PagingQuery())).Items[0].Title);
    }

    [Fact]
    public async Task Rename_OtherUsersConversation_ThrowsNotFound()
    {
        var theirs = await Send(userId: OtherUserId);
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _sut.RenameConversationAsync(UserId, theirs.ConversationId!.Value, new RenameConversationRequest("x")));
    }

    [Fact]
    public async Task Archive_TogglesTheFlag()
    {
        var first = await Send();
        await _sut.SetArchivedAsync(UserId, first.ConversationId!.Value, true);
        Assert.True((await _sut.GetConversationsAsync(UserId, new PagingQuery())).Items[0].IsArchived);
        await _sut.SetArchivedAsync(UserId, first.ConversationId!.Value, false);
        Assert.False((await _sut.GetConversationsAsync(UserId, new PagingQuery())).Items[0].IsArchived);
    }

    [Fact]
    public async Task Archive_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.SetArchivedAsync(UserId, Guid.NewGuid(), true));

    [Fact]
    public async Task Delete_IsSoftAndHidesTheConversation()
    {
        var first = await Send();
        await _sut.DeleteConversationAsync(UserId, first.ConversationId!.Value);
        Assert.Single(Db.AIConversations);
        Assert.NotNull(Db.AIConversations.Single().DeletedAt);
        Assert.Empty((await _sut.GetConversationsAsync(UserId, new PagingQuery())).Items);
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _sut.GetMessagesAsync(UserId, first.ConversationId!.Value, new PagingQuery()));
    }

    [Fact]
    public async Task Delete_OtherUsersConversation_ThrowsNotFound()
    {
        var theirs = await Send(userId: OtherUserId);
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.DeleteConversationAsync(UserId, theirs.ConversationId!.Value));
    }

    // ---- Feedback ----

    [Fact]
    public async Task Feedback_StoresRating()
    {
        var result = await Send();
        await _sut.SubmitFeedbackAsync(UserId, result.AssistantMessage.Id, new ChatFeedbackRequest("up", "  great  "));
        var feedback = Assert.Single(Db.AIFeedbacks);
        Assert.Equal("up", feedback.Rating);
        Assert.Equal("great", feedback.FeedbackText);
    }

    [Fact]
    public async Task Feedback_BlankTextIsStoredAsNull()
    {
        var result = await Send();
        await _sut.SubmitFeedbackAsync(UserId, result.AssistantMessage.Id, new ChatFeedbackRequest("down", "   "));
        Assert.Null(Db.AIFeedbacks.Single().FeedbackText);
    }

    [Fact]
    public async Task Feedback_SecondSubmissionUpdatesTheFirst()
    {
        var result = await Send();
        await _sut.SubmitFeedbackAsync(UserId, result.AssistantMessage.Id, new ChatFeedbackRequest("up", null));
        await _sut.SubmitFeedbackAsync(UserId, result.AssistantMessage.Id, new ChatFeedbackRequest("down", "changed my mind"));
        var feedback = Assert.Single(Db.AIFeedbacks);
        Assert.Equal("down", feedback.Rating);
    }

    [Fact]
    public async Task Feedback_OnAUserMessage_ThrowsNotFound()
    {
        var result = await Send();
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _sut.SubmitFeedbackAsync(UserId, result.UserMessage.Id, new ChatFeedbackRequest("up", null)));
    }

    [Fact]
    public async Task Feedback_OnAnotherUsersMessage_ThrowsNotFound()
    {
        var theirs = await Send(userId: OtherUserId);
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _sut.SubmitFeedbackAsync(UserId, theirs.AssistantMessage.Id, new ChatFeedbackRequest("up", null)));
    }

    [Fact]
    public async Task Feedback_OnADeletedConversation_ThrowsNotFound()
    {
        var result = await Send();
        await _sut.DeleteConversationAsync(UserId, result.ConversationId!.Value);
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _sut.SubmitFeedbackAsync(UserId, result.AssistantMessage.Id, new ChatFeedbackRequest("up", null)));
    }

    [Fact]
    public async Task Feedback_UnknownMessage_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _sut.SubmitFeedbackAsync(UserId, Guid.NewGuid(), new ChatFeedbackRequest("up", null)));
}

// ---------------------------------------------------------------- AIOrchestrationService

public class AIOrchestrationServiceTests
{
    private readonly FakeAIClient _client = new();
    private readonly FakeAnalysis _analysis = new();
    private readonly FakeProcessingLogs _logs = new();
    private readonly AIOrchestrationService _sut;
    private static readonly Guid User = Guid.NewGuid();

    public AIOrchestrationServiceTests() =>
        _sut = new AIOrchestrationService(_client, _analysis, _logs, NullLogger<AIOrchestrationService>.Instance);

    [Fact]
    public async Task Chat_ReturnsTheClientResult()
    {
        var result = await _sut.ChatAsync(User, "hello", []);
        Assert.Equal("hi", result.Content);
    }

    [Fact]
    public async Task Chat_SendsMessageHistoryContextAndLanguage()
    {
        var history = new[] { new AIChatTurn("user", "before") };
        await _sut.ChatAsync(User, "hello", history, "vi");
        var payload = Assert.Single(_client.Payloads);
        Assert.Equal("hello", payload.Message);
        Assert.Equal(history, payload.History);
        Assert.Equal("{\"ctx\":true}", payload.FinancialContext);
        Assert.Equal("vi", payload.Language);
        Assert.Equal([User], _analysis.ContextRequests);
    }

    [Fact]
    public async Task Chat_Success_LogsCompletedWithProviderAndModel()
    {
        await _sut.ChatAsync(User, "hello", []);
        var entry = Assert.Single(_logs.Entries);
        Assert.Equal(AITasks.Chat, entry.TaskType);
        Assert.Equal(AIProcessingStatus.Completed, entry.Status);
        Assert.Equal("gemini/model-x", entry.Provider);
        Assert.Equal(7, entry.Tokens);
        Assert.Null(entry.ErrorCode);
        Assert.Equal(User, entry.UserId);
    }

    [Fact]
    public async Task Chat_WithoutModel_LogsProviderOnly()
    {
        _client.Result = new AIChatResult("hi", null, null, "gemini");
        await _sut.ChatAsync(User, "hello", []);
        Assert.Equal("gemini", _logs.Entries[0].Provider);
    }

    [Fact]
    public async Task Chat_ClientFailure_LogsFailedAndThrowsServiceUnavailable()
    {
        _client.Throw = new HttpRequestException("boom");
        await Assert.ThrowsAsync<ServiceUnavailableException>(() => _sut.ChatAsync(User, "hello", []));
        var entry = Assert.Single(_logs.Entries);
        Assert.Equal(AIProcessingStatus.Failed, entry.Status);
        Assert.Equal("HttpRequestException", entry.ErrorCode);
    }

    [Fact]
    public async Task Chat_ServiceUnavailableFromClient_IsRethrownAsIs()
    {
        var original = new ServiceUnavailableException("custom message");
        _client.Throw = original;
        var thrown = await Assert.ThrowsAsync<ServiceUnavailableException>(() => _sut.ChatAsync(User, "hello", []));
        Assert.Same(original, thrown);
        Assert.Equal(AIProcessingStatus.Failed, _logs.Entries[0].Status);
    }

    [Fact]
    public async Task Chat_UnexpectedFailure_HidesInternalDetailsFromTheCaller()
    {
        _client.Throw = new InvalidOperationException("secret internal detail");
        var ex = await Assert.ThrowsAsync<ServiceUnavailableException>(() => _sut.ChatAsync(User, "hello", []));
        Assert.DoesNotContain("secret", ex.Message);
    }

    [Fact]
    public async Task Chat_Cancellation_IsRethrownWithoutLogging()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        _client.Throw = new OperationCanceledException(cts.Token);
        await Assert.ThrowsAsync<OperationCanceledException>(() => _sut.ChatAsync(User, "hello", [], null, null, cancellationToken: cts.Token));
        Assert.Empty(_logs.Entries);
    }

    [Fact]
    public async Task Chat_LogFailureDoesNotBreakASuccessfulChat()
    {
        _logs.Throw = true;
        var result = await _sut.ChatAsync(User, "hello", []);
        Assert.Equal("hi", result.Content);
    }

    [Fact]
    public async Task Chat_LogFailureDoesNotHideTheOriginalError()
    {
        _logs.Throw = true;
        _client.Throw = new HttpRequestException("boom");
        await Assert.ThrowsAsync<ServiceUnavailableException>(() => _sut.ChatAsync(User, "hello", []));
    }

    [Fact]
    public async Task Chat_ContextFailure_LogsFailedToo()
    {
        var failing = new AIOrchestrationService(_client, new ThrowingAnalysis(), _logs, NullLogger<AIOrchestrationService>.Instance);
        await Assert.ThrowsAsync<ServiceUnavailableException>(() => failing.ChatAsync(User, "hello", []));
        Assert.Equal(AIProcessingStatus.Failed, _logs.Entries[0].Status);
    }

    [Fact]
    public async Task Categorize_SendsShortIdsAndMapsTheAnswerBackToTheGuid()
    {
        _client.CategorizeReply = new AICategorizeReply("2", 0.9m, "r", 31, "gemini", "lite");
        var options = new[] { new AICategoryOption(Guid.NewGuid(), "Food"), new AICategoryOption(Guid.NewGuid(), "Taxi") };
        var result = await _sut.CategorizeAsync(User, "grab", 50m, TransactionType.Expense, options);
        var payload = Assert.Single(_client.CategorizePayloads);
        Assert.Equal("Expense", payload.Type);
        Assert.Equal(["1", "2"], payload.Categories.Select(c => c.Id));
        Assert.Equal(options[1].Id, result!.CategoryId);
        Assert.Equal(0.9m, result.Confidence);
        Assert.Equal(AITasks.Categorize, _logs.Entries[0].TaskType);
        Assert.Equal(31, _logs.Entries[0].Tokens);
    }

    [Theory]
    [InlineData("9")]
    [InlineData("none")]
    [InlineData(null)]
    public async Task Categorize_UnknownIdMeansNoCategory(string? id)
    {
        _client.CategorizeReply = new AICategorizeReply(id, 0.9m, null, 1, "gemini", "m");
        var result = await _sut.CategorizeAsync(User, "x", null, TransactionType.Expense, [new AICategoryOption(Guid.NewGuid(), "Food")]);
        Assert.Null(result!.CategoryId);
        Assert.Equal(0m, result.Confidence);
    }

    [Fact]
    public async Task Categorize_FailureReturnsNullAndLogsFailed()
    {
        _client.Throw = new ServiceUnavailableException("down");
        var result = await _sut.CategorizeAsync(User, "x", null, TransactionType.Expense, [new AICategoryOption(Guid.NewGuid(), "Food")]);
        Assert.Null(result);
        Assert.Equal(AIProcessingStatus.Failed, _logs.Entries[0].Status);
    }

    [Fact]
    public async Task Chat_CaptureModeUsesTheSmallContext()
    {
        await _sut.ChatAsync(User, "cafe 35k", [], "vi", null, AIChatModes.Capture);
        var payload = Assert.Single(_client.StreamPayloads);
        Assert.Equal(AIChatModes.Capture, payload.Mode);
        Assert.Equal("{\"capture\":true}", payload.FinancialContext);
    }

    [Fact]
    public async Task Insights_LoggedAsWeeklyInsight()
    {
        var result = await _sut.GenerateInsightsAsync(User, "{}");
        Assert.Equal("s", result!.Summary);
        Assert.Equal(AITasks.WeeklyInsight, _logs.Entries[0].TaskType);
    }

    private sealed class ThrowingAnalysis : IFinancialAnalysisService
    {
        public Task<string> BuildContextAsync(Guid userId, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("db");
        public Task<string> BuildCaptureContextAsync(Guid userId, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("db");
        public Task<FinancialSummary> GetSummaryAsync(Guid userId, DateTime from, DateTime to, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
        public Task<IReadOnlyList<InsightCandidate>> DetectInsightsAsync(Guid userId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }
}

// ---------------------------------------------------------------- AIServiceClient

public class AIServiceClientTests
{
    private static (AIServiceClient Client, StubHandler Handler) Create(Func<HttpRequestMessage, Task<HttpResponseMessage>> respond)
    {
        var handler = new StubHandler(respond);
        var http = new HttpClient(handler) { BaseAddress = new Uri("http://ai.local/") };
        return (new AIServiceClient(http, NullLogger<AIServiceClient>.Instance), handler);
    }

    private static Task<HttpResponseMessage> Json(string json, HttpStatusCode status = HttpStatusCode.OK) =>
        Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") });

    private static AIChatPayload Payload() => new("hello", [new AIChatTurn("user", "x")], "{}", "vi");

    private static string Done(string text) =>
        "{\"type\":\"delta\",\"text\":\"" + text + "\"}\n{\"type\":\"done\",\"intent\":\"x\",\"tokenUsage\":1,\"provider\":\"gemini\",\"model\":\"m\"}\n";

    [Fact]
    public async Task Chat_PostsToTheChatEndpointWithCamelCaseJson()
    {
        var (client, handler) = Create(_ => Json(Done("hi")));
        await client.ChatAsync(Payload());
        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("/v1/chat/stream", request.Path);
        using var doc = JsonDocument.Parse(request.Body);
        Assert.Equal("hello", doc.RootElement.GetProperty("message").GetString());
        Assert.Equal("vi", doc.RootElement.GetProperty("language").GetString());
        Assert.Equal("user", doc.RootElement.GetProperty("history")[0].GetProperty("role").GetString());
    }

    [Fact]
    public async Task Chat_ParsesTheResponse()
    {
        var (client, _) = Create(_ => Json(
            "{\"type\":\"delta\",\"text\":\"xin \"}\n{\"type\":\"delta\",\"text\":\"chào\"}\n{\"type\":\"done\",\"intent\":\"greet\",\"tokenUsage\":9,\"provider\":\"gemini\",\"model\":\"m\"}\n"));
        var result = await client.ChatAsync(Payload());
        Assert.Equal("xin chào", result.Content);
        Assert.Equal("greet", result.Intent);
        Assert.Equal(9, result.TokenUsage);
        Assert.Equal("gemini", result.Provider);
        Assert.Equal("m", result.Model);
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest)]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.BadGateway)]
    public async Task Chat_ErrorStatus_ThrowsServiceUnavailable(HttpStatusCode status)
    {
        var (client, _) = Create(_ => Json("{}", status));
        await Assert.ThrowsAsync<ServiceUnavailableException>(() => client.ChatAsync(Payload()));
    }

    [Fact]
    public async Task Chat_NullBody_ThrowsServiceUnavailable()
    {
        var (client, _) = Create(_ => Json("null"));
        await Assert.ThrowsAsync<ServiceUnavailableException>(() => client.ChatAsync(Payload()));
    }

    [Fact]
    public async Task Categorize_PostsToTheCategorizeEndpoint()
    {
        var (client, handler) = Create(_ => Json(
            "{\"categoryId\":\"1\",\"confidence\":0.8,\"reason\":\"r\",\"tokenUsage\":5,\"provider\":\"gemini\",\"model\":\"lite\"}"));
        var reply = await client.CategorizeAsync(new AICategorizePayload("grab", 50m, "Expense", [new AICategoryChoice("1", "Taxi")]));
        var request = Assert.Single(handler.Requests);
        Assert.Equal("/v1/categorize", request.Path);
        using var doc = JsonDocument.Parse(request.Body);
        Assert.Equal("1", doc.RootElement.GetProperty("categories")[0].GetProperty("id").GetString());
        Assert.Equal(("1", 0.8m, "lite"), (reply.CategoryId, reply.Confidence, reply.Model));
    }

    [Fact]
    public async Task GenerateInsights_PostsFactsAndParsesTheSummary()
    {
        var (client, handler) = Create(_ => Json(
            "{\"summary\":\"ok\",\"items\":[{\"title\":\"t\",\"content\":\"c\",\"severity\":\"warning\"}]," +
            "\"recommendations\":[{\"title\":\"r\",\"description\":\"d\",\"action\":{\"name\":\"create_budget\",\"category\":\"Food\",\"amount\":100}}]}"));
        var result = await client.GenerateInsightsAsync(new AIInsightPayload("{\"week\":1}"));
        Assert.Equal("/v1/insights", Assert.Single(handler.Requests).Path);
        Assert.Equal("ok", result.Summary);
        Assert.Equal("warning", Assert.Single(result.Items).Severity);
        Assert.Equal(100m, Assert.Single(result.Recommendations).Action!.Amount);
    }

    [Fact]
    public async Task Categorize_ErrorStatus_ThrowsServiceUnavailable()
    {
        var (client, _) = Create(_ => Json("{}", HttpStatusCode.ServiceUnavailable));
        await Assert.ThrowsAsync<ServiceUnavailableException>(() =>
            client.CategorizeAsync(new AICategorizePayload("x", null, "Expense", [])));
    }

    [Fact]
    public async Task IsHealthy_TrueOn200()
    {
        var (client, handler) = Create(_ => Json("{}"));
        Assert.True(await client.IsHealthyAsync());
        Assert.Equal("/health", handler.Requests[0].Path);
        Assert.Equal(HttpMethod.Get, handler.Requests[0].Method);
    }

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    public async Task IsHealthy_FalseOnErrorStatus(HttpStatusCode status)
    {
        var (client, _) = Create(_ => Json("{}", status));
        Assert.False(await client.IsHealthyAsync());
    }

    [Fact]
    public async Task IsHealthy_FalseWhenTheServiceIsUnreachable()
    {
        var (client, _) = Create(_ => throw new HttpRequestException("refused"));
        Assert.False(await client.IsHealthyAsync());
    }

    [Fact]
    public async Task IsHealthy_FalseOnTimeout()
    {
        var (client, _) = Create(_ => throw new TaskCanceledException("timeout"));
        Assert.False(await client.IsHealthyAsync());
    }
}

// ---------------------------------------------------------------- FinancialAnalysisService

public class FinancialAnalysisServiceTests : DbTestBase
{
    private readonly FinancialAnalysisService _sut;
    private readonly Account _account;
    private readonly Category _food;
    private readonly Category _salary;

    private static DateTime MonthStart => new(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc);
    private static DateTime Today => DateTime.UtcNow.Date;

    public FinancialAnalysisServiceTests()
    {
        _sut = new FinancialAnalysisService(Db, TestCache.New());
        _account = AddAccount(initial: 10_000m);
        _food = AddCategory("Food");
        _salary = AddCategory("Salary", CategoryType.Income);
    }

    private Budget AddBudget(Category category, decimal amount, DateOnly? start = null, DateOnly? end = null, byte threshold = 80)
    {
        var budget = new Budget
        {
            UserId = UserId, CategoryId = category.Id, Amount = amount,
            StartDate = start ?? DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-5),
            EndDate = end ?? DateOnly.FromDateTime(DateTime.UtcNow).AddDays(5), AlertThreshold = threshold
        };
        Db.Budgets.Add(budget);
        Db.SaveChanges();
        return budget;
    }

    // ---- GetSummary ----

    [Fact]
    public async Task Summary_TotalsIncomeAndExpenseWithinThePeriod()
    {
        AddTransaction(_account, _salary, 1_000m, TransactionType.Income, Today.AddHours(1));
        AddTransaction(_account, _food, 300m, date: Today.AddHours(2));
        AddTransaction(_account, _food, 999m, date: Today.AddDays(-400));
        var summary = await _sut.GetSummaryAsync(UserId, Today, Today.AddDays(1));
        Assert.Equal(1_000m, summary.TotalIncome);
        Assert.Equal(300m, summary.TotalExpense);
    }

    [Fact]
    public async Task Summary_EndIsExclusive()
    {
        AddTransaction(_account, _food, 50m, date: Today.AddDays(1));
        Assert.Equal(0m, (await _sut.GetSummaryAsync(UserId, Today, Today.AddDays(1))).TotalExpense);
    }

    [Fact]
    public async Task Summary_TopCategoriesAreExpenseOnlySortedByAmount()
    {
        var transport = AddCategory("Transport");
        AddTransaction(_account, _food, 100m, date: Today.AddHours(1));
        AddTransaction(_account, transport, 300m, date: Today.AddHours(1));
        AddTransaction(_account, _salary, 9_000m, TransactionType.Income, Today.AddHours(1));
        var summary = await _sut.GetSummaryAsync(UserId, Today, Today.AddDays(1));
        Assert.Equal(["Transport", "Food"], summary.TopExpenseCategories.Select(c => c.CategoryName));
    }

    [Fact]
    public async Task Summary_TopCategoriesAreCappedAtTen()
    {
        for (var i = 0; i < 12; i++) AddTransaction(_account, AddCategory("Cat" + i), 10m + i, date: Today.AddHours(1));
        var summary = await _sut.GetSummaryAsync(UserId, Today, Today.AddDays(1));
        Assert.Equal(10, summary.TopExpenseCategories.Count);
        Assert.Equal(21m, summary.TopExpenseCategories[0].Amount);
    }

    [Fact]
    public async Task Summary_OtherUsersTransactionsAreIgnored()
    {
        var theirs = AddAccount(OtherUserId, "Theirs");
        var system = AddCategory("Shared", system: true);
        AddTransaction(theirs, system, 500m, date: Today.AddHours(1));
        Assert.Equal(0m, (await _sut.GetSummaryAsync(UserId, Today, Today.AddDays(1))).TotalExpense);
    }

    [Fact]
    public async Task Summary_BudgetsActiveTodayShowSpentAndPercent()
    {
        AddBudget(_food, 1_000m);
        AddTransaction(_account, _food, 250m, date: Today.AddDays(-1));
        var summary = await _sut.GetSummaryAsync(UserId, Today, Today.AddDays(1));
        var budget = Assert.Single(summary.Budgets);
        Assert.Equal("Food", budget.CategoryName);
        Assert.Equal(250m, budget.Spent);
        Assert.Equal(25m, budget.UsedPercent);
    }

    [Fact]
    public async Task Summary_BudgetSpentCoversTheWholeBudgetPeriodNotJustTheRequestedOne()
    {
        AddBudget(_food, 1_000m);
        AddTransaction(_account, _food, 400m, date: Today.AddDays(-3));
        var summary = await _sut.GetSummaryAsync(UserId, Today, Today.AddDays(1));
        Assert.Equal(400m, summary.Budgets[0].Spent);
    }

    [Fact]
    public async Task Summary_ExpiredAndFutureBudgetsAreNotListed()
    {
        var todayDate = DateOnly.FromDateTime(DateTime.UtcNow);
        AddBudget(_food, 100m, todayDate.AddDays(-30), todayDate.AddDays(-10));
        var transport = AddCategory("Transport");
        AddBudget(transport, 100m, todayDate.AddDays(10), todayDate.AddDays(20));
        Assert.Empty((await _sut.GetSummaryAsync(UserId, Today, Today.AddDays(1))).Budgets);
    }

    [Fact]
    public async Task Summary_GoalsAreActiveOnlyOrderedByDeadline()
    {
        Db.FinancialGoals.AddRange(
            new FinancialGoal { UserId = UserId, Name = "Later", TargetAmount = 10m, Deadline = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(60) },
            new FinancialGoal { UserId = UserId, Name = "Sooner", TargetAmount = 10m, Deadline = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(5) },
            new FinancialGoal { UserId = UserId, Name = "Done", TargetAmount = 10m, Status = FinancialGoalStatus.Completed });
        Db.SaveChanges();
        var summary = await _sut.GetSummaryAsync(UserId, Today, Today.AddDays(1));
        Assert.Equal(["Sooner", "Later"], summary.Goals.Select(g => g.Name));
    }

    [Fact]
    public async Task Summary_GoalsAreCappedAtTen()
    {
        for (var i = 0; i < 13; i++)
            Db.FinancialGoals.Add(new FinancialGoal { UserId = UserId, Name = "G" + i, TargetAmount = 10m });
        Db.SaveChanges();
        Assert.Equal(10, (await _sut.GetSummaryAsync(UserId, Today, Today.AddDays(1))).Goals.Count);
    }

    // ---- BuildContext ----

    [Fact]
    public async Task Context_IsValidJsonWithAccountsAndTotals()
    {
        AddTransaction(_account, _salary, 2_000m, TransactionType.Income, Today.AddHours(1));
        AddTransaction(_account, _food, 500m, date: Today.AddHours(2));
        using var doc = JsonDocument.Parse(await _sut.BuildContextAsync(UserId));
        var root = doc.RootElement;
        Assert.Equal(2_000m, root.GetProperty("totalIncome").GetDecimal());
        Assert.Equal(500m, root.GetProperty("totalExpense").GetDecimal());
        Assert.Equal(1_500m, root.GetProperty("netSavings").GetDecimal());
        Assert.Equal(11_500m, root.GetProperty("accounts")[0].GetProperty("balance").GetDecimal());
    }

    [Fact]
    public async Task Context_NeverContainsTransactionDescriptionsOrEmail()
    {
        AddTransaction(_account, _food, 500m, date: Today.AddHours(2), description: "secret-description-123");
        var json = await _sut.BuildContextAsync(UserId);
        Assert.DoesNotContain("secret-description-123", json);
        Assert.DoesNotContain("user@test.com", json);
    }

    [Fact]
    public async Task Context_ExcludesArchivedAccounts()
    {
        AddAccount(name: "Old", archived: true);
        using var doc = JsonDocument.Parse(await _sut.BuildContextAsync(UserId));
        Assert.Equal(1, doc.RootElement.GetProperty("accounts").GetArrayLength());
    }

    [Fact]
    public async Task Context_BalanceSubtractsGoalContributions()
    {
        var goal = new FinancialGoal { UserId = UserId, Name = "G", TargetAmount = 10_000m };
        Db.FinancialGoals.Add(goal);
        Db.GoalContributions.Add(new GoalContribution { GoalId = goal.Id, AccountId = _account.Id, Amount = 2_000m });
        Db.SaveChanges();
        using var doc = JsonDocument.Parse(await _sut.BuildContextAsync(UserId));
        Assert.Equal(8_000m, doc.RootElement.GetProperty("accounts")[0].GetProperty("balance").GetDecimal());
    }

    [Fact]
    public async Task Context_OnlyContainsTheUsersOwnAccounts()
    {
        AddAccount(OtherUserId, "Theirs");
        using var doc = JsonDocument.Parse(await _sut.BuildContextAsync(UserId));
        Assert.Equal(1, doc.RootElement.GetProperty("accounts").GetArrayLength());
    }

    // ---- DetectInsights ----

    [Fact]
    public async Task Insights_BudgetAtThreshold_IsAWarning()
    {
        AddBudget(_food, 1_000m);
        AddTransaction(_account, _food, 850m, date: Today.AddHours(1));
        var insight = Assert.Single(await _sut.DetectInsightsAsync(UserId), i => i.Type == "BudgetThreshold");
        Assert.Equal(AIInsightSeverity.Warning, insight.Severity);
        Assert.Contains("Food", insight.Title);
    }

    [Fact]
    public async Task Insights_BudgetExceeded_IsCritical()
    {
        AddBudget(_food, 1_000m);
        AddTransaction(_account, _food, 1_200m, date: Today.AddHours(1));
        var insight = Assert.Single(await _sut.DetectInsightsAsync(UserId), i => i.Type == "BudgetThreshold");
        Assert.Equal(AIInsightSeverity.Critical, insight.Severity);
    }

    [Fact]
    public async Task Insights_BudgetExactlyAtLimit_IsStillAWarning()
    {
        AddBudget(_food, 1_000m);
        AddTransaction(_account, _food, 1_000m, date: Today.AddHours(1));
        var insight = Assert.Single(await _sut.DetectInsightsAsync(UserId), i => i.Type == "BudgetThreshold");
        Assert.Equal(AIInsightSeverity.Warning, insight.Severity);
    }

    [Fact]
    public async Task Insights_BudgetBelowEightyPercent_ProducesNothing()
    {
        AddBudget(_food, 1_000m);
        AddTransaction(_account, _food, 790m, date: Today.AddHours(1));
        Assert.DoesNotContain(await _sut.DetectInsightsAsync(UserId), i => i.Type == "BudgetThreshold");
    }

    [Fact]
    public async Task Insights_ExpenseAboveIncome_FlagsNegativeCashFlow()
    {
        AddTransaction(_account, _salary, 1_000m, TransactionType.Income, MonthStart.AddHours(1));
        AddTransaction(_account, _food, 1_500m, date: MonthStart.AddHours(2));
        Assert.Contains(await _sut.DetectInsightsAsync(UserId), i => i.Type == "NegativeCashFlow");
    }

    [Fact]
    public async Task Insights_ExpenseBelowIncome_DoesNotFlagCashFlow()
    {
        AddTransaction(_account, _salary, 1_000m, TransactionType.Income, MonthStart.AddHours(1));
        AddTransaction(_account, _food, 500m, date: MonthStart.AddHours(2));
        Assert.DoesNotContain(await _sut.DetectInsightsAsync(UserId), i => i.Type == "NegativeCashFlow");
    }

    [Fact]
    public async Task Insights_ExpenseWithoutAnyIncome_DoesNotFlagCashFlow()
    {
        AddTransaction(_account, _food, 500m, date: MonthStart.AddHours(2));
        Assert.DoesNotContain(await _sut.DetectInsightsAsync(UserId), i => i.Type == "NegativeCashFlow");
    }

    [Fact]
    public async Task Insights_NoData_IsEmpty() => Assert.Empty(await _sut.DetectInsightsAsync(UserId));
}

// ---------------------------------------------------------------- small infrastructure pieces

public class UserRequestGateTests
{
    [Fact]
    public void FirstEntryIsGranted() => Assert.NotNull(new UserRequestGate().TryEnter(Guid.NewGuid()));

    [Fact]
    public void SecondEntryForTheSameUserIsRefused()
    {
        var gate = new UserRequestGate();
        var user = Guid.NewGuid();
        using var first = gate.TryEnter(user);
        Assert.Null(gate.TryEnter(user));
    }

    [Fact]
    public void DifferentUsersDoNotBlockEachOther()
    {
        var gate = new UserRequestGate();
        using var a = gate.TryEnter(Guid.NewGuid());
        using var b = gate.TryEnter(Guid.NewGuid());
        Assert.NotNull(a);
        Assert.NotNull(b);
    }

    [Fact]
    public void DisposingTheTokenFreesTheSlot()
    {
        var gate = new UserRequestGate();
        var user = Guid.NewGuid();
        gate.TryEnter(user)!.Dispose();
        Assert.NotNull(gate.TryEnter(user));
    }

    [Fact]
    public void DisposingTwiceReleasesOnlyOnce()
    {
        var gate = new UserRequestGate();
        var user = Guid.NewGuid();
        var first = gate.TryEnter(user)!;
        first.Dispose();
        first.Dispose();
        using var second = gate.TryEnter(user);
        Assert.NotNull(second);
        Assert.Null(gate.TryEnter(user));
    }

    [Fact]
    public async Task OnlyOneOfManyParallelRequestsGetsIn()
    {
        var gate = new UserRequestGate();
        var user = Guid.NewGuid();
        var results = await Task.WhenAll(Enumerable.Range(0, 50).Select(_ => Task.Run(() => gate.TryEnter(user))));
        Assert.Single(results, r => r is not null);
    }
}

public class CurrentUserServiceTests
{
    private static CurrentUserService Create(DefaultHttpContext? context)
    {
        var accessor = new HttpContextAccessor { HttpContext = context };
        return new CurrentUserService(accessor);
    }

    private static DefaultHttpContext Authenticated(Guid id, params string[] roles)
    {
        var claims = new List<Claim> { new(JwtRegisteredClaimNames.Sub, id.ToString()) };
        claims.AddRange(roles.Select(r => new Claim(ClaimTypes.Role, r)));
        return new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) };
    }

    [Fact]
    public void UserId_ReadsTheSubClaim()
    {
        var id = Guid.NewGuid();
        Assert.Equal(id, Create(Authenticated(id)).UserId);
    }

    [Fact]
    public void UserId_NoHttpContext_IsNull() => Assert.Null(Create(null).UserId);

    [Fact]
    public void UserId_AnonymousRequest_IsNull() => Assert.Null(Create(new DefaultHttpContext()).UserId);

    [Fact]
    public void UserId_NonGuidSubject_IsNull()
    {
        var context = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(JwtRegisteredClaimNames.Sub, "abc")], "test"))
        };
        Assert.Null(Create(context).UserId);
    }

    [Fact]
    public void RequiredUserId_Anonymous_ThrowsUnauthorized() =>
        Assert.Throws<UnauthorizedAppException>(() => Create(new DefaultHttpContext()).RequiredUserId);

    [Fact]
    public void RequiredUserId_Authenticated_ReturnsId()
    {
        var id = Guid.NewGuid();
        Assert.Equal(id, Create(Authenticated(id)).RequiredUserId);
    }

    [Fact]
    public void IsAdmin_TrueForAdminRole() =>
        Assert.True(Create(Authenticated(Guid.NewGuid(), Roles.Admin)).IsAdmin);

    [Fact]
    public void IsAdmin_FalseForPlainUser() =>
        Assert.False(Create(Authenticated(Guid.NewGuid(), Roles.User)).IsAdmin);

    [Fact]
    public void IsAdmin_NoHttpContext_IsFalse() => Assert.False(Create(null).IsAdmin);

    [Fact]
    public void IpAddress_ReadsTheRemoteAddress()
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = IPAddress.Parse("10.1.2.3");
        Assert.Equal("10.1.2.3", Create(context).IpAddress);
    }

    [Fact]
    public void IpAddress_MissingIsNull() => Assert.Null(Create(new DefaultHttpContext()).IpAddress);

    [Fact]
    public void UserAgent_IsReadFromTheHeader()
    {
        var context = new DefaultHttpContext();
        context.Request.Headers.UserAgent = "Mozilla/5.0";
        Assert.Equal("Mozilla/5.0", Create(context).UserAgent);
    }

    [Fact]
    public void UserAgent_IsCutTo500Characters()
    {
        var context = new DefaultHttpContext();
        context.Request.Headers.UserAgent = new string('x', 800);
        Assert.Equal(500, Create(context).UserAgent!.Length);
    }

    [Fact]
    public void UserAgent_MissingIsNull() => Assert.Null(Create(new DefaultHttpContext()).UserAgent);
}

public class ExceptionHandlingMiddlewareTests
{
    private static DefaultHttpContext NewContext()
    {
        var context = new DefaultHttpContext { RequestServices = new ServiceCollection().BuildServiceProvider() };
        context.Response.Body = new MemoryStream();
        return context;
    }

    private static async Task<(int Status, JsonDocument Body)> Run(RequestDelegate next, DefaultHttpContext? context = null)
    {
        context ??= NewContext();
        await new ExceptionHandlingMiddleware(next, NullLogger<ExceptionHandlingMiddleware>.Instance).InvokeAsync(context);
        context.Response.Body.Position = 0;
        var text = await new StreamReader(context.Response.Body).ReadToEndAsync();
        return (context.Response.StatusCode, text.Length == 0 ? JsonDocument.Parse("{}") : JsonDocument.Parse(text));
    }

    [Fact]
    public async Task NoException_PassesThrough()
    {
        var (status, _) = await Run(_ => Task.CompletedTask);
        Assert.Equal(200, status);
    }

    [Theory]
    [InlineData(400, "bad")]
    [InlineData(404, "missing")]
    [InlineData(409, "clash")]
    public async Task AppException_BecomesItsStatusCodeAndMessage(int code, string message)
    {
        AppException ex = code switch
        {
            400 => new BadRequestException(message),
            404 => new NotFoundException(message),
            _ => new ConflictException(message)
        };
        var (status, body) = await Run(_ => throw ex);
        Assert.Equal(code, status);
        Assert.Equal(message, body.RootElement.GetProperty("detail").GetString());
        Assert.Equal(code, body.RootElement.GetProperty("status").GetInt32());
    }

    [Fact]
    public async Task Unauthorized_Is401() =>
        Assert.Equal(401, (await Run(_ => throw new UnauthorizedAppException())).Status);

    [Fact]
    public async Task Forbidden_Is403() =>
        Assert.Equal(403, (await Run(_ => throw new ForbiddenException())).Status);

    [Fact]
    public async Task TooManyRequests_Is429() =>
        Assert.Equal(429, (await Run(_ => throw new TooManyRequestsException("slow down"))).Status);

    [Fact]
    public async Task ServiceUnavailable_Is503() =>
        Assert.Equal(503, (await Run(_ => throw new ServiceUnavailableException("down"))).Status);

    [Fact]
    public async Task UnexpectedException_Is500WithAGenericMessage()
    {
        var (status, body) = await Run(_ => throw new InvalidOperationException("db password is hunter2"));
        Assert.Equal(500, status);
        Assert.DoesNotContain("hunter2", body.RootElement.ToString());
        Assert.Equal("An unexpected error occurred.", body.RootElement.GetProperty("detail").GetString());
    }

    [Fact]
    public async Task ClientDisconnect_IsSwallowed()
    {
        var context = NewContext();
        using var cts = new CancellationTokenSource();
        context.RequestAborted = cts.Token;
        cts.Cancel();
        var (status, _) = await Run(_ => throw new OperationCanceledException(), context);
        Assert.Equal(200, status);
    }

    [Fact]
    public async Task CancellationWithoutDisconnect_Is500()
    {
        var (status, _) = await Run(_ => throw new OperationCanceledException());
        Assert.Equal(500, status);
    }

    [Fact]
    public async Task ResponseAlreadyStarted_IsNotOverwritten()
    {
        var context = NewContext();
        await context.Response.WriteAsync("partial");
        await context.Response.Body.FlushAsync();
        var middleware = new ExceptionHandlingMiddleware(_ => throw new BadRequestException("late"),
            NullLogger<ExceptionHandlingMiddleware>.Instance);
        // DefaultHttpContext never reports HasStarted, so only verify the call does not throw.
        await middleware.InvokeAsync(context);
    }
}

public class AIRequestValidationTests
{
    private static string Text(int n) => new('a', n);

    [Fact] public void SendMessage_Valid_Passes() => Assert.True(DtoValidationTests.IsValid(new SendChatMessageRequest(null, "hi")));
    [Fact] public void SendMessage_Empty_Fails() => Assert.False(DtoValidationTests.IsValid(new SendChatMessageRequest(null, "")));
    [Fact] public void SendMessage_4000Chars_Passes() => Assert.True(DtoValidationTests.IsValid(new SendChatMessageRequest(null, Text(4000))));
    [Fact] public void SendMessage_4001Chars_Fails() => Assert.False(DtoValidationTests.IsValid(new SendChatMessageRequest(null, Text(4001))));

    [Theory]
    [InlineData("vi", true)]
    [InlineData("en", true)]
    [InlineData(null, true)]
    [InlineData("fr", false)]
    [InlineData("VI", false)]
    [InlineData("vie", false)]
    public void SendMessage_Language(string? language, bool valid) =>
        Assert.Equal(valid, DtoValidationTests.IsValid(new SendChatMessageRequest(null, "hi", language)));

    [Fact] public void Rename_Valid_Passes() => Assert.True(DtoValidationTests.IsValid(new RenameConversationRequest("t")));
    [Fact] public void Rename_Empty_Fails() => Assert.False(DtoValidationTests.IsValid(new RenameConversationRequest("")));
    [Fact] public void Rename_201Chars_Fails() => Assert.False(DtoValidationTests.IsValid(new RenameConversationRequest(Text(201))));

    [Theory]
    [InlineData("up", true)]
    [InlineData("down", true)]
    [InlineData("meh", false)]
    [InlineData("UP", false)]
    [InlineData("", false)]
    public void Feedback_Rating(string rating, bool valid) =>
        Assert.Equal(valid, DtoValidationTests.IsValid(new ChatFeedbackRequest(rating, null)));

    [Fact] public void Feedback_Text2001Chars_Fails() =>
        Assert.False(DtoValidationTests.IsValid(new ChatFeedbackRequest("up", Text(2001))));

    [Theory]
    [InlineData("Daily", true)]
    [InlineData("Weekly", true)]
    [InlineData("Monthly", true)]
    [InlineData("Off", true)]
    [InlineData("Hourly", false)]
    [InlineData("", false)]
    public void AISettings_ReportFrequency(string frequency, bool valid) =>
        Assert.Equal(valid, DtoValidationTests.IsValid(new UpdateAISettingsRequest(true, frequency, 80, true, 30)));

    [Theory]
    [InlineData(0, false)]
    [InlineData(1, true)]
    [InlineData(100, true)]
    [InlineData(101, false)]
    public void AISettings_AlertThreshold(byte threshold, bool valid) =>
        Assert.Equal(valid, DtoValidationTests.IsValid(new UpdateAISettingsRequest(true, "Daily", threshold, true, 30)));

    [Theory]
    [InlineData(0, false)]
    [InlineData(1, true)]
    [InlineData(3650, true)]
    [InlineData(3651, false)]
    public void AISettings_RetentionDays(int days, bool valid) =>
        Assert.Equal(valid, DtoValidationTests.IsValid(new UpdateAISettingsRequest(true, "Daily", 80, true, days)));
}
