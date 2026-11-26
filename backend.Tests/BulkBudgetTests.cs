using backend.DTOs.Requests;
using backend.Helpers;
using backend.Models;
using backend.Services.Implementations;
using Microsoft.Extensions.Logging.Abstractions;

namespace backend.Tests;

/// <summary>Several budgets at once (POST /api/budgets/bulk and AI budget proposals): all of them or none.</summary>
public class BulkBudgetTests : DbTestBase
{
    private readonly BudgetService _sut;
    private readonly Category _food, _transport, _fun;

    private static readonly DateOnly Start = new(2025, 1, 1);
    private static readonly DateOnly End = new(2025, 1, 31);

    public BulkBudgetTests()
    {
        _sut = new BudgetService(Db, new FakeNotifications(), NullLogger<BudgetService>.Instance, TestCache.New());
        _food = AddCategory("Food");
        _transport = AddCategory("Transport");
        _fun = AddCategory("Fun");
    }

    private static UpsertBudgetRequest Request(Category category, decimal amount = 1_000m, DateOnly? start = null, DateOnly? end = null) =>
        new(category.Id, amount, start ?? Start, end ?? End);

    private int Budgets() => Db.Budgets.Count(b => b.UserId == UserId);

    [Fact]
    public async Task CreateMany_CreatesEveryBudget()
    {
        var result = await _sut.CreateManyAsync(UserId, [Request(_food, 1_000m), Request(_transport, 2_000m)]);
        Assert.Equal(2, result.Count);
        Assert.All(result, b => Assert.NotEqual(Guid.Empty, b.Id));
        Assert.Equal(2_000m, result.Single(b => b.CategoryId == _transport.Id).Amount);
        Assert.Equal(2, Budgets());
    }

    [Fact]
    public async Task CreateMany_ExistingOverlappingBudget_IsAConflictAndNothingIsCreated()
    {
        await _sut.CreateAsync(UserId, Request(_food, 500m));
        var error = await Assert.ThrowsAsync<ConflictException>(() =>
            _sut.CreateManyAsync(UserId, [Request(_transport), Request(_food, 9m)]));
        Assert.Contains("Food", error.Message);
        Assert.Equal(1, Budgets());                                         // rolled back: Transport not created
        Assert.Equal(500m, Db.Budgets.Single(b => b.CategoryId == _food.Id).Amount); // not overwritten
    }

    [Fact]
    public async Task CreateMany_SameCategoryTwice_IsRejected()
    {
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.CreateManyAsync(UserId, [Request(_food), Request(_food, 2_000m)]));
        Assert.Equal(0, Budgets());
    }

    [Fact]
    public async Task CreateMany_SameCategoryInDifferentMonths_IsAllowed()
    {
        var result = await _sut.CreateManyAsync(UserId,
            [Request(_food), Request(_food, start: new DateOnly(2025, 2, 1), end: new DateOnly(2025, 2, 28))]);
        Assert.Equal(2, result.Count);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public async Task CreateMany_AmountNotAboveZero_IsRejected(int amount)
    {
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.CreateManyAsync(UserId, [Request(_food), Request(_transport, amount)]));
        Assert.Equal(0, Budgets());
    }

    [Fact]
    public async Task CreateMany_UnknownCategory_IsRejected()
    {
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.CreateManyAsync(UserId, [Request(_food), new UpsertBudgetRequest(Guid.NewGuid(), 1_000m, Start, End)]));
        Assert.Equal(0, Budgets());
    }

    [Fact]
    public async Task CreateMany_CategoryOfAnotherUser_IsRejected()
    {
        var theirs = AddCategory("Theirs", userId: OtherUserId);
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.CreateManyAsync(UserId, [Request(_food), Request(theirs)]));
        Assert.Equal(0, Budgets());
    }

    [Fact]
    public async Task CreateMany_IncomeCategory_IsRejected()
    {
        var salary = AddCategory("Salary", CategoryType.Income);
        var error = await Assert.ThrowsAsync<BadRequestException>(() => _sut.CreateManyAsync(UserId, [Request(salary)]));
        Assert.Contains("Salary", error.Message);
    }

    [Fact]
    public async Task CreateMany_EmptyOrTooMany_IsRejected()
    {
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.CreateManyAsync(UserId, []));
        var many = Enumerable.Range(0, BulkCreateBudgetsRequest.MaxItems + 1)
            .Select(i => Request(_food, start: Start.AddMonths(i), end: Start.AddMonths(i + 1).AddDays(-1))).ToList();
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.CreateManyAsync(UserId, many));
    }

    [Fact]
    public async Task CreateMany_AnotherUsersBudgetDoesNotConflict()
    {
        Db.Budgets.Add(new Budget { UserId = OtherUserId, CategoryId = _fun.Id, Amount = 1m, StartDate = Start, EndDate = End });
        Db.SaveChanges();
        Assert.Single(await _sut.CreateManyAsync(UserId, [Request(_fun)]));
    }

    [Fact]
    public async Task CreateForPeriod_UsesTheWholeMonth()
    {
        var next = DateOnly.FromDateTime(DateTime.UtcNow).AddMonths(1);
        var period = BudgetPeriod.Format(next);
        var result = await _sut.CreateForPeriodAsync(UserId, new BulkCreateBudgetsRequest(period, [new BulkBudgetItem(_food.Id, 3_000m)]));
        Assert.Equal(period, result.Period);
        Assert.Equal(1, result.StartDate.Day);
        Assert.Equal(result.StartDate.AddMonths(1).AddDays(-1), result.EndDate);
        Assert.Equal(80, Assert.Single(result.Budgets).AlertThreshold);
    }

    [Theory]
    [InlineData("2025-13")]
    [InlineData("2025-1")]
    [InlineData("abc")]
    [InlineData("")]
    public async Task CreateForPeriod_InvalidPeriod_IsRejected(string period)
    {
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.CreateForPeriodAsync(UserId, new BulkCreateBudgetsRequest(period, [new BulkBudgetItem(_food.Id, 1m)])));
    }

    [Fact]
    public async Task CreateForPeriod_PastOrTooFarAhead_IsRejected()
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        foreach (var month in new[] { today.AddMonths(-2), today.AddMonths(BudgetPeriod.MaxMonthsAhead + 2) })
            await Assert.ThrowsAsync<BadRequestException>(() => _sut.CreateForPeriodAsync(UserId,
                new BulkCreateBudgetsRequest(BudgetPeriod.Format(month), [new BulkBudgetItem(_food.Id, 1m)])));
        Assert.Equal(0, Budgets());
    }

    [Fact]
    public void BudgetPeriod_ParsesAMonth()
    {
        Assert.True(BudgetPeriod.TryParse("2024-02", out var start, out var end));
        Assert.Equal(new DateOnly(2024, 2, 1), start);
        Assert.Equal(new DateOnly(2024, 2, 29), end); // leap year
        Assert.False(BudgetPeriod.TryParse("2024-02-01", out _, out _));
    }
}
