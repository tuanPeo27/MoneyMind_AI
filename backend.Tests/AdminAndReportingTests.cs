using System.Reflection;
using System.Security.Cryptography;
using backend.DTOs.Requests;
using backend.Helpers;
using backend.Models;
using backend.Options;
using backend.Services.Implementations;
using backend.Services.Interfaces;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace backend.Tests;

public class AuditServiceTests : DbTestBase
{
    private readonly FakeCurrentUser _current = new(UserId, true);
    private readonly AuditService _sut;

    public AuditServiceTests() => _sut = new AuditService(Db, _current);

    private static readonly DateTime Jan1 = new(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    private void Add(string action, string target, Guid? admin = null, DateTime? at = null)
    {
        Db.AuditLogs.Add(new AuditLog
        {
            AdminId = admin ?? UserId, Action = action, TargetType = target, CreatedAt = at ?? Jan1
        });
        Db.SaveChanges();
    }

    [Fact]
    public async Task Log_StoresAdminIpAndDetails()
    {
        var target = Guid.NewGuid();
        await _sut.LogAsync("Act", "User", target, "detail");
        var log = Assert.Single(Db.AuditLogs);
        Assert.Equal(UserId, log.AdminId);
        Assert.Equal("Act", log.Action);
        Assert.Equal("User", log.TargetType);
        Assert.Equal(target, log.TargetId);
        Assert.Equal("detail", log.Detail);
        Assert.Equal("127.0.0.1", log.IpAddress);
    }

    [Fact]
    public async Task Log_TruncatesLongValues()
    {
        await _sut.LogAsync(new string('a', 150), new string('t', 150), null, new string('d', 2500));
        var log = Assert.Single(Db.AuditLogs);
        Assert.Equal(100, log.Action.Length);
        Assert.Equal(100, log.TargetType.Length);
        Assert.Equal(2000, log.Detail!.Length);
    }

    [Fact]
    public async Task Log_NullDetailStaysNull()
    {
        await _sut.LogAsync("Act", "User");
        Assert.Null(Db.AuditLogs.Single().Detail);
    }

    [Fact]
    public async Task Log_Anonymous_Throws()
    {
        _current.UserId = null;
        await Assert.ThrowsAsync<InvalidOperationException>(() => _sut.LogAsync("Act", "User"));
    }

    [Fact]
    public async Task GetPaged_NewestFirstWithTotals()
    {
        Add("old", "User", at: Jan1);
        Add("new", "User", at: Jan1.AddDays(5));
        var result = await _sut.GetPagedAsync(new AuditLogQuery());
        Assert.Equal(["new", "old"], result.Items.Select(l => l.Action));
        Assert.Equal(2, result.TotalCount);
    }

    [Fact]
    public async Task GetPaged_FiltersByAdmin()
    {
        Add("a", "User", UserId);
        Add("b", "User", OtherUserId);
        var result = await _sut.GetPagedAsync(new AuditLogQuery { AdminId = OtherUserId });
        Assert.Equal("b", Assert.Single(result.Items).Action);
    }

    [Fact]
    public async Task GetPaged_FiltersByActionAndTargetType()
    {
        Add("Lock", "User");
        Add("Lock", "Category");
        Add("Unlock", "User");
        var result = await _sut.GetPagedAsync(new AuditLogQuery { Action = "Lock", TargetType = "User" });
        Assert.Single(result.Items);
    }

    [Fact]
    public async Task GetPaged_FiltersByDateRangeWithInclusiveDateOnlyEnd()
    {
        Add("a", "User", at: Jan1);
        Add("b", "User", at: Jan1.AddDays(1).AddHours(10));
        Add("c", "User", at: Jan1.AddDays(2));
        var result = await _sut.GetPagedAsync(new AuditLogQuery { From = Jan1.AddDays(1), To = Jan1.AddDays(1) });
        Assert.Equal("b", Assert.Single(result.Items).Action);
    }

    [Fact]
    public async Task GetPaged_BlankFiltersAreIgnored()
    {
        Add("a", "User");
        var result = await _sut.GetPagedAsync(new AuditLogQuery { Action = " ", TargetType = "" });
        Assert.Single(result.Items);
    }

    [Fact]
    public async Task GetPaged_Pages()
    {
        for (var i = 0; i < 5; i++) Add("a" + i, "User", at: Jan1.AddDays(i));
        var result = await _sut.GetPagedAsync(new AuditLogQuery { Page = 2, PageSize = 2 });
        Assert.Equal(["a2", "a1"], result.Items.Select(l => l.Action));
        Assert.Equal(3, result.TotalPages);
    }
}

public class AIProcessingLogServiceTests : DbTestBase
{
    private readonly AIProcessingLogService _sut;
    private static readonly DateTime Jan1 = new(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    public AIProcessingLogServiceTests() => _sut = new AIProcessingLogService(Db);

    private Task Log(string task = "Chat", AIProcessingStatus status = AIProcessingStatus.Completed, int ms = 100,
        int? tokens = null, DateTime? at = null, Guid? userId = null)
    {
        var request = Guid.NewGuid();
        Db.AIProcessingLogs.Add(new AIProcessingLog
        {
            UserId = userId ?? UserId, RequestId = request, TaskType = task, Status = status, DurationMs = ms,
            TokenUsage = tokens, CreatedAt = at ?? Jan1.AddHours(1)
        });
        return Db.SaveChangesAsync();
    }

    [Fact]
    public async Task LogAsync_StoresAllFields()
    {
        var request = Guid.NewGuid();
        await _sut.LogAsync(UserId, request, "Chat", "gemini", 250, AIProcessingStatus.Failed, "TIMEOUT", 42);
        var log = Assert.Single(Db.AIProcessingLogs);
        Assert.Equal(UserId, log.UserId);
        Assert.Equal(request, log.RequestId);
        Assert.Equal("gemini", log.Provider);
        Assert.Equal(250, log.DurationMs);
        Assert.Equal(AIProcessingStatus.Failed, log.Status);
        Assert.Equal("TIMEOUT", log.ErrorCode);
        Assert.Equal(42, log.TokenUsage);
    }

    [Fact]
    public async Task LogAsync_TruncatesTextFieldsTo100()
    {
        var text = new string('x', 150);
        await _sut.LogAsync(UserId, Guid.NewGuid(), text, text, 1, AIProcessingStatus.Completed, text);
        var log = Assert.Single(Db.AIProcessingLogs);
        Assert.Equal(100, log.TaskType.Length);
        Assert.Equal(100, log.Provider!.Length);
        Assert.Equal(100, log.ErrorCode!.Length);
    }

    [Fact]
    public async Task LogAsync_AllowsAnonymousRequests()
    {
        await _sut.LogAsync(null, Guid.NewGuid(), "Categorize", null, 1, AIProcessingStatus.Completed);
        Assert.Null(Db.AIProcessingLogs.Single().UserId);
    }

    [Fact]
    public async Task GetPaged_FiltersByTaskStatusAndUser()
    {
        await Log("Chat", AIProcessingStatus.Completed, userId: UserId);
        await Log("Chat", AIProcessingStatus.Failed, userId: OtherUserId);
        await Log("Insight", AIProcessingStatus.Failed, userId: OtherUserId);
        var result = await _sut.GetPagedAsync(new AIProcessingLogQuery
        {
            TaskType = "Chat", Status = AIProcessingStatus.Failed, UserId = OtherUserId
        });
        Assert.Single(result.Items);
    }

    [Fact]
    public async Task GetPaged_FiltersByDateRange()
    {
        await Log(at: Jan1);
        await Log(at: Jan1.AddDays(3));
        var result = await _sut.GetPagedAsync(new AIProcessingLogQuery { From = Jan1.AddDays(2), To = Jan1.AddDays(3) });
        Assert.Equal(1, result.TotalCount);
    }

    [Fact]
    public async Task GetPaged_NewestFirstAndPaged()
    {
        for (var i = 0; i < 5; i++) await Log(ms: i, at: Jan1.AddHours(i));
        var result = await _sut.GetPagedAsync(new AIProcessingLogQuery { Page = 1, PageSize = 2 });
        Assert.Equal([4, 3], result.Items.Select(l => l.DurationMs));
        Assert.Equal(5, result.TotalCount);
    }

    [Fact]
    public async Task GetStats_NoData_IsAllZero()
    {
        var stats = await _sut.GetStatsAsync(Jan1, Jan1.AddDays(1));
        Assert.Equal(0, stats.TotalRequests);
        Assert.Equal(0, stats.FailedRequests);
        Assert.Equal(0, stats.AvgDurationMs);
        Assert.Equal(0, stats.TotalTokens);
        Assert.Empty(stats.ByTask);
    }

    [Fact]
    public async Task GetStats_AggregatesTotalsAndAverages()
    {
        await Log("Chat", AIProcessingStatus.Completed, 100, 10);
        await Log("Chat", AIProcessingStatus.Failed, 300, null);
        await Log("Insight", AIProcessingStatus.Completed, 200, 5);
        var stats = await _sut.GetStatsAsync(Jan1, Jan1);
        Assert.Equal(3, stats.TotalRequests);
        Assert.Equal(1, stats.FailedRequests);
        Assert.Equal(200, stats.AvgDurationMs);
        Assert.Equal(15, stats.TotalTokens);
    }

    [Fact]
    public async Task GetStats_BreaksDownPerTaskMostFrequentFirst()
    {
        await Log("Insight");
        await Log("Chat", ms: 100);
        await Log("Chat", AIProcessingStatus.Failed, ms: 300);
        var stats = await _sut.GetStatsAsync(Jan1, Jan1);
        Assert.Equal(["Chat", "Insight"], stats.ByTask.Select(t => t.TaskType));
        var chat = stats.ByTask[0];
        Assert.Equal(2, chat.Count);
        Assert.Equal(1, chat.Failed);
        Assert.Equal(200, chat.AvgDurationMs);
    }

    [Fact]
    public async Task GetStats_IgnoresLogsOutsideTheRange()
    {
        await Log(at: Jan1.AddDays(-1));
        await Log(at: Jan1.AddDays(5));
        var stats = await _sut.GetStatsAsync(Jan1, Jan1.AddDays(1));
        Assert.Equal(0, stats.TotalRequests);
    }

    [Fact]
    public async Task GetStats_InvalidRange_ThrowsBadRequest() =>
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.GetStatsAsync(Jan1.AddDays(5), Jan1));
}

public class AdminTransactionServiceTests : DbTestBase
{
    private readonly AdminTransactionService _sut;
    private static readonly DateTime Jan10 = new(2025, 1, 10, 12, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime From = new(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime To = new(2025, 1, 31, 0, 0, 0, DateTimeKind.Utc);

    public AdminTransactionServiceTests() => _sut = new AdminTransactionService(Db);

    private Guid MoreUsers(int count)
    {
        for (var i = 0; i < count; i++) AddUser(Guid.NewGuid(), $"u{i}-{Guid.NewGuid():N}@x.com");
        return Guid.Empty;
    }

    private Transaction Tx(Guid userId, Category category, decimal amount, TransactionType type = TransactionType.Expense,
        DateTime? date = null, TransactionSource source = TransactionSource.Manual)
    {
        var account = Db.Accounts.FirstOrDefault(a => a.UserId == userId) ?? AddAccount(userId, "Acc" + Guid.NewGuid().ToString("N")[..5]);
        var t = new Transaction
        {
            UserId = userId, AccountId = account.Id, CategoryId = category.Id, Amount = amount, Type = type,
            TransactionDate = date ?? Jan10, Source = source
        };
        Db.Transactions.Add(t);
        Db.SaveChanges();
        return t;
    }

    [Fact]
    public async Task Stats_EmptyRange_ReturnsZerosAndAContinuousDailySeries()
    {
        var stats = await _sut.GetStatsAsync(From, To);
        Assert.Equal(0, stats.TransactionCount);
        Assert.Equal(0, stats.ActiveUsers);
        Assert.Equal(31, stats.Daily.Count);
        Assert.All(stats.Daily, d => Assert.Equal(0, d.Count));
        Assert.Equal(AdminTransactionService.MinGroupSize, stats.MinGroupSize);
    }

    [Fact]
    public async Task Stats_TotalsIncomeExpenseAndActiveUsers()
    {
        var food = AddCategory("Food", system: true);
        var salary = AddCategory("Salary", CategoryType.Income, system: true);
        Tx(UserId, food, 100m);
        Tx(UserId, food, 50m);
        Tx(OtherUserId, salary, 1_000m, TransactionType.Income);
        var stats = await _sut.GetStatsAsync(From, To);
        Assert.Equal(3, stats.TransactionCount);
        Assert.Equal(2, stats.ActiveUsers);
        Assert.Equal(150m, stats.TotalExpense);
        Assert.Equal(1_000m, stats.TotalIncome);
    }

    [Fact]
    public async Task Stats_IgnoresTransactionsOutsideTheRange()
    {
        var food = AddCategory("Food", system: true);
        Tx(UserId, food, 100m, date: From.AddDays(-1));
        Tx(UserId, food, 100m, date: To.AddDays(2));
        Assert.Equal(0, (await _sut.GetStatsAsync(From, To)).TransactionCount);
    }

    [Fact]
    public async Task Stats_DailySeriesHasOneEntryPerDayWithCounts()
    {
        var food = AddCategory("Food", system: true);
        Tx(UserId, food, 100m, date: new DateTime(2025, 1, 10, 8, 0, 0, DateTimeKind.Utc));
        Tx(UserId, food, 20m, date: new DateTime(2025, 1, 10, 20, 0, 0, DateTimeKind.Utc));
        var stats = await _sut.GetStatsAsync(From, To);
        var day = stats.Daily.Single(d => d.Date == new DateOnly(2025, 1, 10));
        Assert.Equal(2, day.Count);
        Assert.Equal(120m, day.Expense);
        Assert.Equal(0m, day.Income);
    }

    [Fact]
    public async Task Stats_SystemCategoryUsedByEnoughPeople_ShowsItsName()
    {
        MoreUsers(1);
        var food = AddCategory("Food", system: true);
        var users = Db.Users.Select(u => u.Id).Take(3).ToList();
        foreach (var u in users) Tx(u, food, 10m);
        var stats = await _sut.GetStatsAsync(From, To);
        var row = Assert.Single(stats.Categories);
        Assert.Equal("Food", row.CategoryName);
        Assert.Equal(30m, row.Amount);
    }

    [Fact]
    public async Task Stats_SystemCategoryUsedByFewPeople_IsMergedIntoAnonymousBucket()
    {
        var food = AddCategory("Food", system: true);
        Tx(UserId, food, 10m);
        Tx(OtherUserId, food, 20m);
        var stats = await _sut.GetStatsAsync(From, To);
        var row = Assert.Single(stats.Categories);
        Assert.Null(row.CategoryName);
        Assert.Equal(30m, row.Amount);
    }

    [Fact]
    public async Task Stats_UserCategoriesNeverRevealTheirName()
    {
        MoreUsers(1);
        var custom = AddCategory("Secret hobby", userId: UserId);
        foreach (var u in Db.Users.Select(u => u.Id).Take(3).ToList())
        {
            var cat = u == UserId ? custom : AddCategory("Secret hobby", userId: u);
            Tx(u, cat, 10m);
        }
        var stats = await _sut.GetStatsAsync(From, To);
        Assert.All(stats.Categories, c => Assert.Null(c.CategoryName));
    }

    [Fact]
    public async Task Stats_CategoriesAreOrderedByAmountDescending()
    {
        var small = AddCategory("Small", system: true);
        var big = AddCategory("Big", CategoryType.Income, system: true);
        Tx(UserId, small, 5m);
        Tx(UserId, big, 500m, TransactionType.Income);
        var stats = await _sut.GetStatsAsync(From, To);
        Assert.Equal(500m, stats.Categories[0].Amount);
    }

    [Fact]
    public async Task Stats_CountsTransactionsBySource()
    {
        var food = AddCategory("Food", system: true);
        Tx(UserId, food, 1m, source: TransactionSource.Manual);
        Tx(UserId, food, 1m, source: TransactionSource.Manual);
        Tx(UserId, food, 1m, source: TransactionSource.AIDraft);
        var stats = await _sut.GetStatsAsync(From, To);
        Assert.Equal(2, stats.Sources.Single(s => s.Source == TransactionSource.Manual).Count);
        Assert.Equal(1, stats.Sources.Single(s => s.Source == TransactionSource.AIDraft).Count);
    }

    [Fact]
    public async Task Stats_DefaultsToTheLast30Days()
    {
        var stats = await _sut.GetStatsAsync(null, null);
        Assert.Equal(30, stats.Daily.Count);
    }

    [Fact]
    public async Task Stats_RangeLongerThanAYear_ThrowsBadRequest() =>
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.GetStatsAsync(From, From.AddDays(400)));

    [Fact]
    public async Task Stats_ExactlyOneYearIsAllowed()
    {
        var stats = await _sut.GetStatsAsync(From, From.AddDays(364));
        Assert.Equal(365, stats.Daily.Count);
    }

    [Fact]
    public async Task Stats_FromAfterTo_ThrowsBadRequest() =>
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.GetStatsAsync(To, From));
}

public class GoalReminderServiceTests : DbTestBase
{
    private readonly FakeNotifications _notifications = new();
    private readonly GoalReminderService _sut;

    public GoalReminderServiceTests()
    {
        var services = new ServiceCollection();
        services.AddSingleton(Db);
        services.AddSingleton<INotificationService>(_notifications);
        _sut = new GoalReminderService(
            services.BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(),
            NullLogger<GoalReminderService>.Instance);
    }

    private Task Run(DateTime nowUtc) =>
        (Task)typeof(GoalReminderService)
            .GetMethod("SendDueRemindersAsync", BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public)!
            .Invoke(_sut, [nowUtc, CancellationToken.None])!;

    private FinancialGoal AddGoal(byte? day, FinancialGoalStatus status = FinancialGoalStatus.Active, Guid? userId = null,
        decimal target = 1_000_000m, decimal current = 250_000m)
    {
        var goal = new FinancialGoal
        {
            UserId = userId ?? UserId, Name = "Trip", TargetAmount = target, CurrentAmount = current,
            ReminderDay = day, Status = status
        };
        Db.FinancialGoals.Add(goal);
        Db.SaveChanges();
        return goal;
    }

    private static DateTime Utc(int y, int m, int d, int h = 12) => new(y, m, d, h, 0, 0, DateTimeKind.Utc);

    private void SetZone(string zone)
    {
        Db.Users.Single(u => u.Id == UserId).TimeZoneId = zone;
        Db.SaveChanges();
    }

    [Fact]
    public async Task OnTheReminderDay_SendsOneNotification()
    {
        var goal = AddGoal(15);
        SetZone("UTC");
        await Run(Utc(2025, 1, 15));
        var sent = Assert.Single(_notifications.Created);
        Assert.Equal("Đến hẹn góp quỹ", sent.Title);
        Assert.Equal(UserId, sent.UserId);
        Assert.Equal(goal.Id, sent.RelatedId);
        Assert.Equal(NotificationSource.Goal, sent.Source);
        Assert.Contains("Trip", sent.Message);
    }

    [Fact]
    public async Task OnTheReminderDay_RecordsTheLocalDate()
    {
        var goal = AddGoal(15);
        SetZone("UTC");
        await Run(Utc(2025, 1, 15));
        Db.ChangeTracker.Clear();
        Assert.Equal(new DateOnly(2025, 1, 15), Db.FinancialGoals.Single(g => g.Id == goal.Id).LastReminderOn);
    }

    [Fact]
    public async Task OnAnotherDay_SendsNothing()
    {
        AddGoal(15);
        SetZone("UTC");
        await Run(Utc(2025, 1, 14));
        Assert.Empty(_notifications.Created);
    }

    [Fact]
    public async Task RunningTwiceOnTheSameDay_SendsOnlyOnce()
    {
        AddGoal(15);
        SetZone("UTC");
        await Run(Utc(2025, 1, 15, 1));
        await Run(Utc(2025, 1, 15, 20));
        Assert.Single(_notifications.Created);
    }

    [Fact]
    public async Task NextMonth_SendsAgain()
    {
        AddGoal(15);
        SetZone("UTC");
        await Run(Utc(2025, 1, 15));
        await Run(Utc(2025, 2, 15));
        Assert.Equal(2, _notifications.Created.Count);
    }

    [Theory]
    [InlineData(2025, 4, 30)]
    [InlineData(2025, 6, 30)]
    [InlineData(2025, 2, 28)]
    [InlineData(2024, 2, 29)]
    public async Task DayPastEndOfShortMonth_FiresOnTheLastDay(int year, int month, int lastDay)
    {
        AddGoal(31);
        SetZone("UTC");
        await Run(Utc(year, month, lastDay));
        Assert.Single(_notifications.Created);
    }

    [Fact]
    public async Task Day31_InAShortMonth_DoesNotFireBeforeTheLastDay()
    {
        AddGoal(31);
        SetZone("UTC");
        await Run(Utc(2025, 4, 29));
        Assert.Empty(_notifications.Created);
    }

    [Fact]
    public async Task GoalWithoutReminderDay_IsSkipped()
    {
        AddGoal(null);
        await Run(Utc(2025, 1, 15));
        Assert.Empty(_notifications.Created);
    }

    [Theory]
    [InlineData(FinancialGoalStatus.Completed)]
    [InlineData(FinancialGoalStatus.Cancelled)]
    public async Task NonActiveGoal_IsSkipped(FinancialGoalStatus status)
    {
        AddGoal(15, status);
        SetZone("UTC");
        await Run(Utc(2025, 1, 15));
        Assert.Empty(_notifications.Created);
    }

    [Fact]
    public async Task DeactivatedUser_IsSkipped()
    {
        AddGoal(15);
        SetZone("UTC");
        Db.Users.Single(u => u.Id == UserId).IsActive = false;
        Db.SaveChanges();
        await Run(Utc(2025, 1, 15));
        Assert.Empty(_notifications.Created);
    }

    [Fact]
    public async Task UnknownTimeZone_FallsBackToUtc()
    {
        AddGoal(15);
        SetZone("Not/AZone");
        await Run(Utc(2025, 1, 15));
        Assert.Single(_notifications.Created);
    }

    [Fact]
    public async Task UsesTheOwnersLocalDate()
    {
        if (!TimeZoneInfo.TryFindSystemTimeZoneById("Asia/Ho_Chi_Minh", out _)) return;
        AddGoal(15);
        SetZone("Asia/Ho_Chi_Minh");
        // 18:00 UTC on the 14th is 01:00 on the 15th in Vietnam (UTC+7).
        await Run(Utc(2025, 1, 14, 18));
        Assert.Single(_notifications.Created);
    }

    [Fact]
    public async Task MultipleUsersAreEachNotified()
    {
        AddGoal(15);
        AddGoal(15, userId: OtherUserId);
        SetZone("UTC");
        Db.Users.Single(u => u.Id == OtherUserId).TimeZoneId = "UTC";
        Db.SaveChanges();
        await Run(Utc(2025, 1, 15));
        Assert.Equal(2, _notifications.Created.Count);
    }

    [Fact]
    public async Task GoalAlreadyMet_StillReminds_WithoutNegativeRemaining()
    {
        AddGoal(15, target: 100m, current: 500m);
        SetZone("UTC");
        await Run(Utc(2025, 1, 15));
        Assert.DoesNotContain("-", Assert.Single(_notifications.Created).Message);
    }
}

public class KeyManagementServiceTests : DbTestBase
{
    private static string Master(byte fill = 7) => Convert.ToBase64String(Enumerable.Repeat(fill, 32).Select(b => b).ToArray());

    private KeyManagementService Create(string? master = null) =>
        new(Db, Microsoft.Extensions.Options.Options.Create(new EncryptionOptions { MasterKey = master ?? Master() }));

    [Theory]
    [InlineData("not base64!!")]
    [InlineData("")]
    [InlineData("AAAA")]
    public void Constructor_InvalidMasterKey_Throws(string key) =>
        Assert.Throws<InvalidOperationException>(() => Create(key));

    [Fact]
    public async Task GetActiveKey_CreatesVersionOneOnFirstUse()
    {
        var key = await Create().GetActiveKeyAsync(UserId);
        Assert.Equal(1, key.Version);
        Assert.Equal(32, key.Key.Length);
        Assert.Single(Db.UserEncryptionKeys);
    }

    [Fact]
    public async Task GetActiveKey_ReturnsTheSameKeyOnLaterCalls()
    {
        var sut = Create();
        var a = await sut.GetActiveKeyAsync(UserId);
        var b = await sut.GetActiveKeyAsync(UserId);
        Assert.Equal(a.Key, b.Key);
        Assert.Single(Db.UserEncryptionKeys);
    }

    [Fact]
    public async Task GetActiveKey_StoresTheKeyWrappedNotInTheClear()
    {
        var key = await Create().GetActiveKeyAsync(UserId);
        var stored = Db.UserEncryptionKeys.Single().WrappedDek;
        Assert.Equal(12 + 16 + 32, stored.Length);
        Assert.False(stored.AsSpan().IndexOf(key.Key) >= 0);
    }

    [Fact]
    public async Task GetActiveKey_DifferentUsersGetDifferentKeys()
    {
        var sut = Create();
        var a = await sut.GetActiveKeyAsync(UserId);
        var b = await sut.GetActiveKeyAsync(OtherUserId);
        Assert.NotEqual(a.Key, b.Key);
    }

    [Fact]
    public async Task GetActiveKey_WithADifferentMasterKey_CannotUnwrap()
    {
        await Create(Master(7)).GetActiveKeyAsync(UserId);
        await Assert.ThrowsAnyAsync<CryptographicException>(() => Create(Master(9)).GetActiveKeyAsync(UserId));
    }

    [Fact]
    public async Task Rotate_CreatesNextVersionAndDeactivatesTheOld()
    {
        var sut = Create();
        var first = await sut.GetActiveKeyAsync(UserId);
        var version = await sut.RotateKeyAsync(UserId);
        Assert.Equal(2, version);
        var active = await sut.GetActiveKeyAsync(UserId);
        Assert.Equal(2, active.Version);
        Assert.NotEqual(first.Key, active.Key);
        Db.ChangeTracker.Clear();
        var old = Db.UserEncryptionKeys.Single(k => k.KeyVersion == 1);
        Assert.False(old.IsActive);
        Assert.NotNull(old.RotatedAt);
    }

    [Fact]
    public async Task Rotate_WithoutAnExistingKey_CreatesVersionOne() =>
        Assert.Equal(1, await Create().RotateKeyAsync(UserId));

    [Fact]
    public async Task GetKey_OldVersionsStayAvailable()
    {
        var sut = Create();
        var first = await sut.GetActiveKeyAsync(UserId);
        await sut.RotateKeyAsync(UserId);
        var old = await sut.GetKeyAsync(UserId, 1);
        Assert.Equal(first.Key, old.Key);
    }

    [Fact]
    public async Task GetKey_UnknownVersion_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => Create().GetKeyAsync(UserId, 5));

    [Fact]
    public async Task GetKey_OfAnotherUser_ThrowsNotFound()
    {
        var sut = Create();
        await sut.GetActiveKeyAsync(UserId);
        await Assert.ThrowsAsync<NotFoundException>(() => sut.GetKeyAsync(OtherUserId, 1));
    }

    [Fact]
    public async Task EncryptionService_WorksEndToEndWithTheRealKeyStore()
    {
        var encryption = new EncryptionService(Create());
        var data = await encryption.EncryptAsync(UserId, "xin chào");
        Assert.Equal("xin chào", await encryption.DecryptAsync(UserId, data.Cipher, data.Nonce, data.KeyVersion));
    }
}
