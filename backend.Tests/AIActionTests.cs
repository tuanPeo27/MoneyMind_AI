using System.Text.Json;
using backend.Data;
using backend.DTOs;
using backend.Helpers;
using backend.Models;
using backend.Services.Implementations;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Logging.Abstractions;

namespace backend.Tests;

// ---------------------------------------------------------------- AIActionService

public class AIActionServiceTests : DbTestBase
{
    private readonly AIActionService _sut;
    private readonly FinancialContextCache _cache = TestCache.New();
    private readonly Guid _messageId;

    public AIActionServiceTests()
    {
        var notifications = new FakeNotifications();
        var budgets = new BudgetService(Db, notifications, NullLogger<BudgetService>.Instance, _cache);
        var transactions = new TransactionService(Db, budgets, NullLogger<TransactionService>.Instance);
        _sut = new AIActionService(Db, new EncryptionService(new FakeKeys()), transactions, new AccountService(Db),
            new CategoryService(Db, new FakeAudit()), budgets, new FinancialGoalService(Db, notifications, _cache));

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
    }

    private static AIProposedAction Proposal(string name, object args) =>
        new(name, JsonSerializer.SerializeToElement(args));

    private async Task<AIActionResponse> ProposeOne(string name, object args)
    {
        var result = await _sut.ProposeAsync(UserId, _messageId, [Proposal(name, args)]);
        await Db.SaveChangesAsync();
        // Confirm runs in a later request, so nothing is tracked yet (ExecuteUpdate does not refresh tracked entities).
        Db.ChangeTracker.Clear();
        return Assert.Single(result);
    }

    // ---- propose ----

    [Fact]
    public async Task Propose_NoProposals_ReturnsNothing() =>
        Assert.Empty(await _sut.ProposeAsync(UserId, _messageId, []));

    [Fact]
    public async Task Propose_IgnoresUnknownActionTypes()
    {
        var result = await _sut.ProposeAsync(UserId, _messageId, [Proposal("delete_everything", new { })]);
        Assert.Empty(result);
        Assert.Empty(Db.ChangeTracker.Entries<AIAction>());
    }

    [Fact]
    public async Task Propose_KeepsAtMostFiveActions()
    {
        var many = Enumerable.Range(0, 8).Select(i => Proposal(AIActionTypes.CreateCategory, new { name = "C" + i })).ToList();
        Assert.Equal(AIActionTypes.MaxPerMessage, (await _sut.ProposeAsync(UserId, _messageId, many)).Count);
    }

    // ---- create_account ----

    [Theory]
    [InlineData("Vietcombank", null, "Bank")]
    [InlineData("MoMo", null, "EWallet")]
    [InlineData("Ví ZaloPay", null, "EWallet")]
    [InlineData("Tiền mặt 2", null, "Cash")]
    [InlineData("Techcombank", "EWallet", "EWallet")]
    public async Task ProposeAccount_UsesTheGivenTypeOrGuessesItFromTheName(string name, string? type, string expected)
    {
        var action = await ProposeOne(AIActionTypes.CreateAccount, new { name, account_type = type });
        Assert.Equal(expected, action.Payload.AccountType);
        Assert.Equal(0m, action.Payload.InitialBalance);
    }

    [Fact]
    public async Task ConfirmAccount_CreatesTheAccountWithItsOpeningBalance()
    {
        var action = await ProposeOne(AIActionTypes.CreateAccount,
            new { name = "Vietcombank", account_type = "Bank", initial_balance = 2_000_000 });
        var confirmed = await _sut.ConfirmAsync(UserId, action.Id, null);
        var account = await Db.Accounts.AsNoTracking().SingleAsync(a => a.Id == confirmed.ResultId);
        Assert.Equal(("Vietcombank", AccountType.Bank, 2_000_000m, UserId),
            (account.Name, account.AccountType, account.InitialBalance, account.UserId));
    }

    [Fact]
    public async Task ConfirmAccount_NegativeBalanceIsRejected()
    {
        var action = await ProposeOne(AIActionTypes.CreateAccount, new { name = "Vietcombank", account_type = "Bank" });
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.ConfirmAsync(UserId, action.Id,
            action.Payload with { InitialBalance = -1 }));
        Assert.Equal(AIActionStatus.Pending, (await Db.AIActions.AsNoTracking().SingleAsync()).Status);
    }

    [Fact]
    public async Task Propose_DropsACategoryNamedAfterAnAccount()
    {
        AddAccount(name: "Vietcombank");
        var result = await _sut.ProposeAsync(UserId, _messageId, [
            Proposal(AIActionTypes.CreateCategory, new { name = "vietcombank", type = "Income" }),
            Proposal(AIActionTypes.CreateAccount, new { name = "MoMo" }),
            Proposal(AIActionTypes.CreateCategory, new { name = "Momo", type = "Expense" }),
            Proposal(AIActionTypes.CreateCategory, new { name = "Thú cưng", type = "Expense" }),
        ]);
        Assert.Equal([AIActionTypes.CreateAccount, AIActionTypes.CreateCategory], result.Select(a => a.Type));
        Assert.Equal("Thú cưng", result[1].Payload.Name);
    }

    [Fact]
    public async Task ConfirmTransaction_FindsAnAccountCreatedInTheSameReply()
    {
        var salary = AddCategory("Lương", CategoryType.Income);
        AddAccount(name: "Tiền mặt");
        var proposed = await _sut.ProposeAsync(UserId, _messageId, [
            Proposal(AIActionTypes.CreateAccount, new { name = "Vietcombank", account_type = "Bank" }),
            Proposal(AIActionTypes.CreateTransaction, new { type = "Income", amount = 5_000_000, category = "Lương", account = "Vietcombank" }),
        ]);
        await Db.SaveChangesAsync();
        Db.ChangeTracker.Clear();
        Assert.Null(proposed[1].Payload.AccountId); // the account does not exist yet

        var account = await _sut.ConfirmAsync(UserId, proposed[0].Id, null);
        var transaction = await _sut.ConfirmAsync(UserId, proposed[1].Id, null);
        Assert.Equal(account.ResultId, transaction.Payload.AccountId);
        Assert.Equal(salary.Id, transaction.Payload.CategoryId);
    }

    [Fact]
    public async Task Propose_IsPendingAndNotSavedUntilTheCallerSaves()
    {
        await _sut.ProposeAsync(UserId, _messageId, [Proposal(AIActionTypes.CreateCategory, new { name = "Pets" })]);
        Assert.Equal(0, await Db.AIActions.AsNoTracking().CountAsync());
        await Db.SaveChangesAsync();
        Assert.Equal(AIActionStatus.Pending, (await Db.AIActions.AsNoTracking().SingleAsync()).Status);
    }

    [Fact]
    public async Task Propose_StoresThePayloadEncrypted()
    {
        await ProposeOne(AIActionTypes.CreateCategory, new { name = "SecretCategory" });
        var row = await Db.AIActions.AsNoTracking().SingleAsync();
        Assert.DoesNotContain("SecretCategory", System.Text.Encoding.UTF8.GetString(row.PayloadCipher));
    }

    [Fact]
    public async Task Propose_Transaction_MatchesCategoryAndOnlyAccountIgnoringCaseAndAccents()
    {
        var account = AddAccount(name: "Ví chính");
        var category = AddCategory("Ăn uống");
        var action = await ProposeOne(AIActionTypes.CreateTransaction,
            new { type = "expense", amount = 50000, category = "an uong", description = "pho" });
        Assert.Equal(category.Id, action.Payload.CategoryId);
        Assert.Equal(account.Id, action.Payload.AccountId);
        Assert.Equal("Expense", action.Payload.Type);
        Assert.Equal(50000m, action.Payload.Amount);
        Assert.Equal(AIActionStatus.Pending, action.Status);
    }

    [Fact]
    public async Task Propose_Transaction_WithSeveralAccountsLeavesTheAccountForTheUser()
    {
        AddAccount(name: "A");
        AddAccount(name: "B");
        AddCategory("Food");
        var action = await ProposeOne(AIActionTypes.CreateTransaction, new { amount = 10, category = "Food" });
        Assert.Null(action.Payload.AccountId);
        Assert.NotNull(action.Payload.CategoryId);
    }

    [Fact]
    public async Task Propose_Transaction_NamedAccountIsMatched()
    {
        AddAccount(name: "A");
        var b = AddAccount(name: "B");
        var action = await ProposeOne(AIActionTypes.CreateTransaction, new { amount = 10, account = "b" });
        Assert.Equal(b.Id, action.Payload.AccountId);
    }

    [Fact]
    public async Task Propose_Transaction_IncomeOnlyMatchesIncomeCategories()
    {
        AddCategory("Salary", CategoryType.Expense);
        var income = AddCategory("Salary", CategoryType.Income);
        var action = await ProposeOne(AIActionTypes.CreateTransaction, new { type = "Income", amount = 1, category = "Salary" });
        Assert.Equal(income.Id, action.Payload.CategoryId);
    }

    [Fact]
    public async Task Propose_Transaction_UnknownCategoryStaysUnresolved()
    {
        var action = await ProposeOne(AIActionTypes.CreateTransaction, new { amount = 5, category = "Nonexistent" });
        Assert.Null(action.Payload.CategoryId);
        Assert.Equal("Nonexistent", action.Payload.CategoryName);
    }

    [Fact]
    public async Task Propose_Transaction_NeverMatchesAnotherUsersCategory()
    {
        AddCategory("Private", userId: OtherUserId);
        var action = await ProposeOne(AIActionTypes.CreateTransaction, new { amount = 5, category = "Private" });
        Assert.Null(action.Payload.CategoryId);
    }

    [Fact]
    public async Task Propose_Transaction_NeverMatchesAnotherUsersAccount()
    {
        AddAccount(OtherUserId, "Theirs");
        var action = await ProposeOne(AIActionTypes.CreateTransaction, new { amount = 5, account = "Theirs" });
        Assert.Null(action.Payload.AccountId);
    }

    [Fact]
    public async Task Propose_Transaction_SkipsArchivedAccountsAndInactiveCategories()
    {
        AddAccount(name: "Old", archived: true);
        AddCategory("Gone", active: false);
        var action = await ProposeOne(AIActionTypes.CreateTransaction, new { amount = 5, account = "Old", category = "Gone" });
        Assert.Null(action.Payload.AccountId);
        Assert.Null(action.Payload.CategoryId);
    }

    [Fact]
    public async Task Propose_Transaction_UserCategoryWinsOverASystemCategoryWithTheSameName()
    {
        AddCategory("Food", system: true);
        var own = AddCategory("Food");
        var action = await ProposeOne(AIActionTypes.CreateTransaction, new { amount = 5, category = "Food" });
        Assert.Equal(own.Id, action.Payload.CategoryId);
    }

    [Fact]
    public async Task Propose_Transaction_AmountGivenAsStringIsParsed()
    {
        var action = await ProposeOne(AIActionTypes.CreateTransaction, new { amount = "12.5" });
        Assert.Equal(12.5m, action.Payload.Amount);
    }

    [Fact]
    public async Task Propose_Transaction_InvalidTypeFallsBackToExpense()
    {
        var action = await ProposeOne(AIActionTypes.CreateTransaction, new { type = "banana", amount = 1 });
        Assert.Equal("Expense", action.Payload.Type);
    }

    [Fact]
    public async Task Propose_Transaction_UsesTheGivenDateAndFallsBackToToday()
    {
        var given = await ProposeOne(AIActionTypes.CreateTransaction, new { amount = 1, date = "2025-03-09" });
        Assert.Equal(new DateOnly(2025, 3, 9), given.Payload.Date);
        var missing = await ProposeOne(AIActionTypes.CreateTransaction, new { amount = 1, date = "09/03/2025" });
        Assert.Equal(FinancialAnalysisService.LocalToday("Asia/Ho_Chi_Minh"), missing.Payload.Date);
    }

    [Fact]
    public async Task Propose_Transaction_DescriptionIsClippedTo500()
    {
        var action = await ProposeOne(AIActionTypes.CreateTransaction, new { amount = 1, description = new string('x', 900) });
        Assert.Equal(500, action.Payload.Description!.Length);
    }

    [Fact]
    public async Task Propose_Category_KeepsNameAndType()
    {
        var action = await ProposeOne(AIActionTypes.CreateCategory, new { name = "  Pets ", type = "income" });
        Assert.Equal("Pets", action.Payload.Name);
        Assert.Equal("Income", action.Payload.Type);
    }

    [Fact]
    public async Task Propose_Budget_DefaultsToTheCurrentMonthAnd80Percent()
    {
        var food = AddCategory("Food");
        var action = await ProposeOne(AIActionTypes.CreateBudget, new { amount = 1000, category = "Food" });
        var today = FinancialAnalysisService.LocalToday("Asia/Ho_Chi_Minh");
        Assert.Equal(food.Id, action.Payload.CategoryId);
        Assert.Equal(new DateOnly(today.Year, today.Month, 1), action.Payload.StartDate);
        Assert.Equal(new DateOnly(today.Year, today.Month, 1).AddMonths(1).AddDays(-1), action.Payload.EndDate);
        Assert.Equal((byte)80, action.Payload.AlertThreshold);
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(-5, 1)]
    [InlineData(150, 100)]
    [InlineData(55, 55)]
    public async Task Propose_Budget_ClampsTheAlertThreshold(int given, int expected)
    {
        var action = await ProposeOne(AIActionTypes.CreateBudget, new { amount = 1, alert_threshold = given });
        Assert.Equal((byte)expected, action.Payload.AlertThreshold);
    }

    [Fact]
    public async Task Propose_Budget_OnlyMatchesExpenseCategories()
    {
        AddCategory("Salary", CategoryType.Income);
        var action = await ProposeOne(AIActionTypes.CreateBudget, new { amount = 1, category = "Salary" });
        Assert.Null(action.Payload.CategoryId);
    }

    [Fact]
    public async Task Propose_SavingsGoal_ReadsNameTargetAndDeadline()
    {
        var action = await ProposeOne(AIActionTypes.CreateSavingsGoal,
            new { name = "Laptop", target_amount = 20_000_000, deadline = "2030-01-31" });
        Assert.Equal("Laptop", action.Payload.Name);
        Assert.Equal(20_000_000m, action.Payload.TargetAmount);
        Assert.Equal(new DateOnly(2030, 1, 31), action.Payload.Deadline);
    }

    [Fact]
    public async Task Propose_Contribution_MatchesActiveGoalAndAccount()
    {
        var account = AddAccount(name: "Cash");
        var goal = new FinancialGoal { UserId = UserId, Name = "Trip", TargetAmount = 100 };
        Db.FinancialGoals.Add(goal);
        Db.SaveChanges();
        var action = await ProposeOne(AIActionTypes.ContributeToGoal, new { amount = 10, goal = "trip", account = "cash" });
        Assert.Equal(goal.Id, action.Payload.GoalId);
        Assert.Equal(account.Id, action.Payload.AccountId);
    }

    [Fact]
    public async Task Propose_Contribution_IgnoresCompletedGoals()
    {
        Db.FinancialGoals.Add(new FinancialGoal
            { UserId = UserId, Name = "Done", TargetAmount = 100, Status = FinancialGoalStatus.Completed });
        Db.SaveChanges();
        var action = await ProposeOne(AIActionTypes.ContributeToGoal, new { amount = 10, goal = "Done" });
        Assert.Null(action.Payload.GoalId);
    }

    [Fact]
    public async Task Propose_ArgumentsThatAreNotAnObjectDoNotCrash()
    {
        var result = await _sut.ProposeAsync(UserId, _messageId,
        [
            new AIProposedAction(AIActionTypes.CreateTransaction, default),
            new AIProposedAction(AIActionTypes.CreateCategory, JsonSerializer.SerializeToElement("text"))
        ]);
        Assert.Equal(2, result.Count);
    }

    // ---- GetForMessages ----

    [Fact]
    public async Task GetForMessages_EmptyInput_ReturnsEmpty() =>
        Assert.Empty(await _sut.GetForMessagesAsync(UserId, []));

    [Fact]
    public async Task GetForMessages_ReturnsActionsGroupedByMessage()
    {
        await ProposeOne(AIActionTypes.CreateCategory, new { name = "One" });
        var result = await _sut.GetForMessagesAsync(UserId, [_messageId, Guid.NewGuid()]);
        var list = Assert.Single(result).Value;
        Assert.Equal("One", Assert.Single(list).Payload.Name);
    }

    [Fact]
    public async Task GetForMessages_DoesNotShowAnotherUsersActions()
    {
        await ProposeOne(AIActionTypes.CreateCategory, new { name = "One" });
        Assert.Empty(await _sut.GetForMessagesAsync(OtherUserId, [_messageId]));
    }

    // ---- confirm ----

    [Fact]
    public async Task Confirm_Transaction_CreatesItAndMarksTheActionConfirmed()
    {
        var account = AddAccount(name: "Cash");
        var category = AddCategory("Food");
        var action = await ProposeOne(AIActionTypes.CreateTransaction,
            new { type = "Expense", amount = 70000, category = "Food", description = "lunch", date = "2025-02-03" });

        var confirmed = await _sut.ConfirmAsync(UserId, action.Id, null);

        Assert.Equal(AIActionStatus.Confirmed, confirmed.Status);
        Assert.NotNull(confirmed.ResolvedAt);
        var transaction = await Db.Transactions.AsNoTracking().SingleAsync(t => t.Id == confirmed.ResultId);
        Assert.Equal(account.Id, transaction.AccountId);
        Assert.Equal(category.Id, transaction.CategoryId);
        Assert.Equal(70000m, transaction.Amount);
        Assert.Equal(TransactionType.Expense, transaction.Type);
        Assert.Equal(TransactionSource.AIDraft, transaction.Source);
        Assert.Equal(new DateTime(2025, 2, 3, 12, 0, 0, DateTimeKind.Utc), transaction.TransactionDate);
    }

    [Fact]
    public async Task Confirm_IncomeTransaction_IsStoredAsIncome()
    {
        AddAccount();
        AddCategory("Salary", CategoryType.Income);
        var action = await ProposeOne(AIActionTypes.CreateTransaction, new { type = "Income", amount = 5, category = "Salary" });
        var confirmed = await _sut.ConfirmAsync(UserId, action.Id, null);
        Assert.Equal(TransactionType.Income, (await Db.Transactions.AsNoTracking().SingleAsync(t => t.Id == confirmed.ResultId)).Type);
    }

    [Fact]
    public async Task Confirm_WithEditedPayload_UsesTheEdits()
    {
        var account = AddAccount(name: "A");
        AddAccount(name: "B");
        var category = AddCategory("Food");
        var action = await ProposeOne(AIActionTypes.CreateTransaction, new { amount = 10, category = "Food" });
        var edited = action.Payload with { AccountId = account.Id, Amount = 99m, CategoryId = category.Id };

        var confirmed = await _sut.ConfirmAsync(UserId, action.Id, edited);

        var transaction = await Db.Transactions.AsNoTracking().SingleAsync(t => t.Id == confirmed.ResultId);
        Assert.Equal(99m, transaction.Amount);
        Assert.Equal(99m, confirmed.Payload.Amount);
    }

    [Fact]
    public async Task Confirm_MissingAccount_IsBadRequestAndStaysPending()
    {
        AddAccount(name: "A");
        AddAccount(name: "B");
        AddCategory("Food");
        var action = await ProposeOne(AIActionTypes.CreateTransaction, new { amount = 10, category = "Food" });

        await Assert.ThrowsAsync<BadRequestException>(() => _sut.ConfirmAsync(UserId, action.Id, null));

        var row = await Db.AIActions.AsNoTracking().SingleAsync();
        Assert.Equal(AIActionStatus.Pending, row.Status);
        Assert.Null(row.ResolvedAt);
        Assert.Equal(0, await Db.Transactions.CountAsync());
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0)]
    [InlineData(-3)]
    public async Task Confirm_InvalidAmount_IsBadRequest(int? amount)
    {
        AddAccount();
        AddCategory("Food");
        var action = await ProposeOne(AIActionTypes.CreateTransaction, new { category = "Food" });
        var edited = action.Payload with { Amount = amount };
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.ConfirmAsync(UserId, action.Id, edited));
    }

    [Fact]
    public async Task Confirm_AmountAboveTheLimit_IsBadRequest()
    {
        AddAccount();
        AddCategory("Food");
        var action = await ProposeOne(AIActionTypes.CreateTransaction, new { category = "Food" });
        var edited = action.Payload with { Amount = 1_000_000_000_000_000m };
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.ConfirmAsync(UserId, action.Id, edited));
    }

    [Fact]
    public async Task Confirm_CanBeRetriedAfterAFailure()
    {
        AddAccount();
        AddCategory("Food");
        var action = await ProposeOne(AIActionTypes.CreateTransaction, new { category = "Food" });
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.ConfirmAsync(UserId, action.Id, null));
        var fixedUp = action.Payload with { Amount = 20m };
        var confirmed = await _sut.ConfirmAsync(UserId, action.Id, fixedUp);
        Assert.Equal(AIActionStatus.Confirmed, confirmed.Status);
    }

    [Fact]
    public async Task Confirm_Twice_IsAConflictAndCreatesOnlyOneRecord()
    {
        AddAccount();
        AddCategory("Food");
        var action = await ProposeOne(AIActionTypes.CreateTransaction, new { amount = 5, category = "Food" });
        await _sut.ConfirmAsync(UserId, action.Id, null);
        await Assert.ThrowsAsync<ConflictException>(() => _sut.ConfirmAsync(UserId, action.Id, null));
        Assert.Equal(1, await Db.Transactions.CountAsync());
    }

    [Fact]
    public async Task Confirm_UnknownAction_IsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.ConfirmAsync(UserId, Guid.NewGuid(), null));

    [Fact]
    public async Task Confirm_AnotherUsersAction_IsNotFoundAndStaysPending()
    {
        AddAccount();
        AddCategory("Food");
        var action = await ProposeOne(AIActionTypes.CreateTransaction, new { amount = 5, category = "Food" });
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.ConfirmAsync(OtherUserId, action.Id, null));
        Assert.Equal(AIActionStatus.Pending, (await Db.AIActions.AsNoTracking().SingleAsync()).Status);
    }

    [Fact]
    public async Task Confirm_Category_CreatesIt()
    {
        var action = await ProposeOne(AIActionTypes.CreateCategory, new { name = "Pets", type = "Expense" });
        var confirmed = await _sut.ConfirmAsync(UserId, action.Id, null);
        var category = await Db.Categories.AsNoTracking().SingleAsync(c => c.Id == confirmed.ResultId);
        Assert.Equal("Pets", category.Name);
        Assert.Equal(UserId, category.UserId);
    }

    [Fact]
    public async Task Confirm_CategoryWithoutName_IsBadRequest()
    {
        var action = await ProposeOne(AIActionTypes.CreateCategory, new { type = "Expense" });
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.ConfirmAsync(UserId, action.Id, null));
    }

    [Fact]
    public async Task Confirm_CategoryNameTooLong_IsBadRequest()
    {
        var action = await ProposeOne(AIActionTypes.CreateCategory, new { name = "ok" });
        var edited = action.Payload with { Name = new string('x', 101) };
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.ConfirmAsync(UserId, action.Id, edited));
    }

    [Fact]
    public async Task Confirm_CategoryThatExistsAlready_IsRejected()
    {
        AddCategory("Pets");
        var action = await ProposeOne(AIActionTypes.CreateCategory, new { name = "Pets", type = "Expense" });
        await Assert.ThrowsAnyAsync<AppException>(() => _sut.ConfirmAsync(UserId, action.Id, null));
        Assert.Equal(AIActionStatus.Pending, (await Db.AIActions.AsNoTracking().SingleAsync()).Status);
    }

    [Fact]
    public async Task Confirm_Budget_CreatesIt()
    {
        var food = AddCategory("Food");
        var action = await ProposeOne(AIActionTypes.CreateBudget,
            new { amount = 2_000_000, category = "Food", start_date = "2030-01-01", end_date = "2030-01-31", alert_threshold = 90 });
        var confirmed = await _sut.ConfirmAsync(UserId, action.Id, null);
        var budget = await Db.Budgets.AsNoTracking().SingleAsync(b => b.Id == confirmed.ResultId);
        Assert.Equal(food.Id, budget.CategoryId);
        Assert.Equal(2_000_000m, budget.Amount);
        Assert.Equal((byte)90, budget.AlertThreshold);
    }

    [Fact]
    public async Task Confirm_BudgetWithoutCategory_IsBadRequest()
    {
        var action = await ProposeOne(AIActionTypes.CreateBudget, new { amount = 5 });
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.ConfirmAsync(UserId, action.Id, null));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(101)]
    public async Task Confirm_BudgetThresholdOutOfRange_IsBadRequest(int threshold)
    {
        var food = AddCategory("Food");
        var action = await ProposeOne(AIActionTypes.CreateBudget, new { amount = 5, category = "Food" });
        var edited = action.Payload with { CategoryId = food.Id, AlertThreshold = (byte)threshold };
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.ConfirmAsync(UserId, action.Id, edited));
    }

    [Fact]
    public async Task Confirm_SavingsGoal_CreatesIt()
    {
        var action = await ProposeOne(AIActionTypes.CreateSavingsGoal, new { name = "Laptop", target_amount = 5000 });
        var confirmed = await _sut.ConfirmAsync(UserId, action.Id, null);
        var goal = await Db.FinancialGoals.AsNoTracking().SingleAsync(g => g.Id == confirmed.ResultId);
        Assert.Equal("Laptop", goal.Name);
        Assert.Equal(5000m, goal.TargetAmount);
    }

    [Fact]
    public async Task Confirm_SavingsGoalNameTooLong_IsBadRequest()
    {
        var action = await ProposeOne(AIActionTypes.CreateSavingsGoal, new { name = "ok", target_amount = 5 });
        var edited = action.Payload with { Name = new string('g', 151) };
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.ConfirmAsync(UserId, action.Id, edited));
    }

    [Fact]
    public async Task Confirm_Contribution_AddsToTheGoalAndReturnsItsId()
    {
        var goal = new FinancialGoal { UserId = UserId, Name = "Trip", TargetAmount = 1000 };
        Db.FinancialGoals.Add(goal);
        Db.SaveChanges();
        var action = await ProposeOne(AIActionTypes.ContributeToGoal, new { amount = 250, goal = "Trip" });
        var confirmed = await _sut.ConfirmAsync(UserId, action.Id, null);
        Assert.Equal(goal.Id, confirmed.ResultId);
        Assert.Equal(250m, (await Db.FinancialGoals.AsNoTracking().SingleAsync(g => g.Id == goal.Id)).CurrentAmount);
    }

    [Fact]
    public async Task Confirm_ContributionWithoutGoal_IsBadRequest()
    {
        var action = await ProposeOne(AIActionTypes.ContributeToGoal, new { amount = 5, goal = "Unknown" });
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.ConfirmAsync(UserId, action.Id, null));
    }

    [Fact]
    public async Task Confirm_ResolvesNamesAgain_ForACategoryCreatedByAnEarlierAction()
    {
        AddAccount();
        var first = await ProposeOne(AIActionTypes.CreateCategory, new { name = "Gym", type = "Expense" });
        var second = await ProposeOne(AIActionTypes.CreateTransaction, new { amount = 30, category = "Gym" });
        Assert.Null(second.Payload.CategoryId);

        await _sut.ConfirmAsync(UserId, first.Id, null);
        var confirmed = await _sut.ConfirmAsync(UserId, second.Id, null);

        var transaction = await Db.Transactions.AsNoTracking().SingleAsync(t => t.Id == confirmed.ResultId);
        Assert.Equal((await Db.Categories.AsNoTracking().SingleAsync(c => c.Name == "Gym")).Id, transaction.CategoryId);
    }

    // ---- cancel ----

    [Fact]
    public async Task Cancel_MarksTheActionCancelledWithoutCreatingAnything()
    {
        AddAccount();
        AddCategory("Food");
        var action = await ProposeOne(AIActionTypes.CreateTransaction, new { amount = 5, category = "Food" });
        var cancelled = await _sut.CancelAsync(UserId, action.Id);
        Assert.Equal(AIActionStatus.Cancelled, cancelled.Status);
        Assert.NotNull(cancelled.ResolvedAt);
        Assert.Null(cancelled.ResultId);
        Assert.Equal(0, await Db.Transactions.CountAsync());
    }

    [Fact]
    public async Task Cancel_AfterConfirm_IsAConflict()
    {
        var action = await ProposeOne(AIActionTypes.CreateCategory, new { name = "Pets" });
        await _sut.ConfirmAsync(UserId, action.Id, null);
        await Assert.ThrowsAsync<ConflictException>(() => _sut.CancelAsync(UserId, action.Id));
    }

    [Fact]
    public async Task Confirm_AfterCancel_IsAConflict()
    {
        var action = await ProposeOne(AIActionTypes.CreateCategory, new { name = "Pets" });
        await _sut.CancelAsync(UserId, action.Id);
        await Assert.ThrowsAsync<ConflictException>(() => _sut.ConfirmAsync(UserId, action.Id, null));
        Assert.Equal(0, await Db.Categories.CountAsync(c => c.Name == "Pets"));
    }

    [Fact]
    public async Task Cancel_UnknownOrForeignAction_IsNotFound()
    {
        var action = await ProposeOne(AIActionTypes.CreateCategory, new { name = "Pets" });
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.CancelAsync(UserId, Guid.NewGuid()));
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.CancelAsync(OtherUserId, action.Id));
    }

    // ---- history line ----

    [Fact]
    public void DescribeForHistory_MentionsTypeStatusAndDetails()
    {
        var response = new AIActionResponse(Guid.NewGuid(), AIActionTypes.CreateCategory, AIActionStatus.Confirmed,
            new AIActionPayload(Name: "Pets"), null, DateTime.UtcNow, null);
        var line = AIActionService.DescribeForHistory(response);
        Assert.Contains("create_category", line);
        Assert.Contains("Pets", line);
        Assert.Contains("Confirmed", line);
        Assert.DoesNotContain("amount", line);
    }
}

// ---------------------------------------------------------------- FinancialContextCache

public class FinancialContextCacheTests
{
    private static readonly Guid A = Guid.NewGuid();
    private static readonly Guid B = Guid.NewGuid();

    [Fact]
    public void Miss_ThenHit()
    {
        var cache = TestCache.New();
        var key = cache.KeyFor(A);
        Assert.False(cache.TryGet(key, out _));
        cache.Set(key, "ctx");
        Assert.True(cache.TryGet(key, out var value));
        Assert.Equal("ctx", value);
    }

    [Fact]
    public void KeysAreDifferentPerUser() => Assert.NotEqual(TestCache.New().KeyFor(A), TestCache.New().KeyFor(B));

    [Fact]
    public void SameUserKeyIsStableUntilInvalidated()
    {
        var cache = TestCache.New();
        Assert.Equal(cache.KeyFor(A), cache.KeyFor(A));
    }

    [Fact]
    public void Invalidate_ChangesTheKeyOfThatUserOnly()
    {
        var cache = TestCache.New();
        var a = cache.KeyFor(A);
        var b = cache.KeyFor(B);
        cache.Invalidate(A);
        Assert.NotEqual(a, cache.KeyFor(A));
        Assert.Equal(b, cache.KeyFor(B));
    }

    [Fact]
    public void Invalidate_MakesTheOldEntryUnreachable()
    {
        var cache = TestCache.New();
        cache.Set(cache.KeyFor(A), "old");
        cache.Invalidate(A);
        Assert.False(cache.TryGet(cache.KeyFor(A), out _));
    }

    [Fact]
    public void Invalidate_Repeated_ProducesANewKeyEachTime()
    {
        var cache = TestCache.New();
        var keys = new HashSet<string> { cache.KeyFor(A) };
        for (var i = 0; i < 5; i++)
        {
            cache.Invalidate(A);
            Assert.True(keys.Add(cache.KeyFor(A)));
        }
    }

    [Fact]
    public void InvalidateAll_ChangesEveryUsersKey()
    {
        var cache = TestCache.New();
        var a = cache.KeyFor(A);
        var b = cache.KeyFor(B);
        cache.InvalidateAll();
        Assert.NotEqual(a, cache.KeyFor(A));
        Assert.NotEqual(b, cache.KeyFor(B));
    }

    [Fact]
    public void AKeyTakenBeforeAnInvalidationNeverServesNewData()
    {
        var cache = TestCache.New();
        var staleKey = cache.KeyFor(A);
        cache.Invalidate(A); // data changed while the context was being built
        cache.Set(staleKey, "built from old data");
        Assert.False(cache.TryGet(cache.KeyFor(A), out _));
    }

    [Fact]
    public void LifetimeIsSixtySeconds() => Assert.Equal(TimeSpan.FromSeconds(60), FinancialContextCache.Lifetime);
}

// ---------------------------------------------------------------- FinancialDataChangeInterceptor

public class FinancialDataChangeInterceptorTests : IDisposable
{
    private static readonly Guid U = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid V = Guid.Parse("22222222-2222-2222-2222-222222222222");

    private readonly SqliteConnection _connection = new("DataSource=:memory:");
    private readonly FinancialContextCache _cache = TestCache.New();
    private readonly AppDbContext _db;

    public FinancialDataChangeInterceptorTests()
    {
        _connection.Open();
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(_connection)
            .ReplaceService<IModelCustomizer, DecimalAsDoubleModelCustomizer>()
            .AddInterceptors(new FinancialDataChangeInterceptor(_cache))
            .Options;
        _db = new AppDbContext(options);
        _db.Database.EnsureCreated();
        foreach (var (id, mail) in new[] { (U, "u@test.com"), (V, "v@test.com") })
            _db.Users.Add(new ApplicationUser
            {
                Id = id, UserName = mail, NormalizedUserName = mail.ToUpperInvariant(), Email = mail,
                NormalizedEmail = mail.ToUpperInvariant(), FullName = mail
            });
        _db.SaveChanges();
    }

    private bool Fresh(Guid user, string key) => !_cache.TryGet(key, out _) || _cache.KeyFor(user) == key;

    private (string U, string V) Prime()
    {
        var u = _cache.KeyFor(U);
        var v = _cache.KeyFor(V);
        _cache.Set(u, "u");
        _cache.Set(v, "v");
        return (u, v);
    }

    [Fact]
    public async Task SavingAnAccount_InvalidatesOnlyItsOwner()
    {
        var (u, v) = Prime();
        _db.Accounts.Add(new Account { UserId = U, Name = "Cash" });
        await _db.SaveChangesAsync();
        Assert.False(_cache.TryGet(_cache.KeyFor(U), out _));
        Assert.True(_cache.TryGet(_cache.KeyFor(V), out _));
        Assert.NotEqual(u, _cache.KeyFor(U));
        Assert.Equal(v, _cache.KeyFor(V));
    }

    [Fact]
    public async Task SavingATransaction_Invalidates()
    {
        var account = new Account { UserId = U, Name = "Cash" };
        var category = new Category { UserId = U, Name = "Food", Type = CategoryType.Expense };
        _db.AddRange(account, category);
        await _db.SaveChangesAsync();
        Prime();
        _db.Transactions.Add(new Transaction
        {
            UserId = U, AccountId = account.Id, CategoryId = category.Id, Amount = 5,
            Type = TransactionType.Expense, TransactionDate = DateTime.UtcNow
        });
        await _db.SaveChangesAsync();
        Assert.False(_cache.TryGet(_cache.KeyFor(U), out _));
        Assert.True(_cache.TryGet(_cache.KeyFor(V), out _));
    }

    [Fact]
    public async Task ModifyingAndDeleting_Invalidate()
    {
        var account = new Account { UserId = U, Name = "Cash" };
        _db.Accounts.Add(account);
        await _db.SaveChangesAsync();

        Prime();
        account.Name = "Wallet";
        await _db.SaveChangesAsync();
        Assert.False(_cache.TryGet(_cache.KeyFor(U), out _));

        Prime();
        _db.Accounts.Remove(account);
        await _db.SaveChangesAsync();
        Assert.False(_cache.TryGet(_cache.KeyFor(U), out _));
    }

    [Fact]
    public async Task SavingABudgetAndAGoal_Invalidate()
    {
        var category = new Category { UserId = U, Name = "Food", Type = CategoryType.Expense };
        _db.Categories.Add(category);
        await _db.SaveChangesAsync();

        Prime();
        _db.Budgets.Add(new Budget
        {
            UserId = U, CategoryId = category.Id, Amount = 1, StartDate = new DateOnly(2030, 1, 1), EndDate = new DateOnly(2030, 1, 31)
        });
        await _db.SaveChangesAsync();
        Assert.False(_cache.TryGet(_cache.KeyFor(U), out _));

        Prime();
        _db.FinancialGoals.Add(new FinancialGoal { UserId = U, Name = "Trip", TargetAmount = 5 });
        await _db.SaveChangesAsync();
        Assert.False(_cache.TryGet(_cache.KeyFor(U), out _));
    }

    [Fact]
    public async Task AUserCategory_InvalidatesItsOwnerOnly()
    {
        Prime();
        _db.Categories.Add(new Category { UserId = U, Name = "Pets", Type = CategoryType.Expense });
        await _db.SaveChangesAsync();
        Assert.False(_cache.TryGet(_cache.KeyFor(U), out _));
        Assert.True(_cache.TryGet(_cache.KeyFor(V), out _));
    }

    [Fact]
    public async Task ASystemCategory_InvalidatesEveryone()
    {
        Prime();
        _db.Categories.Add(new Category { UserId = null, IsSystem = true, Name = "Shared", Type = CategoryType.Expense });
        await _db.SaveChangesAsync();
        Assert.False(_cache.TryGet(_cache.KeyFor(U), out _));
        Assert.False(_cache.TryGet(_cache.KeyFor(V), out _));
    }

    [Fact]
    public async Task UnrelatedEntities_LeaveTheCacheAlone()
    {
        Prime();
        _db.AIConversations.Add(new AIConversation { UserId = U, TitleCipher = [1], TitleNonce = new byte[12], KeyVersion = 1 });
        await _db.SaveChangesAsync();
        Assert.True(_cache.TryGet(_cache.KeyFor(U), out _));
        Assert.True(_cache.TryGet(_cache.KeyFor(V), out _));
    }

    [Fact]
    public async Task AFailedSave_DoesNotBreakLaterSaves()
    {
        _db.Accounts.Add(new Account { UserId = Guid.NewGuid(), Name = "Orphan" }); // unknown user: FK violation
        await Assert.ThrowsAnyAsync<DbUpdateException>(() => _db.SaveChangesAsync());
        _db.ChangeTracker.Clear();

        Prime();
        _db.Accounts.Add(new Account { UserId = U, Name = "Fine" });
        await _db.SaveChangesAsync();
        Assert.False(_cache.TryGet(_cache.KeyFor(U), out _));
    }

    [Fact]
    public void SynchronousSaves_Invalidate()
    {
        Prime();
        _db.Accounts.Add(new Account { UserId = U, Name = "Sync" });
        _db.SaveChanges();
        Assert.False(_cache.TryGet(_cache.KeyFor(U), out _));
    }

    [Fact]
    public async Task TheKeyChangesTwice_BeforeAndAfterTheSave()
    {
        var before = _cache.KeyFor(U);
        _db.Accounts.Add(new Account { UserId = U, Name = "x" });
        await _db.SaveChangesAsync();
        // Capture bumps once, Release bumps again.
        Assert.NotEqual(before, _cache.KeyFor(U));
        var afterOne = _cache.KeyFor(U);
        _cache.Invalidate(U);
        Assert.NotEqual(afterOne, _cache.KeyFor(U));
    }

    public void Dispose()
    {
        _db.Dispose();
        _connection.Dispose();
    }
}

// ---------------------------------------------------------------- AIActionsController

public class AIActionsControllerTests
{
    private sealed class RecordingActions : FakeActionsBase
    {
        public (Guid User, Guid Id, AIActionPayload? Edited)? Confirmed { get; private set; }
        public (Guid User, Guid Id)? Cancelled { get; private set; }

        public override Task<AIActionResponse> ConfirmAsync(Guid userId, Guid actionId, AIActionPayload? edited,
            CancellationToken cancellationToken = default)
        {
            Confirmed = (userId, actionId, edited);
            return Task.FromResult(Response(actionId, AIActionStatus.Confirmed));
        }

        public override Task<AIActionResponse> CancelAsync(Guid userId, Guid actionId, CancellationToken cancellationToken = default)
        {
            Cancelled = (userId, actionId);
            return Task.FromResult(Response(actionId, AIActionStatus.Cancelled));
        }
    }

    private static readonly Guid User = Guid.NewGuid();

    [Fact]
    public async Task Confirm_PassesTheUserTheIdAndTheEditedPayload()
    {
        var actions = new RecordingActions();
        var controller = new backend.Controllers.AIActionsController(actions, new FakeCurrentUser(User));
        var id = Guid.NewGuid();
        var payload = new AIActionPayload(Amount: 9m);
        var result = await controller.Confirm(id, new ConfirmAIActionRequest(payload), default);
        Assert.Equal((User, id, (AIActionPayload?)payload), actions.Confirmed);
        Assert.Equal(AIActionStatus.Confirmed, Assert.IsType<AIActionResponse>(((Microsoft.AspNetCore.Mvc.OkObjectResult)result.Result!).Value).Status);
    }

    [Fact]
    public async Task Confirm_WithoutABody_ConfirmsWhatTheAIProposed()
    {
        var actions = new RecordingActions();
        var controller = new backend.Controllers.AIActionsController(actions, new FakeCurrentUser(User));
        await controller.Confirm(Guid.NewGuid(), null, default);
        Assert.Null(actions.Confirmed!.Value.Edited);
    }

    [Fact]
    public async Task Cancel_PassesTheUserAndTheId()
    {
        var actions = new RecordingActions();
        var controller = new backend.Controllers.AIActionsController(actions, new FakeCurrentUser(User));
        var id = Guid.NewGuid();
        await controller.Cancel(id, default);
        Assert.Equal((User, id), actions.Cancelled);
    }

    [Fact]
    public void RoutesAndAuthorization()
    {
        var type = typeof(backend.Controllers.AIActionsController);
        Assert.Equal("api/ai/actions", type.GetCustomAttributes(typeof(Microsoft.AspNetCore.Mvc.RouteAttribute), false)
            .Cast<Microsoft.AspNetCore.Mvc.RouteAttribute>().Single().Template);
        Assert.Contains(type.GetCustomAttributes(true), a => a is Microsoft.AspNetCore.Authorization.AuthorizeAttribute);
    }
}

public abstract class FakeActionsBase : backend.Services.Interfaces.IAIActionService
{
    protected static AIActionResponse Response(Guid id, AIActionStatus status) =>
        new(id, AIActionTypes.CreateCategory, status, new AIActionPayload(), null, DateTime.UtcNow, null);

    public virtual Task<IReadOnlyList<AIActionResponse>> ProposeAsync(Guid userId, Guid messageId,
        IReadOnlyList<AIProposedAction> proposals, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();

    public virtual Task<IReadOnlyDictionary<Guid, IReadOnlyList<AIActionResponse>>> GetForMessagesAsync(Guid userId,
        IReadOnlyCollection<Guid> messageIds, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();

    public virtual Task<AIActionResponse> ConfirmAsync(Guid userId, Guid actionId, AIActionPayload? edited,
        CancellationToken cancellationToken = default) => throw new NotSupportedException();

    public virtual Task<AIActionResponse> CancelAsync(Guid userId, Guid actionId, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();
}
