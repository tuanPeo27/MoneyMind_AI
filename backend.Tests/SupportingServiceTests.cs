using System.Security.Cryptography;
using backend.DTOs.Requests;
using backend.Helpers;
using backend.Hubs;
using backend.Models;
using backend.Services.Implementations;
using Microsoft.Extensions.Logging.Abstractions;

namespace backend.Tests;

public class NotificationServiceTests : DbTestBase
{
    private readonly FakeHub _hub = new();
    private readonly NotificationService _sut;

    public NotificationServiceTests() =>
        _sut = new NotificationService(Db, _hub, NullLogger<NotificationService>.Instance);

    private Notification Add(Guid? userId = null, bool read = false, DateTime? createdAt = null, string title = "t")
    {
        var n = new Notification
        {
            UserId = userId ?? UserId, Title = title, Message = "m", IsRead = read,
            CreatedAt = createdAt ?? DateTime.UtcNow
        };
        Db.Notifications.Add(n);
        Db.SaveChanges();
        return n;
    }

    private Task Create(string title = "Title", string message = "Message") =>
        _sut.CreateAsync(UserId, NotificationType.Info, NotificationSource.System, title, message);

    [Fact]
    public async Task Create_StoresUnreadNotification()
    {
        await _sut.CreateAsync(UserId, NotificationType.Warning, NotificationSource.Budget, "T", "M", "Budget", Guid.Empty);
        var stored = Assert.Single(Db.Notifications);
        Assert.False(stored.IsRead);
        Assert.Equal(NotificationType.Warning, stored.Type);
        Assert.Equal(NotificationSource.Budget, stored.Source);
        Assert.Equal("Budget", stored.RelatedType);
    }

    [Fact]
    public async Task Create_TruncatesTitleTo200AndMessageTo2000()
    {
        await Create(new string('t', 300), new string('m', 3000));
        var stored = Assert.Single(Db.Notifications);
        Assert.Equal(200, stored.Title.Length);
        Assert.Equal(2000, stored.Message.Length);
    }

    [Fact]
    public async Task Create_KeepsShortTextUntouched()
    {
        await Create("short", "text");
        var stored = Assert.Single(Db.Notifications);
        Assert.Equal("short", stored.Title);
        Assert.Equal("text", stored.Message);
    }

    [Fact]
    public async Task Create_PushesNotificationThenUnreadCountToTheUser()
    {
        await Create();
        var sent = _hub.ClientsImpl.Sent;
        Assert.Equal([NotificationEvents.ReceiveNotification, NotificationEvents.UnreadCountChanged],
            sent.Select(s => s.Method));
        Assert.All(sent, s => Assert.Equal(UserId.ToString(), s.User));
        Assert.Equal(1, sent[1].Args[0]);
    }

    [Fact]
    public async Task Create_HubFailure_DoesNotFailAndStillStores()
    {
        _hub.ClientsImpl.Fail = true;
        await Create();
        Assert.Single(Db.Notifications);
    }

    [Fact]
    public async Task GetPaged_ReturnsNewestFirst()
    {
        Add(createdAt: new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc), title: "old");
        Add(createdAt: new DateTime(2025, 2, 1, 0, 0, 0, DateTimeKind.Utc), title: "new");
        var result = await _sut.GetPagedAsync(UserId, new NotificationQuery());
        Assert.Equal(["new", "old"], result.Items.Select(n => n.Title));
    }

    [Fact]
    public async Task GetPaged_UnreadOnlyHidesReadOnes()
    {
        Add(read: true);
        Add(read: false);
        var result = await _sut.GetPagedAsync(UserId, new NotificationQuery { UnreadOnly = true });
        Assert.Equal(1, result.TotalCount);
        Assert.False(Assert.Single(result.Items).IsRead);
    }

    [Fact]
    public async Task GetPaged_OnlyOwnNotifications()
    {
        Add();
        Add(OtherUserId);
        Assert.Equal(1, (await _sut.GetPagedAsync(UserId, new NotificationQuery())).TotalCount);
    }

    [Fact]
    public async Task GetPaged_Pages()
    {
        for (var i = 0; i < 12; i++) Add();
        var result = await _sut.GetPagedAsync(UserId, new NotificationQuery { Page = 2, PageSize = 5 });
        Assert.Equal(5, result.Items.Count);
        Assert.Equal(12, result.TotalCount);
        Assert.Equal(3, result.TotalPages);
    }

    [Fact]
    public async Task UnreadCount_CountsOnlyOwnUnread()
    {
        Add();
        Add();
        Add(read: true);
        Add(OtherUserId);
        Assert.Equal(2, await _sut.GetUnreadCountAsync(UserId));
    }

    [Fact]
    public async Task UnreadCount_NoNotifications_IsZero() => Assert.Equal(0, await _sut.GetUnreadCountAsync(UserId));

    [Fact]
    public async Task MarkRead_SetsFlagAndPushesNewCount()
    {
        var n = Add();
        Add();
        await _sut.MarkReadAsync(UserId, n.Id);
        Db.ChangeTracker.Clear();
        Assert.True(Db.Notifications.Single(x => x.Id == n.Id).IsRead);
        var push = Assert.Single(_hub.ClientsImpl.Sent);
        Assert.Equal(NotificationEvents.UnreadCountChanged, push.Method);
        Assert.Equal(1, push.Args[0]);
    }

    [Fact]
    public async Task MarkRead_AlreadyRead_DoesNotPush()
    {
        var n = Add(read: true);
        await _sut.MarkReadAsync(UserId, n.Id);
        Assert.Empty(_hub.ClientsImpl.Sent);
    }

    [Fact]
    public async Task MarkRead_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.MarkReadAsync(UserId, Guid.NewGuid()));

    [Fact]
    public async Task MarkRead_OfAnotherUser_ThrowsNotFound()
    {
        var n = Add(OtherUserId);
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.MarkReadAsync(UserId, n.Id));
    }

    [Fact]
    public async Task MarkAllRead_MarksOnlyOwnNotifications()
    {
        Add();
        Add();
        var theirs = Add(OtherUserId);
        await _sut.MarkAllReadAsync(UserId);
        Db.ChangeTracker.Clear();
        Assert.All(Db.Notifications.Where(n => n.UserId == UserId), n => Assert.True(n.IsRead));
        Assert.False(Db.Notifications.Single(n => n.Id == theirs.Id).IsRead);
    }

    [Fact]
    public async Task MarkAllRead_PushesZeroUnread()
    {
        Add();
        await _sut.MarkAllReadAsync(UserId);
        Assert.Equal(0, Assert.Single(_hub.ClientsImpl.Sent).Args[0]);
    }

    [Fact]
    public async Task MarkAllRead_HubFailure_DoesNotThrow()
    {
        Add();
        _hub.ClientsImpl.Fail = true;
        await _sut.MarkAllReadAsync(UserId);
    }

    [Fact]
    public async Task Delete_RemovesNotification()
    {
        var n = Add();
        await _sut.DeleteAsync(UserId, n.Id);
        Assert.Empty(Db.Notifications);
    }

    [Fact]
    public async Task Delete_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.DeleteAsync(UserId, Guid.NewGuid()));

    [Fact]
    public async Task Delete_OfAnotherUser_ThrowsNotFoundAndKeepsIt()
    {
        var n = Add(OtherUserId);
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.DeleteAsync(UserId, n.Id));
        Assert.Single(Db.Notifications);
    }
}

public class AIQuotaServiceTests : DbTestBase
{
    private readonly FakeAudit _audit = new();
    private readonly FakeCurrentUser _current = new(UserId, true);
    private readonly AIQuotaService _sut;

    public AIQuotaServiceTests() => _sut = new AIQuotaService(Db, _current, _audit);

    private void SetUser(string timeZone = "UTC", int? limit = null)
    {
        var user = Db.Users.Single(u => u.Id == UserId);
        user.TimeZoneId = timeZone;
        user.AIDailyMessageLimit = limit;
        Db.SaveChanges();
    }

    private void AddChats(int count, AIProcessingStatus status = AIProcessingStatus.Completed,
        string task = "Chat", Guid? userId = null, DateTime? at = null)
    {
        for (var i = 0; i < count; i++)
            Db.AIProcessingLogs.Add(new AIProcessingLog
            {
                UserId = userId ?? UserId, RequestId = Guid.NewGuid(), TaskType = task, Status = status,
                CreatedAt = at ?? DateTime.UtcNow
            });
        Db.SaveChanges();
    }

    private void SetDefault(string value)
    {
        Db.SystemSettings.Add(new SystemSetting { Key = AIQuota.DefaultSettingKey, Value = value });
        Db.SaveChanges();
    }

    // ---- GetStatus ----

    [Fact]
    public async Task GetStatus_UsesFallbackDefaultWhenNothingConfigured()
    {
        SetUser();
        var status = await _sut.GetStatusAsync(UserId);
        Assert.Equal(20, status.DailyLimit);
        Assert.Null(status.CustomLimit);
        Assert.Equal(0, status.Used);
        Assert.Equal(20, status.Remaining);
    }

    [Fact]
    public async Task GetStatus_UsesConfiguredDefault()
    {
        SetUser();
        SetDefault("50");
        Assert.Equal(50, (await _sut.GetStatusAsync(UserId)).DailyLimit);
    }

    [Fact]
    public async Task GetStatus_CustomLimitOverridesDefault()
    {
        SetUser(limit: 10);
        SetDefault("50");
        var status = await _sut.GetStatusAsync(UserId);
        Assert.Equal(10, status.DailyLimit);
        Assert.Equal(10, status.CustomLimit);
    }

    [Fact]
    public async Task GetStatus_UnlimitedCustomLimit_HasNoDailyLimit()
    {
        SetUser(limit: AIQuota.Unlimited);
        var status = await _sut.GetStatusAsync(UserId);
        Assert.True(status.IsUnlimited);
        Assert.Null(status.Remaining);
    }

    [Fact]
    public async Task GetStatus_UnlimitedDefault_AppliesToUsersWithoutCustomLimit()
    {
        SetUser();
        SetDefault("-1");
        Assert.True((await _sut.GetStatusAsync(UserId)).IsUnlimited);
    }

    [Fact]
    public async Task GetStatus_CountsOnlyCompletedChatMessagesOfToday()
    {
        SetUser();
        AddChats(3);
        AddChats(2, AIProcessingStatus.Failed);
        AddChats(2, AIProcessingStatus.Pending);
        AddChats(4, task: "Insight");
        AddChats(5, at: DateTime.UtcNow.AddDays(-3));
        AddChats(6, userId: OtherUserId);
        Assert.Equal(3, (await _sut.GetStatusAsync(UserId)).Used);
    }

    [Fact]
    public async Task GetStatus_RemainingShrinksAsMessagesAreUsed()
    {
        SetUser(limit: 10);
        AddChats(4);
        Assert.Equal(6, (await _sut.GetStatusAsync(UserId)).Remaining);
    }

    [Fact]
    public async Task GetStatus_ResetsAtNextMidnightOfUsersZone()
    {
        SetUser("UTC");
        var status = await _sut.GetStatusAsync(UserId);
        Assert.Equal(DateTime.UtcNow.Date.AddDays(1), status.ResetsAt);
        Assert.Equal(DateTimeKind.Utc, status.ResetsAt.Kind);
    }

    [Fact]
    public async Task GetStatus_UnknownTimeZoneFallsBackToUtc()
    {
        SetUser("Not/AZone");
        var status = await _sut.GetStatusAsync(UserId);
        Assert.Equal(DateTime.UtcNow.Date.AddDays(1), status.ResetsAt);
    }

    [Fact]
    public async Task GetStatus_UnknownUser_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.GetStatusAsync(Guid.NewGuid()));

    // ---- GetStatuses ----

    [Fact]
    public async Task GetStatuses_EmptyInput_ReturnsEmpty() =>
        Assert.Empty(await _sut.GetStatusesAsync([]));

    [Fact]
    public async Task GetStatuses_ReturnsUsagePerUser()
    {
        SetUser(limit: 10);
        AddChats(2);
        AddChats(5, userId: OtherUserId);
        var users = Db.Users.ToList();
        var result = await _sut.GetStatusesAsync(users);
        Assert.Equal(2, result[UserId].Used);
        Assert.Equal(10, result[UserId].DailyLimit);
        Assert.Equal(5, result[OtherUserId].Used);
        Assert.Equal(20, result[OtherUserId].DailyLimit);
    }

    // ---- EnsureAvailable ----

    [Fact]
    public async Task EnsureAvailable_WithMessagesLeft_DoesNotThrow()
    {
        SetUser(limit: 10);
        AddChats(9);
        await _sut.EnsureAvailableAsync(UserId);
    }

    [Fact]
    public async Task EnsureAvailable_AtLimit_ThrowsTooManyRequests()
    {
        SetUser(limit: 10);
        AddChats(10);
        await Assert.ThrowsAsync<TooManyRequestsException>(() => _sut.EnsureAvailableAsync(UserId));
    }

    [Fact]
    public async Task EnsureAvailable_OverLimit_ThrowsTooManyRequests()
    {
        SetUser(limit: 10);
        AddChats(12);
        await Assert.ThrowsAsync<TooManyRequestsException>(() => _sut.EnsureAvailableAsync(UserId));
    }

    [Fact]
    public async Task EnsureAvailable_Unlimited_NeverThrows()
    {
        SetUser(limit: AIQuota.Unlimited);
        AddChats(500);
        await _sut.EnsureAvailableAsync(UserId);
    }

    [Fact]
    public async Task EnsureAvailable_FailedMessagesDoNotUseTheQuota()
    {
        SetUser(limit: 10);
        AddChats(30, AIProcessingStatus.Failed);
        await _sut.EnsureAvailableAsync(UserId);
    }

    // ---- SetUserLimit ----

    [Theory]
    [InlineData(10)]
    [InlineData(20)]
    [InlineData(50)]
    [InlineData(-1)]
    public async Task SetUserLimit_AcceptsAllowedValues(int limit)
    {
        var status = await _sut.SetUserLimitAsync(UserId, limit);
        Assert.Equal(limit, status.CustomLimit);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(15)]
    [InlineData(100)]
    [InlineData(-5)]
    public async Task SetUserLimit_RejectsOtherValues(int limit)
    {
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.SetUserLimitAsync(UserId, limit));
        Assert.Empty(_audit.Entries);
    }

    [Fact]
    public async Task SetUserLimit_NullReturnsUserToDefault()
    {
        SetUser(limit: 50);
        var status = await _sut.SetUserLimitAsync(UserId, null);
        Assert.Null(status.CustomLimit);
        Assert.Equal(20, status.DailyLimit);
    }

    [Theory]
    [InlineData(10, "limit=10")]
    [InlineData(-1, "limit=unlimited")]
    [InlineData(null, "limit=default")]
    public async Task SetUserLimit_WritesAuditEntry(int? limit, string detail)
    {
        await _sut.SetUserLimitAsync(UserId, limit);
        var entry = Assert.Single(_audit.Entries);
        Assert.Equal("SetAIQuota", entry.Action);
        Assert.Equal(UserId, entry.TargetId);
        Assert.Equal(detail, entry.Detail);
    }

    [Fact]
    public async Task SetUserLimit_UnknownUser_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.SetUserLimitAsync(Guid.NewGuid(), 10));

    // ---- Default limit ----

    [Fact]
    public async Task GetDefaultLimit_WithoutSetting_IsFallback() =>
        Assert.Equal(AIQuota.FallbackDefault, await _sut.GetDefaultLimitAsync());

    [Theory]
    [InlineData("10", 10)]
    [InlineData("50", 50)]
    [InlineData("-1", -1)]
    [InlineData("7", 20)]
    [InlineData("abc", 20)]
    [InlineData("", 20)]
    public async Task GetDefaultLimit_ReadsSettingAndRejectsInvalidValues(string stored, int expected)
    {
        SetDefault(stored);
        Assert.Equal(expected, await _sut.GetDefaultLimitAsync());
    }

    [Fact]
    public async Task SetDefaultLimit_CreatesSettingWithAdminEmail()
    {
        await _sut.SetDefaultLimitAsync(50);
        var setting = Assert.Single(Db.SystemSettings);
        Assert.Equal("50", setting.Value);
        Assert.Equal("user@test.com", setting.UpdatedBy);
        Assert.Equal(50, await _sut.GetDefaultLimitAsync());
    }

    [Fact]
    public async Task SetDefaultLimit_UpdatesExistingSetting()
    {
        SetDefault("10");
        await _sut.SetDefaultLimitAsync(-1);
        Assert.Equal("-1", Assert.Single(Db.SystemSettings).Value);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(25)]
    [InlineData(-2)]
    public async Task SetDefaultLimit_InvalidValue_ThrowsBadRequest(int limit)
    {
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.SetDefaultLimitAsync(limit));
        Assert.Empty(Db.SystemSettings);
    }

    [Fact]
    public async Task SetDefaultLimit_WritesAuditEntry()
    {
        await _sut.SetDefaultLimitAsync(-1);
        var entry = Assert.Single(_audit.Entries);
        Assert.Equal("SetDefaultAIQuota", entry.Action);
        Assert.Equal("limit=unlimited", entry.Detail);
    }

    [Fact]
    public async Task SetDefaultLimit_UnknownAdmin_UsesIdAsUpdatedBy()
    {
        var adminId = Guid.NewGuid();
        _current.UserId = adminId;
        await _sut.SetDefaultLimitAsync(10);
        Assert.Equal(adminId.ToString(), Assert.Single(Db.SystemSettings).UpdatedBy);
    }

    [Fact]
    public async Task SetDefaultLimit_Anonymous_Throws()
    {
        _current.UserId = null;
        await Assert.ThrowsAsync<InvalidOperationException>(() => _sut.SetDefaultLimitAsync(10));
    }
}

public class AnnouncementServiceTests : DbTestBase
{
    private readonly FakeAudit _audit = new();
    private readonly FakeCurrentUser _current = new(UserId, true);
    private readonly AnnouncementService _sut;

    private static readonly DateTime Past = DateTime.UtcNow.AddDays(-2);
    private static readonly DateTime Future = DateTime.UtcNow.AddDays(2);

    public AnnouncementServiceTests() => _sut = new AnnouncementService(Db, _current, _audit);

    private static UpsertAnnouncementRequest Req(string title = "T", string content = "C", DateTime? start = null,
        DateTime? end = null, bool active = true) => new(title, content, start ?? Past, end, active);

    private SystemAnnouncement Add(string title, DateTime start, DateTime? end = null, bool active = true)
    {
        var a = new SystemAnnouncement
        {
            AdminId = UserId, Title = title, Content = "c", StartAt = start, EndAt = end, IsActive = active
        };
        Db.SystemAnnouncements.Add(a);
        Db.SaveChanges();
        return a;
    }

    [Fact]
    public async Task Create_TrimsTextAndRecordsAdmin()
    {
        var result = await _sut.CreateAsync(Req("  Title  ", "  Body  "));
        Assert.Equal("Title", result.Title);
        Assert.Equal("Body", result.Content);
        Assert.Equal(UserId, result.AdminId);
    }

    [Fact]
    public async Task Create_WritesAuditEntry()
    {
        var result = await _sut.CreateAsync(Req("Hello"));
        var entry = Assert.Single(_audit.Entries);
        Assert.Equal("CreateAnnouncement", entry.Action);
        Assert.Equal(result.Id, entry.TargetId);
        Assert.Equal("Hello", entry.Detail);
    }

    [Fact]
    public async Task Create_EndBeforeStart_ThrowsBadRequest()
    {
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.CreateAsync(Req(start: Future, end: Past)));
        Assert.Empty(Db.SystemAnnouncements);
    }

    [Fact]
    public async Task Create_EndEqualToStart_ThrowsBadRequest()
    {
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.CreateAsync(Req(start: Past, end: Past)));
    }

    [Fact]
    public async Task Create_WithoutEnd_IsAllowed()
    {
        var result = await _sut.CreateAsync(Req(end: null));
        Assert.Null(result.EndAt);
    }

    [Fact]
    public async Task Create_Anonymous_Throws()
    {
        _current.UserId = null;
        await Assert.ThrowsAsync<InvalidOperationException>(() => _sut.CreateAsync(Req()));
    }

    [Fact]
    public async Task Update_ChangesFieldsAndAudits()
    {
        var a = Add("Old", Past);
        var result = await _sut.UpdateAsync(a.Id, Req(" New ", active: false));
        Assert.Equal("New", result.Title);
        Assert.False(result.IsActive);
        Assert.Equal("UpdateAnnouncement", Assert.Single(_audit.Entries).Action);
    }

    [Fact]
    public async Task Update_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.UpdateAsync(Guid.NewGuid(), Req()));

    [Fact]
    public async Task Update_InvalidWindow_ThrowsBadRequest()
    {
        var a = Add("Old", Past);
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.UpdateAsync(a.Id, Req(start: Future, end: Past)));
    }

    [Fact]
    public async Task Delete_RemovesAndAudits()
    {
        var a = Add("Old", Past);
        await _sut.DeleteAsync(a.Id);
        Assert.Empty(Db.SystemAnnouncements);
        Assert.Equal("DeleteAnnouncement", Assert.Single(_audit.Entries).Action);
    }

    [Fact]
    public async Task Delete_Unknown_ThrowsNotFoundWithoutAudit()
    {
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.DeleteAsync(Guid.NewGuid()));
        Assert.Empty(_audit.Entries);
    }

    [Fact]
    public async Task GetActive_ReturnsOnlyRunningAnnouncements()
    {
        Add("running", Past);
        Add("running-with-end", Past, Future);
        Add("not-started", Future);
        Add("expired", Past.AddDays(-5), Past);
        Add("disabled", Past, active: false);
        var result = await _sut.GetActiveAsync();
        Assert.Equivalent(new[] { "running", "running-with-end" }, result.Select(a => a.Title));
    }

    [Fact]
    public async Task GetActive_OrdersNewestStartFirst()
    {
        Add("older", DateTime.UtcNow.AddDays(-10));
        Add("newer", DateTime.UtcNow.AddDays(-1));
        var result = await _sut.GetActiveAsync();
        Assert.Equal(["newer", "older"], result.Select(a => a.Title));
    }

    [Fact]
    public async Task GetActive_NoAnnouncements_IsEmpty() => Assert.Empty(await _sut.GetActiveAsync());

    [Fact]
    public async Task GetPaged_ReturnsAllIncludingInactiveNewestFirst()
    {
        Add("a", DateTime.UtcNow.AddDays(-3), active: false);
        Add("b", DateTime.UtcNow.AddDays(-1));
        var result = await _sut.GetPagedAsync(new PagingQuery());
        Assert.Equal(2, result.TotalCount);
        Assert.Equal(["b", "a"], result.Items.Select(a => a.Title));
    }

    [Fact]
    public async Task GetPaged_Pages()
    {
        for (var i = 0; i < 7; i++) Add("n" + i, DateTime.UtcNow.AddDays(-i));
        var result = await _sut.GetPagedAsync(new PagingQuery { Page = 2, PageSize = 3 });
        Assert.Equal(3, result.Items.Count);
        Assert.Equal(3, result.TotalPages);
    }
}

public class SystemSettingServiceTests : DbTestBase
{
    private readonly FakeAudit _audit = new();
    private readonly FakeCurrentUser _current = new(UserId, true);
    private readonly SystemSettingService _sut;

    public SystemSettingServiceTests() => _sut = new SystemSettingService(Db, _current, _audit);

    [Theory]
    [InlineData("a")]
    [InlineData("ai.default_daily_message_limit")]
    [InlineData("feature:flag-1")]
    [InlineData("UPPER_lower.123")]
    public async Task Upsert_AcceptsValidKeys(string key)
    {
        var result = await _sut.UpsertAsync(key, new UpsertSettingRequest("v", null));
        Assert.Equal(key, result.Key);
    }

    [Fact]
    public async Task Upsert_Accepts100CharacterKey()
    {
        var key = new string('k', 100);
        Assert.Equal(key, (await _sut.UpsertAsync(key, new UpsertSettingRequest("v", null))).Key);
    }

    [Theory]
    [InlineData("")]
    [InlineData("has space")]
    [InlineData("slash/key")]
    [InlineData("semi;colon")]
    [InlineData("tiền")]
    public async Task Upsert_RejectsInvalidKeys(string key)
    {
        await Assert.ThrowsAsync<BadRequestException>(() => _sut.UpsertAsync(key, new UpsertSettingRequest("v", null)));
        Assert.Empty(Db.SystemSettings);
    }

    [Fact]
    public async Task Upsert_Rejects101CharacterKey() =>
        await Assert.ThrowsAsync<BadRequestException>(() =>
            _sut.UpsertAsync(new string('k', 101), new UpsertSettingRequest("v", null)));

    [Fact]
    public async Task Upsert_CreatesSettingWithAdminEmail()
    {
        var result = await _sut.UpsertAsync("k", new UpsertSettingRequest("value", "desc"));
        Assert.Equal("value", result.Value);
        Assert.Equal("desc", result.Description);
        Assert.Equal("user@test.com", result.UpdatedBy);
    }

    [Fact]
    public async Task Upsert_UpdatesExistingSettingInsteadOfDuplicating()
    {
        await _sut.UpsertAsync("k", new UpsertSettingRequest("one", "d"));
        await _sut.UpsertAsync("k", new UpsertSettingRequest("two", null));
        Assert.Equal("two", Assert.Single(Db.SystemSettings).Value);
    }

    [Fact]
    public async Task Upsert_NullDescriptionKeepsExistingDescription()
    {
        await _sut.UpsertAsync("k", new UpsertSettingRequest("one", "keep me"));
        var result = await _sut.UpsertAsync("k", new UpsertSettingRequest("two", null));
        Assert.Equal("keep me", result.Description);
    }

    [Fact]
    public async Task Upsert_AuditsCreateThenUpdateWithoutLoggingTheValue()
    {
        await _sut.UpsertAsync("k", new UpsertSettingRequest("secret", null));
        await _sut.UpsertAsync("k", new UpsertSettingRequest("secret2", null));
        Assert.Equal(["CreateSetting", "UpdateSetting"], _audit.Entries.Select(e => e.Action));
        Assert.All(_audit.Entries, e =>
        {
            Assert.Equal("key=k", e.Detail);
            Assert.DoesNotContain("secret", e.Detail);
        });
    }

    [Fact]
    public async Task Get_ReturnsSetting()
    {
        await _sut.UpsertAsync("k", new UpsertSettingRequest("v", null));
        Assert.Equal("v", (await _sut.GetAsync("k")).Value);
    }

    [Fact]
    public async Task Get_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.GetAsync("missing"));

    [Fact]
    public async Task GetAll_OrdersByKey()
    {
        await _sut.UpsertAsync("b", new UpsertSettingRequest("1", null));
        await _sut.UpsertAsync("a", new UpsertSettingRequest("2", null));
        Assert.Equal(["a", "b"], (await _sut.GetAllAsync()).Select(s => s.Key));
    }

    [Fact]
    public async Task Delete_RemovesAndAudits()
    {
        await _sut.UpsertAsync("k", new UpsertSettingRequest("v", null));
        await _sut.DeleteAsync("k");
        Assert.Empty(Db.SystemSettings);
        Assert.Equal("DeleteSetting", _audit.Entries.Last().Action);
    }

    [Fact]
    public async Task Delete_Unknown_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.DeleteAsync("missing"));
}

public class EncryptionServiceTests
{
    private readonly FakeKeys _keys = new();
    private readonly EncryptionService _sut;
    private static readonly Guid User = Guid.NewGuid();

    public EncryptionServiceTests() => _sut = new EncryptionService(_keys);

    [Theory]
    [InlineData("hello")]
    [InlineData("")]
    [InlineData("Tiếng Việt có dấu: tiền, ngân sách")]
    [InlineData("emoji 💰 and\nnewlines\tand tabs")]
    public async Task RoundTrip_ReturnsOriginalText(string text)
    {
        var data = await _sut.EncryptAsync(User, text);
        Assert.Equal(text, await _sut.DecryptAsync(User, data.Cipher, data.Nonce, data.KeyVersion));
    }

    [Fact]
    public async Task RoundTrip_LargeText()
    {
        var text = new string('x', 100_000);
        var data = await _sut.EncryptAsync(User, text);
        Assert.Equal(text, await _sut.DecryptAsync(User, data.Cipher, data.Nonce, data.KeyVersion));
    }

    [Fact]
    public async Task Encrypt_NonceIs12Bytes() =>
        Assert.Equal(12, (await _sut.EncryptAsync(User, "x")).Nonce.Length);

    [Theory]
    [InlineData("")]
    [InlineData("a")]
    [InlineData("hello world")]
    public async Task Encrypt_CipherIsPlaintextLengthPlus16ByteTag(string text)
    {
        var data = await _sut.EncryptAsync(User, text);
        Assert.Equal(System.Text.Encoding.UTF8.GetByteCount(text) + 16, data.Cipher.Length);
    }

    [Fact]
    public async Task Encrypt_SameTextTwice_GivesDifferentNonceAndCipher()
    {
        var a = await _sut.EncryptAsync(User, "same");
        var b = await _sut.EncryptAsync(User, "same");
        Assert.NotEqual(a.Nonce, b.Nonce);
        Assert.NotEqual(a.Cipher, b.Cipher);
    }

    [Fact]
    public async Task Encrypt_CipherDoesNotContainPlaintext()
    {
        var data = await _sut.EncryptAsync(User, "plaintext-marker");
        Assert.DoesNotContain("plaintext-marker", System.Text.Encoding.UTF8.GetString(data.Cipher));
    }

    [Fact]
    public async Task Encrypt_ReportsActiveKeyVersion() =>
        Assert.Equal(1, (await _sut.EncryptAsync(User, "x")).KeyVersion);

    [Fact]
    public async Task Decrypt_TamperedCipher_Throws()
    {
        var data = await _sut.EncryptAsync(User, "secret");
        data.Cipher[^1] ^= 0xFF;
        await Assert.ThrowsAnyAsync<CryptographicException>(() =>
            _sut.DecryptAsync(User, data.Cipher, data.Nonce, data.KeyVersion));
    }

    [Fact]
    public async Task Decrypt_TamperedTag_Throws()
    {
        var data = await _sut.EncryptAsync(User, "secret");
        data.Cipher[0] ^= 0xFF;
        await Assert.ThrowsAnyAsync<CryptographicException>(() =>
            _sut.DecryptAsync(User, data.Cipher, data.Nonce, data.KeyVersion));
    }

    [Fact]
    public async Task Decrypt_WrongNonce_Throws()
    {
        var data = await _sut.EncryptAsync(User, "secret");
        var otherNonce = RandomNumberGenerator.GetBytes(12);
        await Assert.ThrowsAnyAsync<CryptographicException>(() =>
            _sut.DecryptAsync(User, data.Cipher, otherNonce, data.KeyVersion));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(11)]
    [InlineData(13)]
    public async Task Decrypt_NonceWithWrongLength_Throws(int length)
    {
        var data = await _sut.EncryptAsync(User, "secret");
        await Assert.ThrowsAsync<CryptographicException>(() =>
            _sut.DecryptAsync(User, data.Cipher, new byte[length], data.KeyVersion));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(15)]
    public async Task Decrypt_CipherShorterThanTag_Throws(int length)
    {
        await Assert.ThrowsAsync<CryptographicException>(() =>
            _sut.DecryptAsync(User, new byte[length], new byte[12], 1));
    }

    [Fact]
    public async Task Decrypt_WithAnotherUsersKey_Throws()
    {
        var data = await _sut.EncryptAsync(User, "secret");
        await Assert.ThrowsAnyAsync<CryptographicException>(() =>
            _sut.DecryptAsync(Guid.NewGuid(), data.Cipher, data.Nonce, data.KeyVersion));
    }

    [Fact]
    public async Task Decrypt_AfterKeyRotation_OldMessagesStillReadable()
    {
        var old = await _sut.EncryptAsync(User, "old message");
        await _keys.RotateKeyAsync(User);
        var fresh = await _sut.EncryptAsync(User, "new message");
        Assert.Equal(2, fresh.KeyVersion);
        Assert.Equal("old message", await _sut.DecryptAsync(User, old.Cipher, old.Nonce, old.KeyVersion));
        Assert.Equal("new message", await _sut.DecryptAsync(User, fresh.Cipher, fresh.Nonce, fresh.KeyVersion));
    }

    [Fact]
    public async Task Decrypt_WithWrongKeyVersion_Throws()
    {
        var data = await _sut.EncryptAsync(User, "secret");
        await Assert.ThrowsAnyAsync<CryptographicException>(() =>
            _sut.DecryptAsync(User, data.Cipher, data.Nonce, 2));
    }
}
