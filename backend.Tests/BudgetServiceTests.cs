using backend.DTOs.Requests;
using backend.Helpers;
using backend.Models;
using backend.Services.Implementations;
using Microsoft.Extensions.Logging.Abstractions;

namespace backend.Tests;

public class BudgetServiceTests : DbTestBase
{
    private readonly FakeNotifications _notifications = new();
    private readonly BudgetService _sut;
    private readonly Account _account;
    private readonly Category _food;

    private static readonly DateOnly Start = new(2025, 1, 1);
    private static readonly DateOnly End = new(2025, 1, 31);
    private static readonly DateTime MidJan = new(2025, 1, 15, 0, 0, 0, DateTimeKind.Utc);

    public BudgetServiceTests()
    {
        _sut = new BudgetService(Db, _notifications, NullLogger<BudgetService>.Instance, TestCache.New());
        _account = AddAccount(initial: 100_000_000m);
        _food = AddCategory("Food");
    }

    private UpsertBudgetRequest Request(decimal amount = 1_000m, DateOnly? start = null, DateOnly? end = null,
        byte threshold = 80, Guid? categoryId = null) =>
        new(categoryId ?? _food.Id, amount, start ?? Start, end ?? End, threshold);

    private Budget AddBudget(decimal amount = 1_000m, DateOnly? start = null, DateOnly? end = null, byte threshold = 80,
        Category? category = null, Guid? userId = null)
    {
        var budget = new Budget
        {
            UserId = userId ?? UserId, CategoryId = (category ?? _food).Id, Amount = amount,
            StartDate = start ?? Start, EndDate = end ?? End, AlertThreshold = threshold
        };
        Db.Budgets.Add(budget);
        Db.SaveChanges();
        return budget;
    }

    // ---- Create / validation ----

    [Fact]
    public async Task Create_ReturnsBudgetWithNothingSpent()
    {
        var result = await _sut.CreateAsync(UserId, Request(2_000m));
        Assert.Equal(2_000m, result.Amount);
        Assert.Equal(0m, result.Spent);
        Assert.Equal(2_000m, result.Remaining);
        Assert.Equal(0m, result.UsedPercent);
        Assert.Equal("Food", result.CategoryName);
        Assert.False(result.IsExceeded);
    }

    [Fact]
    public async Task Create_PersistsDatesAndThreshold()
    {
        var result = await _sut.CreateAsync(UserId, Request(threshold: 55));
        Assert.Equal(Start, result.StartDate);
        Assert.Equal(End, result.EndDate);
        Assert.Equal(55, result.AlertThreshold);
    }

    [Fact]
    public async Task Create_EndBeforeStart_ThrowsBadRequest()
    {
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.CreateAsync(UserId, Request(start: End, end: Start)));
    }

    [Fact]
    public async Task Create_SingleDayBudget_IsAllowed()
    {
        var result = await _sut.CreateAsync(UserId, Request(start: Start, end: Start));
        Assert.Equal(result.StartDate, result.EndDate);
    }

    [Fact]
    public async Task Create_UnknownCategory_ThrowsBadRequest()
    {
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.CreateAsync(UserId, Request(categoryId: Guid.NewGuid())));
    }

    [Fact]
    public async Task Create_CategoryOfAnotherUser_ThrowsBadRequest()
    {
        var theirs = AddCategory("Theirs", userId: OtherUserId);
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.CreateAsync(UserId, Request(categoryId: theirs.Id)));
    }

    [Fact]
    public async Task Create_IncomeCategory_ThrowsBadRequest()
    {
        var salary = AddCategory("Salary", CategoryType.Income);
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.CreateAsync(UserId, Request(categoryId: salary.Id)));
    }

    [Fact]
    public async Task Create_SystemExpenseCategory_IsAllowed()
    {
        var system = AddCategory("Bills", system: true);
        var result = await _sut.CreateAsync(UserId, Request(categoryId: system.Id));
        Assert.Equal("Bills", result.CategoryName);
    }

    [Fact]
    public async Task Create_OverlappingRangeSameCategory_ThrowsConflict()
    {
        AddBudget();
        await Assert.ThrowsAsync<ConflictException>(() =>
            _sut.CreateAsync(UserId, Request(start: new DateOnly(2025, 1, 20), end: new DateOnly(2025, 2, 20))));
    }

    [Fact]
    public async Task Create_RangeTouchingOnTheLastDay_ThrowsConflict()
    {
        AddBudget();
        await Assert.ThrowsAsync<ConflictException>(() =>
            _sut.CreateAsync(UserId, Request(start: End, end: new DateOnly(2025, 2, 28))));
    }

    [Fact]
    public async Task Create_RangeStartingTheDayAfter_IsAllowed()
    {
        AddBudget();
        var result = await _sut.CreateAsync(UserId,
            Request(start: new DateOnly(2025, 2, 1), end: new DateOnly(2025, 2, 28)));
        Assert.Equal(new DateOnly(2025, 2, 1), result.StartDate);
    }

    [Fact]
    public async Task Create_RangeContainedInsideExisting_ThrowsConflict()
    {
        AddBudget();
        await Assert.ThrowsAsync<ConflictException>(() =>
            _sut.CreateAsync(UserId, Request(start: new DateOnly(2025, 1, 10), end: new DateOnly(2025, 1, 12))));
    }

    [Fact]
    public async Task Create_RangeContainingExisting_ThrowsConflict()
    {
        AddBudget(start: new DateOnly(2025, 1, 10), end: new DateOnly(2025, 1, 12));
        await Assert.ThrowsAsync<ConflictException>(() => _sut.CreateAsync(UserId, Request()));
    }

    [Fact]
    public async Task Create_SameRangeDifferentCategory_IsAllowed()
    {
        AddBudget();
        var transport = AddCategory("Transport");
        var result = await _sut.CreateAsync(UserId, Request(categoryId: transport.Id));
        Assert.Equal("Transport", result.CategoryName);
    }

    [Fact]
    public async Task Create_SameRangeSameCategoryDifferentUser_IsAllowed()
    {
        var system = AddCategory("Shared", system: true);
        AddBudget(category: system, userId: OtherUserId);
        var result = await _sut.CreateAsync(UserId, Request(categoryId: system.Id));
        Assert.Equal(UserId, Db.Budgets.Single(b => b.Id == result.Id).UserId);
    }

    // ---- Spent / usage calculation ----

    [Fact]
    public async Task GetById_SumsExpensesInsideTheRange()
    {
        var budget = AddBudget(1_000m);
        AddTransaction(_account, _food, 100m, date: MidJan);
        AddTransaction(_account, _food, 250m, date: MidJan.AddDays(3));
        var result = await _sut.GetByIdAsync(UserId, budget.Id);
        Assert.Equal(350m, result.Spent);
        Assert.Equal(650m, result.Remaining);
        Assert.Equal(35m, result.UsedPercent);
    }

    [Fact]
    public async Task GetById_IgnoresIncomeTransactions()
    {
        var budget = AddBudget();
        var salaryCategory = AddCategory("Salary", CategoryType.Income);
        AddTransaction(_account, salaryCategory, 500m, TransactionType.Income, MidJan);
        Assert.Equal(0m, (await _sut.GetByIdAsync(UserId, budget.Id)).Spent);
    }

    [Fact]
    public async Task GetById_IgnoresOtherCategories()
    {
        var budget = AddBudget();
        AddTransaction(_account, AddCategory("Transport"), 500m, date: MidJan);
        Assert.Equal(0m, (await _sut.GetByIdAsync(UserId, budget.Id)).Spent);
    }

    [Fact]
    public async Task GetById_IgnoresTransactionsOutsideTheRange()
    {
        var budget = AddBudget();
        AddTransaction(_account, _food, 500m, date: new DateTime(2024, 12, 31, 23, 59, 59, DateTimeKind.Utc));
        AddTransaction(_account, _food, 500m, date: new DateTime(2025, 2, 1, 0, 0, 0, DateTimeKind.Utc));
        Assert.Equal(0m, (await _sut.GetByIdAsync(UserId, budget.Id)).Spent);
    }

    [Fact]
    public async Task GetById_CountsTransactionsOnFirstAndLastDay()
    {
        var budget = AddBudget();
        AddTransaction(_account, _food, 10m, date: new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc));
        AddTransaction(_account, _food, 20m, date: new DateTime(2025, 1, 31, 23, 59, 59, DateTimeKind.Utc));
        Assert.Equal(30m, (await _sut.GetByIdAsync(UserId, budget.Id)).Spent);
    }

    [Fact]
    public async Task GetById_IgnoresOtherUsersTransactions()
    {
        var system = AddCategory("Shared", system: true);
        var budget = AddBudget(category: system);
        var theirs = AddAccount(OtherUserId, "Theirs");
        AddTransaction(theirs, system, 400m, date: MidJan);
        Assert.Equal(0m, (await _sut.GetByIdAsync(UserId, budget.Id)).Spent);
    }

    [Theory]
    [InlineData(100, 80, false, false)]
    [InlineData(799, 80, false, false)]
    [InlineData(800, 80, true, false)]
    [InlineData(1000, 80, true, false)]
    [InlineData(1001, 80, true, true)]
    [InlineData(500, 50, true, false)]
    [InlineData(499, 50, false, false)]
    public async Task GetById_ThresholdAndExceededFlags(int spent, byte threshold, bool overThreshold, bool exceeded)
    {
        var budget = AddBudget(1_000m, threshold: threshold);
        AddTransaction(_account, _food, spent, date: MidJan);
        var result = await _sut.GetByIdAsync(UserId, budget.Id);
        Assert.Equal(overThreshold, result.IsOverThreshold);
        Assert.Equal(exceeded, result.IsExceeded);
    }

    [Fact]
    public async Task GetById_OverspentBudgetHasNegativeRemaining()
    {
        var budget = AddBudget(1_000m);
        AddTransaction(_account, _food, 1_250m, date: MidJan);
        var result = await _sut.GetByIdAsync(UserId, budget.Id);
        Assert.Equal(-250m, result.Remaining);
        Assert.Equal(125m, result.UsedPercent);
    }

    [Fact]
    public async Task GetById_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.GetByIdAsync(UserId, Guid.NewGuid()));

    [Fact]
    public async Task GetById_OfAnotherUser_ThrowsNotFound()
    {
        var budget = AddBudget(userId: OtherUserId);
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.GetByIdAsync(UserId, budget.Id));
    }

    // ---- GetAll ----

    [Fact]
    public async Task GetAll_ReturnsOnlyOwnBudgets()
    {
        AddBudget();
        AddBudget(userId: OtherUserId);
        Assert.Single(await _sut.GetAllAsync(UserId));
    }

    [Fact]
    public async Task GetAll_OrdersByStartDateDescending()
    {
        AddBudget(start: new DateOnly(2025, 1, 1), end: new DateOnly(2025, 1, 31));
        AddBudget(start: new DateOnly(2025, 3, 1), end: new DateOnly(2025, 3, 31));
        AddBudget(start: new DateOnly(2025, 2, 1), end: new DateOnly(2025, 2, 28));
        var result = await _sut.GetAllAsync(UserId);
        Assert.Equal([3, 2, 1], result.Select(b => b.StartDate.Month));
    }

    [Fact]
    public async Task GetAll_ActiveOnFiltersByDate()
    {
        AddBudget(start: new DateOnly(2025, 1, 1), end: new DateOnly(2025, 1, 31));
        AddBudget(start: new DateOnly(2025, 2, 1), end: new DateOnly(2025, 2, 28));
        var result = await _sut.GetAllAsync(UserId, new DateOnly(2025, 2, 10));
        Assert.Equal(2, Assert.Single(result).StartDate.Month);
    }

    [Theory]
    [InlineData(2025, 1, 1, 1)]
    [InlineData(2025, 1, 31, 1)]
    [InlineData(2024, 12, 31, 0)]
    [InlineData(2025, 2, 1, 0)]
    public async Task GetAll_ActiveOnIsInclusiveOfBothEnds(int y, int m, int d, int expected)
    {
        AddBudget();
        var result = await _sut.GetAllAsync(UserId, new DateOnly(y, m, d));
        Assert.Equal(expected, result.Count);
    }

    [Fact]
    public async Task GetAll_EachBudgetHasItsOwnSpent()
    {
        var transport = AddCategory("Transport");
        AddBudget(1_000m);
        AddBudget(1_000m, category: transport);
        AddTransaction(_account, _food, 300m, date: MidJan);
        var result = await _sut.GetAllAsync(UserId);
        Assert.Equal(300m, result.Single(b => b.CategoryName == "Food").Spent);
        Assert.Equal(0m, result.Single(b => b.CategoryName == "Transport").Spent);
    }

    // ---- Update ----

    [Fact]
    public async Task Update_ChangesAmountAndThreshold()
    {
        var budget = AddBudget();
        var result = await _sut.UpdateAsync(UserId, budget.Id, Request(5_000m, threshold: 90));
        Assert.Equal(5_000m, result.Amount);
        Assert.Equal(90, result.AlertThreshold);
    }

    [Fact]
    public async Task Update_OwnRangeDoesNotConflictWithItself()
    {
        var budget = AddBudget();
        var result = await _sut.UpdateAsync(UserId, budget.Id, Request(start: Start, end: new DateOnly(2025, 1, 20)));
        Assert.Equal(new DateOnly(2025, 1, 20), result.EndDate);
    }

    [Fact]
    public async Task Update_IntoAnotherBudgetsRange_ThrowsConflict()
    {
        AddBudget();
        var second = AddBudget(start: new DateOnly(2025, 3, 1), end: new DateOnly(2025, 3, 31));
        await Assert.ThrowsAsync<ConflictException>(() => _sut.UpdateAsync(UserId, second.Id, Request()));
    }

    [Fact]
    public async Task Update_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.UpdateAsync(UserId, Guid.NewGuid(), Request()));

    [Fact]
    public async Task Update_OfAnotherUser_ThrowsNotFound()
    {
        var budget = AddBudget(userId: OtherUserId);
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.UpdateAsync(UserId, budget.Id, Request()));
    }

    [Fact]
    public async Task Update_EndBeforeStart_ThrowsBadRequest()
    {
        var budget = AddBudget();
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.UpdateAsync(UserId, budget.Id, Request(start: End, end: Start)));
    }

    [Fact]
    public async Task Update_ToIncomeCategory_ThrowsBadRequest()
    {
        var budget = AddBudget();
        var salary = AddCategory("Salary", CategoryType.Income);
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.UpdateAsync(UserId, budget.Id, Request(categoryId: salary.Id)));
    }

    // ---- Delete ----

    [Fact]
    public async Task Delete_RemovesBudget()
    {
        var budget = AddBudget();
        await _sut.DeleteAsync(UserId, budget.Id);
        Assert.Empty(Db.Budgets);
    }

    [Fact]
    public async Task Delete_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.DeleteAsync(UserId, Guid.NewGuid()));

    [Fact]
    public async Task Delete_OfAnotherUser_ThrowsNotFoundAndKeepsIt()
    {
        var budget = AddBudget(userId: OtherUserId);
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.DeleteAsync(UserId, budget.Id));
        Assert.Single(Db.Budgets);
    }

    // ---- Alerts ----

    [Fact]
    public async Task CheckAlerts_NoBudgetForCategory_SendsNothing()
    {
        AddTransaction(_account, _food, 5_000m, date: MidJan);
        await _sut.CheckAlertsAsync(UserId, _food.Id, MidJan);
        Assert.Empty(_notifications.Created);
    }

    [Fact]
    public async Task CheckAlerts_BelowThreshold_SendsNothing()
    {
        AddBudget(1_000m);
        AddTransaction(_account, _food, 500m, date: MidJan);
        await _sut.CheckAlertsAsync(UserId, _food.Id, MidJan);
        Assert.Empty(_notifications.Created);
    }

    [Fact]
    public async Task CheckAlerts_ReachingThreshold_SendsWarning()
    {
        var budget = AddBudget(1_000m);
        AddTransaction(_account, _food, 850m, date: MidJan);
        await _sut.CheckAlertsAsync(UserId, _food.Id, MidJan);
        var sent = Assert.Single(_notifications.Created);
        Assert.Equal("Sắp vượt ngân sách Food", sent.Title);
        Assert.Equal(NotificationType.Warning, sent.Type);
        Assert.Equal(NotificationSource.Budget, sent.Source);
        Assert.Equal("Budget", sent.RelatedType);
        Assert.Equal(budget.Id, sent.RelatedId);
        Assert.Equal(UserId, sent.UserId);
    }

    [Fact]
    public async Task CheckAlerts_SpendingExactlyTheBudget_SendsReachedNotice()
    {
        AddBudget(1_000m);
        AddTransaction(_account, _food, 1_000m, date: MidJan);
        await _sut.CheckAlertsAsync(UserId, _food.Id, MidJan);
        Assert.Equal("Đạt ngân sách Food", Assert.Single(_notifications.Created).Title);
    }

    [Fact]
    public async Task CheckAlerts_Overspending_SendsExceededNotice()
    {
        AddBudget(1_000m);
        AddTransaction(_account, _food, 1_200m, date: MidJan);
        await _sut.CheckAlertsAsync(UserId, _food.Id, MidJan);
        Assert.Equal("Vượt ngân sách Food", Assert.Single(_notifications.Created).Title);
    }

    [Fact]
    public async Task CheckAlerts_SameLevelAlreadySent_IsNotRepeated()
    {
        var budget = AddBudget(1_000m);
        AddTransaction(_account, _food, 1_200m, date: MidJan);
        Db.Notifications.Add(new Notification
        {
            UserId = UserId, Title = "Vượt ngân sách Food", Message = "x", RelatedType = "Budget", RelatedId = budget.Id
        });
        Db.SaveChanges();
        await _sut.CheckAlertsAsync(UserId, _food.Id, MidJan);
        Assert.Empty(_notifications.Created);
    }

    [Fact]
    public async Task CheckAlerts_HigherLevelIsStillSentAfterLowerLevel()
    {
        var budget = AddBudget(1_000m);
        AddTransaction(_account, _food, 1_200m, date: MidJan);
        Db.Notifications.Add(new Notification
        {
            UserId = UserId, Title = "Sắp vượt ngân sách Food", Message = "x", RelatedType = "Budget", RelatedId = budget.Id
        });
        Db.SaveChanges();
        await _sut.CheckAlertsAsync(UserId, _food.Id, MidJan);
        Assert.Equal("Vượt ngân sách Food", Assert.Single(_notifications.Created).Title);
    }

    [Fact]
    public async Task CheckAlerts_DateOutsideBudgetRange_SendsNothing()
    {
        AddBudget(1_000m);
        AddTransaction(_account, _food, 5_000m, date: MidJan);
        await _sut.CheckAlertsAsync(UserId, _food.Id, new DateTime(2025, 6, 1, 0, 0, 0, DateTimeKind.Utc));
        Assert.Empty(_notifications.Created);
    }

    [Fact]
    public async Task CheckAlerts_OtherUsersBudgetIsIgnored()
    {
        var system = AddCategory("Shared", system: true);
        AddBudget(1_000m, category: system, userId: OtherUserId);
        var theirs = AddAccount(OtherUserId, "Theirs");
        AddTransaction(theirs, system, 5_000m, date: MidJan);
        await _sut.CheckAlertsAsync(UserId, system.Id, MidJan);
        Assert.Empty(_notifications.Created);
    }

    [Fact]
    public async Task CheckAlerts_CustomThresholdIsRespected()
    {
        AddBudget(1_000m, threshold: 50);
        AddTransaction(_account, _food, 500m, date: MidJan);
        await _sut.CheckAlertsAsync(UserId, _food.Id, MidJan);
        Assert.Single(_notifications.Created);
    }

    [Fact]
    public async Task Create_WhenSpendingAlreadyExceedsAmount_SendsAlertImmediately()
    {
        AddTransaction(_account, _food, 5_000m, date: MidJan);
        await _sut.CreateAsync(UserId, Request(1_000m));
        Assert.Equal("Vượt ngân sách Food", Assert.Single(_notifications.Created).Title);
    }

    [Fact]
    public async Task Create_WithNoSpending_SendsNoAlert()
    {
        await _sut.CreateAsync(UserId, Request(1_000m));
        Assert.Empty(_notifications.Created);
    }
}
