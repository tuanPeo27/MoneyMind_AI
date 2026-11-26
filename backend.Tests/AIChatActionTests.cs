using System.Text.Json;
using backend.DTOs;
using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Models;
using backend.Services.Implementations;
using backend.Services.Interfaces;
using Microsoft.Extensions.Logging.Abstractions;

namespace backend.Tests;

// ---------------------------------------------------------------- chat with proposed actions + streaming

public class AIChatActionTests : DbTestBase
{
    private readonly FakeOrchestration _orchestration = new();
    private readonly FakeActions _actions = new();
    private readonly AIChatService _sut;

    public AIChatActionTests()
    {
        var quota = new AIQuotaService(Db, new FakeCurrentUser(UserId, true), new FakeAudit());
        _sut = new AIChatService(Db, new EncryptionService(new FakeKeys()), _orchestration, quota, new UserRequestGate(), _actions);
    }

    private static AIProposedAction Act(string name) => new(name, JsonSerializer.SerializeToElement(new { }));

    private Task<SendChatMessageResponse> Send(string language = "vi") =>
        _sut.SendMessageAsync(UserId, new SendChatMessageRequest(null, "hi", language));

    [Fact]
    public async Task ProposedActions_AreAttachedToTheAssistantMessage()
    {
        _orchestration.Actions = [Act(AIActionTypes.CreateBudget)];
        var result = await Send();
        var action = Assert.Single(result.AssistantMessage.Actions);
        Assert.Equal(AIActionTypes.CreateBudget, action.Type);
        Assert.Equal(result.AssistantMessage.Id, _actions.Proposed.Single().MessageId);
    }

    [Fact]
    public async Task UnknownActionNames_AreDroppedBeforeProposing()
    {
        _orchestration.Actions = [Act("drop_table"), Act(AIActionTypes.CreateCategory)];
        await Send();
        var proposals = _actions.Proposed.Single().Proposals;
        Assert.Equal([AIActionTypes.CreateCategory], proposals.Select(p => p.Name));
    }

    [Fact]
    public async Task MoreThanFiveActions_AreCapped()
    {
        _orchestration.Actions = Enumerable.Range(0, 9).Select(_ => Act(AIActionTypes.CreateCategory)).ToList();
        await Send();
        Assert.Equal(AIActionTypes.MaxPerMessage, _actions.Proposed.Single().Proposals.Count);
    }

    [Fact]
    public async Task ReplyWithOnlyActions_GetsAnExplanationInTheUsersLanguage()
    {
        _orchestration.Reply = "";
        _orchestration.Actions = [Act(AIActionTypes.CreateCategory)];
        Assert.Contains("1 thao tác", (await Send("vi")).AssistantMessage.Content);
        Assert.Contains("1 action", (await Send("en")).AssistantMessage.Content);
    }

    [Fact]
    public async Task ReplyWithSeveralActions_MentionsTheCount()
    {
        _orchestration.Reply = "";
        _orchestration.Actions = [Act(AIActionTypes.CreateCategory), Act(AIActionTypes.CreateBudget), Act(AIActionTypes.CreateSavingsGoal)];
        Assert.Contains("3 thao tác", (await Send("vi")).AssistantMessage.Content);
        Assert.Contains("3 actions", (await Send("en")).AssistantMessage.Content);
    }

    [Fact]
    public async Task EmptyReplyWithoutActions_IsServiceUnavailableAndStoresNothing()
    {
        _orchestration.Reply = "";
        await Assert.ThrowsAsync<ServiceUnavailableException>(() => Send());
        Assert.Empty(Db.AIConversations);
        Assert.Empty(Db.AIChatMessages);
    }

    [Theory]
    [InlineData(AIActionTypes.CreateTransaction, "transaction_help")]
    [InlineData(AIActionTypes.CreateCategory, "transaction_help")]
    [InlineData(AIActionTypes.CreateBudget, "budget_advice")]
    [InlineData(AIActionTypes.CreateSavingsGoal, "saving_goal")]
    [InlineData(AIActionTypes.ContributeToGoal, "saving_goal")]
    public async Task ActionOnlyReply_GetsAnIntentFromTheFirstAction(string action, string intent)
    {
        _orchestration.Reply = "";
        _orchestration.Intent = null;
        _orchestration.Actions = [Act(action)];
        Assert.Equal(intent, (await Send()).AssistantMessage.Intent);
    }

    [Fact]
    public async Task ModelIntent_WinsOverTheActionIntent()
    {
        _orchestration.Intent = "spending_analysis";
        _orchestration.Actions = [Act(AIActionTypes.CreateBudget)];
        Assert.Equal("spending_analysis", (await Send()).AssistantMessage.Intent);
    }

    [Fact]
    public async Task EarlierProposalsAndTheirOutcomeAreShownToTheModel()
    {
        _orchestration.Actions = [Act(AIActionTypes.CreateCategory)];
        var first = await Send();
        _actions.Existing[first.AssistantMessage.Id] =
        [
            new AIActionResponse(Guid.NewGuid(), AIActionTypes.CreateCategory, AIActionStatus.Confirmed,
                new AIActionPayload(Name: "Pets"), null, DateTime.UtcNow, DateTime.UtcNow)
        ];
        _orchestration.Actions = [];
        await _sut.SendMessageAsync(UserId, new SendChatMessageRequest(first.ConversationId, "next", "vi"));

        var assistantTurn = _orchestration.Calls.Last().History.Last(t => t.Role == "assistant");
        Assert.Contains("create_category", assistantTurn.Content);
        Assert.Contains("Confirmed", assistantTurn.Content);
    }

    [Fact]
    public async Task GetMessages_IncludesTheActionsOfAssistantMessages()
    {
        _orchestration.Actions = [Act(AIActionTypes.CreateCategory)];
        var sent = await Send();
        _actions.Existing[sent.AssistantMessage.Id] =
        [
            new AIActionResponse(Guid.NewGuid(), AIActionTypes.CreateCategory, AIActionStatus.Pending,
                new AIActionPayload(), null, DateTime.UtcNow, null)
        ];
        var page = await _sut.GetMessagesAsync(UserId, sent.ConversationId!.Value, new PagingQuery());
        Assert.Single(page.Items.Single(m => m.Role == ChatMessageRole.Assistant).Actions);
        Assert.Empty(page.Items.Single(m => m.Role == ChatMessageRole.User).Actions);
    }

    [Fact]
    public async Task Callbacks_ReceiveTheStartedConversationAndTheDeltas()
    {
        Guid? started = null;
        var deltas = new List<string>();
        var callbacks = new ChatStreamCallbacks(
            (id, _) => { started = id; return Task.CompletedTask; },
            d => { deltas.Add(d); return Task.CompletedTask; });
        var result = await _sut.SendMessageAsync(UserId, new SendChatMessageRequest(null, "hi", "vi"), callbacks);
        Assert.Equal(result.ConversationId, started);
        Assert.Empty(deltas);
        Assert.Same(callbacks.OnDelta, _orchestration.LastOnDelta);
    }
}

public class AIServiceClientStreamTests
{
    private static (AIServiceClient Client, StubHandler Handler) Create(string body, System.Net.HttpStatusCode status = System.Net.HttpStatusCode.OK)
    {
        var handler = new StubHandler(_ => Task.FromResult(new HttpResponseMessage(status)
            { Content = new StringContent(body, System.Text.Encoding.UTF8, "application/x-ndjson") }));
        var http = new HttpClient(handler) { BaseAddress = new Uri("http://ai.local/") };
        return (new AIServiceClient(http, NullLogger<AIServiceClient>.Instance), handler);
    }

    private static AIChatPayload Payload() => new("hello", [], "{}", "vi");

    private const string Done = "{\"type\":\"done\",\"intent\":\"budget_advice\",\"tokenUsage\":4,\"provider\":\"gemini\",\"model\":\"m\"}\n";

    [Fact]
    public async Task DeltasAreJoinedTrimmedAndForwardedInOrder()
    {
        var (client, _) = Create("{\"type\":\"delta\",\"text\":\" Xin \"}\n{\"type\":\"delta\",\"text\":\"chào \"}\n" + Done);
        var seen = new List<string>();
        var result = await client.StreamChatAsync(Payload(), d => { seen.Add(d); return Task.CompletedTask; });
        Assert.Equal("Xin chào", result.Content);
        Assert.Equal([" Xin ", "chào "], seen);
        Assert.Equal("budget_advice", result.Intent);
        Assert.Equal(4, result.TokenUsage);
        Assert.Equal("m", result.Model);
    }

    [Fact]
    public async Task ActionEventsBecomeProposedActionsWithTheirArguments()
    {
        var (client, _) = Create("{\"type\":\"action\",\"name\":\"create_budget\",\"args\":{\"amount\":5,\"category\":\"Food\"}}\n" + Done);
        var result = await client.StreamChatAsync(Payload(), null);
        var action = Assert.Single(result.Actions!);
        Assert.Equal("create_budget", action.Name);
        Assert.Equal(5, action.Args.GetProperty("amount").GetInt32());
        Assert.Equal("", result.Content);
    }

    [Fact]
    public async Task ActionWithoutAName_IsIgnored()
    {
        var (client, _) = Create("{\"type\":\"action\",\"args\":{}}\n" + Done);
        Assert.Empty((await client.StreamChatAsync(Payload(), null)).Actions!);
    }

    [Fact]
    public async Task BlankLinesAndUnknownEventTypesAreSkipped()
    {
        var (client, _) = Create("\n   \n{\"type\":\"ping\"}\n{\"type\":\"delta\",\"text\":\"ok\"}\n" + Done);
        Assert.Equal("ok", (await client.StreamChatAsync(Payload(), null)).Content);
    }

    [Fact]
    public async Task EmptyDeltasAreNotForwarded()
    {
        var (client, _) = Create("{\"type\":\"delta\",\"text\":\"\"}\n" + Done);
        var calls = 0;
        await client.StreamChatAsync(Payload(), _ => { calls++; return Task.CompletedTask; });
        Assert.Equal(0, calls);
    }

    [Fact]
    public async Task ErrorEvent_IsServiceUnavailable()
    {
        var (client, _) = Create("{\"type\":\"delta\",\"text\":\"par\"}\n{\"type\":\"error\",\"message\":\"boom\"}\n");
        await Assert.ThrowsAsync<ServiceUnavailableException>(() => client.StreamChatAsync(Payload(), null));
    }

    [Fact]
    public async Task StreamEndingWithoutDone_IsServiceUnavailable()
    {
        var (client, _) = Create("{\"type\":\"delta\",\"text\":\"par\"}\n");
        await Assert.ThrowsAsync<ServiceUnavailableException>(() => client.StreamChatAsync(Payload(), null));
    }

    [Fact]
    public async Task NonSuccessStatus_IsServiceUnavailable()
    {
        var (client, _) = Create("{}", System.Net.HttpStatusCode.ServiceUnavailable);
        await Assert.ThrowsAsync<ServiceUnavailableException>(() => client.StreamChatAsync(Payload(), null));
    }

    [Fact]
    public async Task PostsTheCamelCasePayloadToTheStreamEndpoint()
    {
        var (client, handler) = Create(Done);
        await client.StreamChatAsync(Payload(), null);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("/v1/chat/stream", request.Path);
        using var doc = JsonDocument.Parse(request.Body);
        Assert.Equal("hello", doc.RootElement.GetProperty("message").GetString());
        Assert.True(doc.RootElement.TryGetProperty("financialContext", out _));
    }
}