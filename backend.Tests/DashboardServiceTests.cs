using System.Text.Json;
using backend.DTOs.Requests;
using backend.Helpers;
using backend.Models;
using backend.Services.Implementations;
using Microsoft.Extensions.Logging.Abstractions;

namespace backend.Tests;

public class DashboardServiceTests : DbTestBase
{
    private readonly FakeNotifications _notifications = new();
    private readonly DashboardService _sut;
    private readonly Account _account;
    private readonly Category _food;
    private readonly Category _transport;
    private readonly Category _salary;

    private static readonly DateTime Jan1 = new(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Jan31 = new(2025, 1, 31, 0, 0, 0, DateTimeKind.Utc);

    public DashboardServiceTests()
    {
        var budgets = new BudgetService(Db, _notifications, NullLogger<BudgetService>.Instance, TestCache.New());
        _sut = new DashboardService(Db, new AccountService(Db),
            new TransactionService(Db, budgets, NullLogger<TransactionService>.Instance), budgets,
            new FinancialGoalService(Db, _notifications, TestCache.New()), new NotificationServiceStub(_notifications, Db));
        _account = AddAccount(initial: 1_000m);
        _food = AddCategory("Food");
        _transport = AddCategory("Transport");
        _salary = AddCategory("Salary", CategoryType.Income);
    }

    private static DateTime Jan(int day, int hour = 0) => new(2025, 1, day, hour, 0, 0, DateTimeKind.Utc);

    // ---- Report ----

    [Fact]
    public async Task Report_NoTransactions_IsAllZero()
    {
        var report = await _sut.GetReportAsync(UserId, Jan1, Jan31);
        Assert.Equal(0m, report.TotalIncome);
        Assert.Equal(0m, report.TotalExpense);
        Assert.Equal(0m, report.NetSavings);
        Assert.Equal(0, report.TransactionCount);
        Assert.Empty(report.ExpenseByCategory);
        Assert.Empty(report.IncomeByCategory);
    }

    [Fact]
    public async Task Report_TotalsAndNetSavings()
    {
        AddTransaction(_account, _salary, 5_000m, TransactionType.Income, Jan(5));
        AddTransaction(_account, _food, 300m, date: Jan(6));
        AddTransaction(_account, _transport, 200m, date: Jan(7));
        var report = await _sut.GetReportAsync(UserId, Jan1, Jan31);
        Assert.Equal(5_000m, report.TotalIncome);
        Assert.Equal(500m, report.TotalExpense);
        Assert.Equal(4_500m, report.NetSavings);
        Assert.Equal(3, report.TransactionCount);
    }

    [Fact]
    public async Task Report_ExpenseBreakdownIsSortedWithPercentages()
    {
        AddTransaction(_account, _food, 300m, date: Jan(6));
        AddTransaction(_account, _transport, 100m, date: Jan(7));
        var report = await _sut.GetReportAsync(UserId, Jan1, Jan31);
        Assert.Equal(["Food", "Transport"], report.ExpenseByCategory.Select(c => c.CategoryName));
        Assert.Equal([75m, 25m], report.ExpenseByCategory.Select(c => c.Percent));
    }

    [Fact]
    public async Task Report_PercentagesAreRoundedToTwoDecimals()
    {
        AddTransaction(_account, _food, 1m, date: Jan(6));
        AddTransaction(_account, _transport, 2m, date: Jan(7));
        var report = await _sut.GetReportAsync(UserId, Jan1, Jan31);
        Assert.Equal(66.67m, report.ExpenseByCategory[0].Percent);
        Assert.Equal(33.33m, report.ExpenseByCategory[1].Percent);
    }

    [Fact]
    public async Task Report_IncomeBreakdownIsSeparateFromExpense()
    {
        AddTransaction(_account, _salary, 100m, TransactionType.Income, Jan(5));
        AddTransaction(_account, _food, 40m, date: Jan(6));
        var report = await _sut.GetReportAsync(UserId, Jan1, Jan31);
        Assert.Equal("Salary", Assert.Single(report.IncomeByCategory).CategoryName);
        Assert.Equal(100m, report.IncomeByCategory[0].Percent);
        Assert.Equal("Food", Assert.Single(report.ExpenseByCategory).CategoryName);
    }

    [Fact]
    public async Task Report_OnlyIncludesTheUsersOwnTransactionsInRange()
    {
        var theirs = AddAccount(OtherUserId, "Theirs");
        var system = AddCategory("Shared", system: true);
        AddTransaction(theirs, system, 999m, date: Jan(6));
        AddTransaction(_account, _food, 10m, date: Jan(6));
        AddTransaction(_account, _food, 77m, date: Jan(6).AddMonths(-2));
        var report = await _sut.GetReportAsync(UserId, Jan1, Jan31);
        Assert.Equal(10m, report.TotalExpense);
    }

    [Fact]
    public async Task Report_LastDayOfRangeIsIncluded()
    {
        AddTransaction(_account, _food, 10m, date: Jan(31, 18));
        Assert.Equal(10m, (await _sut.GetReportAsync(UserId, Jan1, Jan31)).TotalExpense);
    }

    [Fact]
    public async Task Report_ToBeforeFrom_ThrowsBadRequest() =>
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.GetReportAsync(UserId, Jan31, Jan1));

    [Fact]
    public async Task Report_MoreThanTenYears_ThrowsBadRequest() =>
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.GetReportAsync(UserId, Jan1, Jan1.AddYears(11)));

    [Fact]
    public async Task Report_ShortRangeHasDailyTrend()
    {
        var report = await _sut.GetReportAsync(UserId, Jan1, Jan31);
        Assert.Equal(31, report.Trend.Count);
    }

    [Fact]
    public async Task Report_LongRangeHasMonthlyTrend()
    {
        var report = await _sut.GetReportAsync(UserId, Jan1, new DateTime(2025, 12, 31, 0, 0, 0, DateTimeKind.Utc));
        Assert.Equal(12, report.Trend.Count);
    }

    // ---- Trend ----

    [Fact]
    public async Task Trend_DailyFillsEmptyDays()
    {
        AddTransaction(_account, _food, 10m, date: Jan(3));
        var trend = await _sut.GetTrendAsync(UserId, Jan(1), Jan(5));
        Assert.Equal(5, trend.Count);
        Assert.Equal(10m, trend.Single(p => p.Date == Jan(3)).Expense);
        Assert.Equal(0m, trend.Single(p => p.Date == Jan(2)).Expense);
    }

    [Fact]
    public async Task Trend_DailySumsIncomeAndExpenseOfTheSameDay()
    {
        AddTransaction(_account, _food, 10m, date: Jan(3, 8));
        AddTransaction(_account, _food, 15m, date: Jan(3, 20));
        AddTransaction(_account, _salary, 100m, TransactionType.Income, Jan(3, 9));
        var point = (await _sut.GetTrendAsync(UserId, Jan(1), Jan(5))).Single(p => p.Date == Jan(3));
        Assert.Equal(25m, point.Expense);
        Assert.Equal(100m, point.Income);
    }

    [Fact]
    public async Task Trend_MonthlyGroupsByMonth()
    {
        AddTransaction(_account, _food, 10m, date: new DateTime(2025, 1, 5, 0, 0, 0, DateTimeKind.Utc));
        AddTransaction(_account, _food, 20m, date: new DateTime(2025, 1, 25, 0, 0, 0, DateTimeKind.Utc));
        AddTransaction(_account, _food, 5m, date: new DateTime(2025, 2, 3, 0, 0, 0, DateTimeKind.Utc));
        var trend = await _sut.GetTrendAsync(UserId, Jan1, new DateTime(2025, 3, 31, 0, 0, 0, DateTimeKind.Utc), groupByMonth: true);
        Assert.Equal(3, trend.Count);
        Assert.Equal([30m, 5m, 0m], trend.Select(p => p.Expense));
    }

    [Fact]
    public async Task Trend_DailyOver366Days_ThrowsBadRequest() =>
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.GetTrendAsync(UserId, Jan1, Jan1.AddDays(400), groupByMonth: false));

    [Fact]
    public async Task Trend_MonthlyOver366Days_IsAllowed()
    {
        var trend = await _sut.GetTrendAsync(UserId, Jan1, Jan1.AddDays(400), groupByMonth: true);
        Assert.True(trend.Count >= 13);
    }

    [Fact]
    public async Task Trend_PointsAreInChronologicalOrder()
    {
        var trend = await _sut.GetTrendAsync(UserId, Jan(1), Jan(10));
        Assert.Equal(trend.OrderBy(p => p.Date).Select(p => p.Date), trend.Select(p => p.Date));
    }

    // ---- Overview ----

    [Fact]
    public async Task Overview_CombinesBalanceTotalsAndLists()
    {
        AddTransaction(_account, _salary, 500m, TransactionType.Income, Jan(5));
        AddTransaction(_account, _food, 200m, date: Jan(6));
        Db.FinancialGoals.Add(new FinancialGoal { UserId = UserId, Name = "Trip", TargetAmount = 1_000m });
        Db.Notifications.Add(new Notification { UserId = UserId, Title = "t", Message = "m" });
        Db.SaveChanges();
        var overview = await _sut.GetOverviewAsync(UserId, Jan1, Jan31);
        Assert.Equal(1_300m, overview.TotalBalance);
        Assert.Equal(500m, overview.TotalIncome);
        Assert.Equal(200m, overview.TotalExpense);
        Assert.Equal(300m, overview.NetSavings);
        Assert.Equal(2, overview.RecentTransactions.Count);
        Assert.Single(overview.Goals);
        Assert.Equal(1, overview.UnreadNotifications);
    }

    [Fact]
    public async Task Overview_RecentTransactionsAreCappedAtFiveNewestFirst()
    {
        for (var i = 1; i <= 8; i++) AddTransaction(_account, _food, i, date: Jan(i));
        var overview = await _sut.GetOverviewAsync(UserId, Jan1, Jan31);
        Assert.Equal(5, overview.RecentTransactions.Count);
        Assert.Equal(8m, overview.RecentTransactions[0].Amount);
    }

    [Fact]
    public async Task Overview_OnlyActiveGoalsAreListed()
    {
        Db.FinancialGoals.Add(new FinancialGoal { UserId = UserId, Name = "A", TargetAmount = 10m });
        Db.FinancialGoals.Add(new FinancialGoal { UserId = UserId, Name = "B", TargetAmount = 10m, Status = FinancialGoalStatus.Completed });
        Db.SaveChanges();
        var overview = await _sut.GetOverviewAsync(UserId, Jan1, Jan31);
        Assert.Equal("A", Assert.Single(overview.Goals).Name);
    }

    [Fact]
    public async Task Overview_ArchivedAccountsAreNotInTheBalance()
    {
        AddAccount(name: "Old", initial: 9_999m, archived: true);
        var overview = await _sut.GetOverviewAsync(UserId, Jan1, Jan31);
        Assert.Equal(1_000m, overview.TotalBalance);
    }

    [Fact]
    public async Task Overview_DefaultRangeIsTheCurrentMonth()
    {
        var overview = await _sut.GetOverviewAsync(UserId);
        var now = DateTime.UtcNow;
        Assert.Equal(new DateTime(now.Year, now.Month, 1), overview.From.Date);
        Assert.Equal(DateTime.DaysInMonth(now.Year, now.Month), overview.To.Day);
    }

    [Fact]
    public async Task Overview_InvalidRange_ThrowsBadRequest() =>
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.GetOverviewAsync(UserId, Jan31, Jan1));

    [Fact]
    public async Task Overview_OtherUsersDataIsNotMixedIn()
    {
        var theirs = AddAccount(OtherUserId, "Theirs", 5_000m);
        AddTransaction(theirs, AddCategory("X", userId: OtherUserId), 100m, date: Jan(5));
        var overview = await _sut.GetOverviewAsync(UserId, Jan1, Jan31);
        Assert.Equal(1_000m, overview.TotalBalance);
        Assert.Empty(overview.RecentTransactions);
    }

    // ---- Snapshots ----

    [Fact]
    public async Task Snapshot_MonthCoversTheWholeMonthOfTheReferenceDate()
    {
        var snapshot = await _sut.CreateSnapshotAsync(UserId, ReportPeriodType.Month, new DateOnly(2025, 2, 14));
        Assert.Equal(new DateOnly(2025, 2, 1), snapshot.PeriodStart);
        Assert.Equal(new DateOnly(2025, 2, 28), snapshot.PeriodEnd);
    }

    [Theory]
    [InlineData(2025, 1, 15, 2025, 1, 13, 2025, 1, 19)] // Wednesday
    [InlineData(2025, 1, 13, 2025, 1, 13, 2025, 1, 19)] // Monday
    [InlineData(2025, 1, 19, 2025, 1, 13, 2025, 1, 19)] // Sunday
    [InlineData(2025, 1, 1, 2024, 12, 30, 2025, 1, 5)]  // crosses the year boundary
    public async Task Snapshot_WeekRunsMondayToSunday(int y, int m, int d, int sy, int sm, int sd, int ey, int em, int ed)
    {
        var snapshot = await _sut.CreateSnapshotAsync(UserId, ReportPeriodType.Week, new DateOnly(y, m, d));
        Assert.Equal(new DateOnly(sy, sm, sd), snapshot.PeriodStart);
        Assert.Equal(new DateOnly(ey, em, ed), snapshot.PeriodEnd);
    }

    [Fact]
    public async Task Snapshot_ContainsTheReportData()
    {
        AddTransaction(_account, _food, 120m, date: Jan(10));
        var snapshot = await _sut.CreateSnapshotAsync(UserId, ReportPeriodType.Month, new DateOnly(2025, 1, 10));
        Assert.Equal(120m, snapshot.Data.TotalExpense);
        Assert.Equal("Food", Assert.Single(snapshot.Data.ExpenseByCategory).CategoryName);
    }

    [Fact]
    public async Task Snapshot_SamePeriodTwice_UpdatesInsteadOfDuplicating()
    {
        var reference = new DateOnly(2025, 1, 10);
        var first = await _sut.CreateSnapshotAsync(UserId, ReportPeriodType.Month, reference);
        AddTransaction(_account, _food, 50m, date: Jan(10));
        var second = await _sut.CreateSnapshotAsync(UserId, ReportPeriodType.Month, reference);
        Assert.Equal(first.Id, second.Id);
        Assert.Single(Db.ReportSnapshots);
        Assert.Equal(50m, second.Data.TotalExpense);
    }

    [Fact]
    public async Task Snapshot_DifferentPeriodTypesAreSeparate()
    {
        var reference = new DateOnly(2025, 1, 10);
        await _sut.CreateSnapshotAsync(UserId, ReportPeriodType.Month, reference);
        await _sut.CreateSnapshotAsync(UserId, ReportPeriodType.Week, reference);
        Assert.Equal(2, Db.ReportSnapshots.Count());
    }

    [Fact]
    public async Task GetSnapshots_NewestPeriodFirstAndFilteredByType()
    {
        await _sut.CreateSnapshotAsync(UserId, ReportPeriodType.Month, new DateOnly(2025, 1, 10));
        await _sut.CreateSnapshotAsync(UserId, ReportPeriodType.Month, new DateOnly(2025, 3, 10));
        await _sut.CreateSnapshotAsync(UserId, ReportPeriodType.Week, new DateOnly(2025, 2, 10));
        var months = await _sut.GetSnapshotsAsync(UserId, ReportPeriodType.Month, new PagingQuery());
        Assert.Equal([3, 1], months.Items.Select(s => s.PeriodStart.Month));
        var all = await _sut.GetSnapshotsAsync(UserId, null, new PagingQuery());
        Assert.Equal(3, all.TotalCount);
    }

    [Fact]
    public async Task GetSnapshots_OnlyOwnSnapshots()
    {
        await _sut.CreateSnapshotAsync(UserId, ReportPeriodType.Month, new DateOnly(2025, 1, 10));
        await _sut.CreateSnapshotAsync(OtherUserId, ReportPeriodType.Month, new DateOnly(2025, 1, 10));
        var result = await _sut.GetSnapshotsAsync(UserId, null, new PagingQuery());
        Assert.Equal(1, result.TotalCount);
    }

    [Fact]
    public async Task GetSnapshots_SkipsRowsWithCorruptJson()
    {
        await _sut.CreateSnapshotAsync(UserId, ReportPeriodType.Month, new DateOnly(2025, 1, 10));
        Db.ReportSnapshots.Add(new ReportSnapshot
        {
            UserId = UserId, PeriodType = ReportPeriodType.Month, PeriodStart = new DateOnly(2025, 2, 1),
            PeriodEnd = new DateOnly(2025, 2, 28), DataJson = "null"
        });
        Db.SaveChanges();
        var result = await _sut.GetSnapshotsAsync(UserId, null, new PagingQuery());
        Assert.Single(result.Items);
    }

    [Fact]
    public async Task GetSnapshots_Pages()
    {
        for (var m = 1; m <= 5; m++)
            await _sut.CreateSnapshotAsync(UserId, ReportPeriodType.Month, new DateOnly(2025, m, 10));
        var result = await _sut.GetSnapshotsAsync(UserId, null, new PagingQuery { Page = 2, PageSize = 2 });
        Assert.Equal([3, 2], result.Items.Select(s => s.PeriodStart.Month));
        Assert.Equal(3, result.TotalPages);
    }
}

/// <summary>Thin INotificationService that reads real data (Dashboard only needs the unread count).</summary>
internal sealed class NotificationServiceStub(FakeNotifications inner, backend.Data.AppDbContext db)
    : backend.Services.Interfaces.INotificationService
{
    public Task<int> GetUnreadCountAsync(Guid userId, CancellationToken cancellationToken = default) =>
        Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions
            .CountAsync(db.Notifications, n => n.UserId == userId && !n.IsRead, cancellationToken);

    public Task CreateAsync(Guid userId, NotificationType type, NotificationSource source, string title, string message,
        string? relatedType = null, Guid? relatedId = null, CancellationToken cancellationToken = default) =>
        inner.CreateAsync(userId, type, source, title, message, relatedType, relatedId, cancellationToken);

    public Task<backend.DTOs.Responses.PagedResult<backend.DTOs.Responses.NotificationResponse>> GetPagedAsync(
        Guid userId, NotificationQuery query, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();
    public Task MarkReadAsync(Guid userId, Guid id, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();
    public Task MarkAllReadAsync(Guid userId, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();
    public Task DeleteAsync(Guid userId, Guid id, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();
}
