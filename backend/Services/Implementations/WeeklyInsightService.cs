using backend.Data;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.Implementations;

/// <summary>
/// Sends the weekly summary on Monday from 07:00 in each user's time zone. Runs every 30 minutes; a user gets at
/// most one summary (and one AI call) per week, and only when they recorded transactions last week. Users who turned
/// proactive AI off in their AI settings are skipped.
/// </summary>
public sealed class WeeklyInsightService(IServiceScopeFactory scopes, ILogger<WeeklyInsightService> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(30);
    private const int SendFromHour = 7;
    private const int MaxUsersPerRun = 100;
    // Spreads the AI calls out, so a batch of users stays under the free tier's requests-per-minute limit.
    private static readonly TimeSpan PauseBetweenUsers = TimeSpan.FromSeconds(5);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval);
        do
        {
            try { await RunAsync(DateTime.UtcNow, stoppingToken); }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Weekly summaries failed; retrying at the next run.");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task RunAsync(DateTime nowUtc, CancellationToken cancellationToken)
    {
        List<Guid> due;
        using (var scope = scopes.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var recent = nowUtc.AddDays(-9);
            var retryBefore = nowUtc.AddHours(-2);
            var retryAfter = nowUtc.AddDays(-1);
            // Cheap filter in SQL: active users with recent transactions who did not switch proactive AI off.
            var candidates = await db.Users.AsNoTracking()
                .Where(u => u.IsActive
                    && db.Transactions.Any(t => t.UserId == u.Id && t.TransactionDate >= recent)
                    && !db.UserAISettings.Any(s => s.UserId == u.Id && (!s.ProactiveEnabled || s.ReportFrequency == "Off")))
                .Select(u => new
                {
                    u.Id, u.TimeZoneId,
                    Last = db.AIInsights.Where(i => i.UserId == u.Id && i.InsightType == InsightService.WeeklySummaryType)
                        .Max(i => (DateTime?)i.CreatedAt),
                    // Numbers-only summary (Gemini was busy) at least 2 hours old: worth another AI try.
                    // InsightService stops after 3 AI calls per week.
                    Retry = db.AIInsights.Any(i => i.UserId == u.Id && i.InsightType == InsightService.WeeklySummaryType
                        && i.CreatedAt >= retryAfter && i.CreatedAt < retryBefore
                        && i.DataJson != null && i.DataJson.Contains("\"writtenByAI\":false")
                        && db.AIProcessingLogs.Count(l => l.UserId == u.Id && l.TaskType == Helpers.AITasks.WeeklyInsight
                            && l.CreatedAt >= i.CreatedAt) < 2)
                })
                .ToListAsync(cancellationToken);
            due = candidates.Where(c => c.Retry || IsDue(c.TimeZoneId, c.Last, nowUtc)).Select(c => c.Id)
                .Take(MaxUsersPerRun).ToList();
        }

        var sent = 0;
        foreach (var userId in due)
        {
            using var scope = scopes.CreateScope();
            var insights = scope.ServiceProvider.GetRequiredService<IInsightService>();
            try
            {
                // null: no transactions last week, so no AI call was made and no pause is needed.
                if (await insights.GenerateWeeklyAsync(userId, notify: true, cancellationToken) is null) continue;
                sent++;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // A request of the user is running (Conflict) or the data is odd: try again at the next run.
                logger.LogWarning(ex, "Weekly summary for {UserId} skipped this run.", userId);
            }
            await Task.Delay(PauseBetweenUsers, cancellationToken);
        }
        if (sent > 0) logger.LogInformation("Sent {Count} weekly summaries.", sent);
    }

    /// <summary>
    /// Due from Monday 07:00 local time until a summary exists for this week. Later in the week also counts, so a
    /// server that was down on Monday still sends it.
    /// </summary>
    private static bool IsDue(string timeZoneId, DateTime? lastSummaryUtc, DateTime nowUtc)
    {
        TimeZoneInfo zone;
        try { zone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId); }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException) { zone = TimeZoneInfo.Utc; }
        var local = TimeZoneInfo.ConvertTimeFromUtc(nowUtc, zone);
        if (local.DayOfWeek == DayOfWeek.Monday && local.Hour < SendFromHour) return false;
        if (lastSummaryUtc is null) return true;
        var monday = local.Date.AddDays(-(((int)local.DayOfWeek + 6) % 7));
        return TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(lastSummaryUtc.Value, DateTimeKind.Utc), zone) < monday;
    }
}
