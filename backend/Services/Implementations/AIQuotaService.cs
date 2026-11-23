using backend.Data;
using backend.Helpers;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.Implementations;

public sealed class AIQuotaService(
    AppDbContext db,
    ICurrentUserService currentUser,
    IAuditService audit) : IAIQuotaService
{
    public async Task<AIQuotaStatus> GetStatusAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var user = await db.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => new { u.TimeZoneId, u.AIDailyMessageLimit })
            .FirstOrDefaultAsync(cancellationToken)
            ?? throw new NotFoundException("Không tìm thấy người dùng.");

        var (start, end) = DayWindow(user.TimeZoneId, DateTime.UtcNow);
        var used = await db.AIProcessingLogs.CountAsync(
            l => l.UserId == userId && l.TaskType == AITasks.Chat && l.Status == AIProcessingStatus.Completed
                && l.CreatedAt >= start, cancellationToken);
        return Build(user.AIDailyMessageLimit, await GetDefaultLimitAsync(cancellationToken), used, end);
    }

    public async Task<IReadOnlyDictionary<Guid, AIQuotaStatus>> GetStatusesAsync(
        IReadOnlyCollection<ApplicationUser> users, CancellationToken cancellationToken = default)
    {
        if (users.Count == 0) return new Dictionary<Guid, AIQuotaStatus>();

        var now = DateTime.UtcNow;
        var windows = users.ToDictionary(u => u.Id, u => DayWindow(u.TimeZoneId, now));
        var earliest = windows.Values.Min(w => w.Start);
        var ids = users.Select(u => u.Id).ToList();

        var logs = await db.AIProcessingLogs.AsNoTracking()
            .Where(l => l.UserId != null && ids.Contains(l.UserId.Value) && l.TaskType == AITasks.Chat
                && l.Status == AIProcessingStatus.Completed && l.CreatedAt >= earliest)
            .Select(l => new { UserId = l.UserId!.Value, l.CreatedAt })
            .ToListAsync(cancellationToken);
        var byUser = logs.ToLookup(l => l.UserId, l => l.CreatedAt);

        var defaultLimit = await GetDefaultLimitAsync(cancellationToken);
        return users.ToDictionary(
            u => u.Id,
            u => Build(u.AIDailyMessageLimit, defaultLimit,
                byUser[u.Id].Count(at => at >= windows[u.Id].Start), windows[u.Id].End));
    }

    public async Task EnsureAvailableAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var status = await GetStatusAsync(userId, cancellationToken);
        if (status.Remaining != 0) return;

        throw new TooManyRequestsException(
            $"Bạn đã dùng hết {status.DailyLimit} tin nhắn AI hôm nay. Lượt mới được cấp lại sau 00:00 theo múi giờ của bạn. " +
            "Liên hệ quản trị viên nếu cần thêm lượt.");
    }

    public async Task<AIQuotaStatus> SetUserLimitAsync(Guid userId, int? limit,
        CancellationToken cancellationToken = default)
    {
        if (limit is { } value && !AIQuota.IsAllowed(value)) throw new BadRequestException(AIQuota.InvalidLimitMessage);

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken)
            ?? throw new NotFoundException("Không tìm thấy người dùng.");
        user.AIDailyMessageLimit = limit;
        user.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        await audit.LogAsync("SetAIQuota", "User", userId, $"limit={Describe(limit)}", cancellationToken);
        return await GetStatusAsync(userId, cancellationToken);
    }

    public async Task<int> GetDefaultLimitAsync(CancellationToken cancellationToken = default)
    {
        var value = await db.SystemSettings.AsNoTracking()
            .Where(s => s.Key == AIQuota.DefaultSettingKey)
            .Select(s => s.Value)
            .FirstOrDefaultAsync(cancellationToken);
        return int.TryParse(value, out var limit) && AIQuota.IsAllowed(limit) ? limit : AIQuota.FallbackDefault;
    }

    public async Task SetDefaultLimitAsync(int limit, CancellationToken cancellationToken = default)
    {
        if (!AIQuota.IsAllowed(limit)) throw new BadRequestException(AIQuota.InvalidLimitMessage);

        var adminId = currentUser.RequiredUserId;
        var adminEmail = await db.Users.Where(u => u.Id == adminId).Select(u => u.Email)
            .FirstOrDefaultAsync(cancellationToken);

        var setting = await db.SystemSettings.FirstOrDefaultAsync(s => s.Key == AIQuota.DefaultSettingKey, cancellationToken);
        if (setting is null)
        {
            setting = new SystemSetting { Key = AIQuota.DefaultSettingKey };
            db.SystemSettings.Add(setting);
        }
        setting.Value = limit.ToString();
        setting.Description = "AI chat messages per user per day when an admin has not set a limit for that user. -1 means unlimited.";
        setting.UpdatedBy = adminEmail ?? adminId.ToString();
        setting.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        await audit.LogAsync("SetDefaultAIQuota", "SystemSetting", null, $"limit={Describe(limit)}", cancellationToken);
    }

    private static AIQuotaStatus Build(int? custom, int defaultLimit, int used, DateTime resetsAt)
    {
        var effective = custom ?? defaultLimit;
        return new AIQuotaStatus(custom, effective == AIQuota.Unlimited ? null : effective, used, resetsAt);
    }

    private static string Describe(int? limit) => limit switch
    {
        null => "default",
        AIQuota.Unlimited => "unlimited",
        var value => value.ToString()
    };

    /// <summary>The UTC range of the user's current local day. Midnight offsets follow the zone's daylight-saving rules.</summary>
    private static (DateTime Start, DateTime End) DayWindow(string timeZoneId, DateTime nowUtc)
    {
        TimeZoneInfo zone;
        try { zone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId); }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException) { zone = TimeZoneInfo.Utc; }

        var localStart = DateTime.SpecifyKind(TimeZoneInfo.ConvertTimeFromUtc(nowUtc, zone).Date, DateTimeKind.Unspecified);
        var localEnd = localStart.AddDays(1);
        return (DateTime.SpecifyKind(localStart - zone.GetUtcOffset(localStart), DateTimeKind.Utc),
            DateTime.SpecifyKind(localEnd - zone.GetUtcOffset(localEnd), DateTimeKind.Utc));
    }
}
