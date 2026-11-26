using System.Text.Json;
using backend.DTOs;
using backend.Helpers;
using backend.Models;
using backend.Services.Implementations;
using Microsoft.Extensions.Logging.Abstractions;

namespace backend.Tests;

/// <summary>propose_budgets: the AI suggests several budgets, the user keeps some, they are created together.</summary>
public class AIBudgetProposalTests : DbTestBase
{
    private readonly AIActionService _sut;
    private readonly Guid _messageId;
    private readonly Account _account;
    private readonly Category _food, _transport, _salary;
    private readonly DateOnly _month;

    public AIBudgetProposalTests()
    {
        var cache = TestCache.New();
        var notifications = new FakeNotifications();
        var budgets = new BudgetService(Db, notifications, NullLogger<BudgetService>.Instance, cache);
        var transactions = new TransactionService(Db, budgets, NullLogger<TransactionService>.Instance);
        _sut = new AIActionService(Db, new EncryptionService(new FakeKeys()), transactions, new AccountService(Db),
            new CategoryService(Db, new FakeAudit()), budgets, new FinancialGoalService(Db, notifications, cache));

        var conversation = new AIConversation { UserId = UserId, TitleCipher = [1], TitleNonce = new byte[12], KeyVersion = 1 };
        var message = new AIChatMessage
        {
            ConversationId = conversation.Id, Sequence = 1, Role = ChatMessageRole.Assistant, ContentCipher = [1],
            Nonce = new byte[12], KeyVersion = 1, Status = AIProcessingStatus.Completed
        };
        Db.AIConversations.Add(conversation);
        Db.AIChatMessages.Add(message);
        Db.SaveChanges();
        _messageId = message.Id;

        _account = AddAccount();
        _food = AddCategory("Ăn uống");
        _transport = AddCategory("Di chuyển");
        _salary = AddCategory("Lương", CategoryType.Income);
        var today = FinancialAnalysisService.LocalToday("Asia/Ho_Chi_Minh");
        _month = new DateOnly(today.Year, today.Month, 1);
    }

    private string Period => BudgetPeriod.Format(_month);

    private async Task<IReadOnlyList<AIActionResponse>> Propose(object args)
    {
        var result = await _sut.ProposeAsync(UserId, _messageId, [new AIProposedAction(AIActionTypes.ProposeBudgets, JsonSerializer.SerializeToElement(args))]);
        await Db.SaveChangesAsync();
        Db.ChangeTracker.Clear();
        return result;
    }

    private static object Item(string category, decimal amount, string reason = "r") => new { category, amount, reason };

    [Fact]
    public async Task Propose_KeepsOnlyTheUsersExpenseCategories_MatchedByName()
    {
        var theirs = AddCategory("Của người khác", userId: OtherUserId);
        var action = Assert.Single(await Propose(new
        {
            period = Period,
            budgets = new[] { Item("an uong", 3_000_000m), Item("Lương", 1m), Item("Không có", 1m), Item(theirs.Name, 1m), Item("Ăn uống", 9m) }
        }));
        var item = Assert.Single(action.Payload.Budgets!);           // accent-insensitive match, duplicates and others dropped
        Assert.Equal(_food.Id, item.CategoryId);
        Assert.Equal("Ăn uống", item.CategoryName);
        Assert.Equal(3_000_000m, item.Amount);
        Assert.Equal(AIActionStatus.Pending, action.Status);
        Assert.Empty(Db.Budgets);                                     // proposing saves nothing
    }

    [Fact]
    public async Task Propose_AnInventedIdIsIgnored()
    {
        var action = Assert.Single(await Propose(new
        {
            period = Period,
            budgets = new object[] { new { category_id = Guid.NewGuid().ToString(), category = "Ăn uống", amount = 1_000m, reason = "r" } }
        }));
        Assert.Equal(_food.Id, Assert.Single(action.Payload.Budgets!).CategoryId);
    }

    [Fact]
    public async Task Propose_HistoryFiguresComeFromTheDatabase()
    {
        var day = _month.ToDateTime(new TimeOnly(12, 0), DateTimeKind.Utc);
        foreach (var monthsBack in new[] { 1, 2, 3 }) AddTransaction(_account, _food, 1_200_000m, date: day.AddMonths(-monthsBack));
        AddTransaction(_account, _food, 300_000m, date: day);
        AddTransaction(_account, _salary, 50_000_000m, TransactionType.Income, day.AddMonths(-1)); // income is not spending

        var item = Assert.Single(Assert.Single(await Propose(new { period = Period, budgets = new[] { Item("Ăn uống", 1m) } })).Payload.Budgets!);
        Assert.Equal(1_200_000m, item.AverageSpent);
        Assert.Equal(3, item.HistoryMonths);
        Assert.Equal(300_000m, item.CurrentSpent);
    }

    [Fact]
    public async Task Propose_CategoryWithABudgetInThePeriod_IsLeftOutAndNamed()
    {
        Db.Budgets.Add(new Budget { UserId = UserId, CategoryId = _food.Id, Amount = 1m, StartDate = _month, EndDate = _month.AddMonths(1).AddDays(-1) });
        Db.SaveChanges();
        var action = Assert.Single(await Propose(new { period = Period, budgets = new[] { Item("Ăn uống", 1m), Item("Di chuyển", 2m) } }));
        Assert.Equal(_transport.Id, Assert.Single(action.Payload.Budgets!).CategoryId);
        Assert.Equal(["Ăn uống"], action.Payload.SkippedCategories);
    }

    [Fact]
    public async Task Propose_NothingLeft_CreatesNoCard() =>
        Assert.Empty(await Propose(new { period = Period, budgets = new[] { Item("Không có", 1m) } }));

    [Fact]
    public async Task Propose_PastOrMissingPeriod_BecomesTheCurrentMonth()
    {
        var action = Assert.Single(await Propose(new { period = "2001-01", budgets = new[] { Item("Ăn uống", 1m) } }));
        Assert.Equal(Period, action.Payload.Period);
    }

    [Fact]
    public async Task Confirm_CreatesOnlyTheKeptCategoriesWithTheEditedAmounts()
    {
        var action = Assert.Single(await Propose(new { period = Period, budgets = new[] { Item("Ăn uống", 1_000m), Item("Di chuyển", 2_000m) } }));
        var kept = action.Payload with { Budgets = [new AIBudgetProposalItem(_transport.Id, Amount: 2_500m)] };

        var confirmed = await _sut.ConfirmAsync(UserId, action.Id, kept);

        Assert.Equal(AIActionStatus.Confirmed, confirmed.Status);
        var budget = Assert.Single(Db.Budgets);
        Assert.Equal(_transport.Id, budget.CategoryId);
        Assert.Equal(2_500m, budget.Amount);
        Assert.Equal(_month, budget.StartDate);
        Assert.Equal(budget.Id, Assert.Single(confirmed.Payload.Budgets!).BudgetId);
        Assert.Equal("Di chuyển", confirmed.Payload.Budgets![0].CategoryName); // name kept from the stored proposal
    }

    [Fact]
    public async Task Confirm_ACategoryThatWasNotProposed_IsRejectedAndStaysPending()
    {
        var action = Assert.Single(await Propose(new { period = Period, budgets = new[] { Item("Ăn uống", 1_000m) } }));
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.ConfirmAsync(UserId, action.Id,
            action.Payload with { Budgets = [new AIBudgetProposalItem(_transport.Id, Amount: 1m)] }));
        Assert.Empty(Db.Budgets);
        Db.ChangeTracker.Clear(); // the revert is an ExecuteUpdate: read the row again, not the tracked copy
        Assert.Equal(AIActionStatus.Pending, Db.AIActions.Single().Status);
    }

    [Fact]
    public async Task Confirm_EmptySelectionOrZeroAmount_IsRejected()
    {
        var action = Assert.Single(await Propose(new { period = Period, budgets = new[] { Item("Ăn uống", 1_000m) } }));
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.ConfirmAsync(UserId, action.Id, action.Payload with { Budgets = [] }));
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.ConfirmAsync(UserId, action.Id,
            action.Payload with { Budgets = [new AIBudgetProposalItem(_food.Id, Amount: 0m)] }));
        Assert.Empty(Db.Budgets);
    }

    [Fact]
    public async Task Confirm_WhenABudgetAppearedMeanwhile_NothingIsCreated_AndConfirmingTwiceIsRefused()
    {
        var action = Assert.Single(await Propose(new { period = Period, budgets = new[] { Item("Ăn uống", 1_000m), Item("Di chuyển", 2_000m) } }));
        Db.Budgets.Add(new Budget { UserId = UserId, CategoryId = _food.Id, Amount = 7m, StartDate = _month, EndDate = _month.AddMonths(1).AddDays(-1) });
        Db.SaveChanges();
        Db.ChangeTracker.Clear();

        await Assert.ThrowsAsync<ConflictException>(() => _sut.ConfirmAsync(UserId, action.Id, null));
        Assert.Single(Db.Budgets);                                    // the transport budget was rolled back
        Db.ChangeTracker.Clear();
        Assert.Equal(AIActionStatus.Pending, Db.AIActions.Single().Status);

        Db.Budgets.RemoveRange(Db.Budgets);
        Db.SaveChanges();
        Db.ChangeTracker.Clear();
        await _sut.ConfirmAsync(UserId, action.Id, null);
        Assert.Equal(2, Db.Budgets.Count());
        await Assert.ThrowsAsync<ConflictException>(() => _sut.ConfirmAsync(UserId, action.Id, null));
        Assert.Equal(2, Db.Budgets.Count());
    }

    [Fact]
    public async Task Confirm_AnotherUsersProposal_IsNotFound()
    {
        var action = Assert.Single(await Propose(new { period = Period, budgets = new[] { Item("Ăn uống", 1_000m) } }));
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.ConfirmAsync(OtherUserId, action.Id, null));
        Assert.Empty(Db.Budgets);
    }
}
