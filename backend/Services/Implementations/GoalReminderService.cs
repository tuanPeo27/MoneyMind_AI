using backend.Data;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.Implementations;

/// <summary>
/// Sends the monthly "time to contribute" notification for savings goals that have a reminder day.
/// Runs at start-up and then every 30 minutes; each goal gets at most one reminder per local day
/// (<see cref="FinancialGoal.LastReminderOn"/>), evaluated in the owner's time zone. A reminder day past the end
/// of a short month (e.g. 31 in April) fires on that month's last day.
/// </summary>
public sealed class GoalReminderService(IServiceScopeFactory scopes, ILogger<GoalReminderService> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(30);
    // Notification texts are Vietnamese, so amounts use Vietnamese grouping (5.000.000).
    private static readonly System.Globalization.CultureInfo VietnameseCulture = new("vi-VN");

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval);
        do
        {
            try { await SendDueRemindersAsync(DateTime.UtcNow, stoppingToken); }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Savings goal reminders failed; retrying at the next run.");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    internal async Task SendDueRemindersAsync(DateTime nowUtc, CancellationToken cancellationToken)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var notifications = scope.ServiceProvider.GetRequiredService<INotificationService>();

        var candidates = await (from g in db.FinancialGoals
                                join u in db.Users on g.UserId equals u.Id
                                where g.Status == FinancialGoalStatus.Active && g.ReminderDay != null && u.IsActive
                                select new { Goal = g, u.TimeZoneId })
            .ToListAsync(cancellationToken);

        var sent = 0;
        foreach (var row in candidates)
        {
            var today = LocalToday(row.TimeZoneId, nowUtc);
            var dueDay = Math.Min(row.Goal.ReminderDay!.Value, DateTime.DaysInMonth(today.Year, today.Month));
            if (today.Day != dueDay || row.Goal.LastReminderOn == today) continue;

            var goal = row.Goal;
            var remaining = Math.Max(0m, goal.TargetAmount - goal.CurrentAmount);
            await notifications.CreateAsync(goal.UserId, NotificationType.Info, NotificationSource.Goal,
                "Đến hẹn góp quỹ",
                $"Hôm nay là ngày góp quỹ \"{goal.Name}\". Còn thiếu {remaining.ToString("N0", VietnameseCulture)} ₫ để đạt mục tiêu.",
                "FinancialGoal", goal.Id, cancellationToken);
            goal.LastReminderOn = today;
            await db.SaveChangesAsync(cancellationToken);
            sent++;
        }
        if (sent > 0) logger.LogInformation("Sent {Count} savings goal reminders.", sent);
    }

    private static DateOnly LocalToday(string timeZoneId, DateTime nowUtc)
    {
        TimeZoneInfo zone;
        try { zone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId); }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException) { zone = TimeZoneInfo.Utc; }
        return DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(nowUtc, zone));
    }
}
