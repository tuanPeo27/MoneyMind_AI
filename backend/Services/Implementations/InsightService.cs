using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using backend.Data;
using backend.DTOs;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.Implementations;

public sealed class InsightService(
    AppDbContext db,
    IAIOrchestrationService orchestration,
    IAIChatService chat,
    INotificationService notifications,
    UserRequestGate gate,
    ILogger<InsightService> logger) : IInsightService
{
    public const string WeeklySummaryType = "WeeklySummary";
    private const int MaxAIAttemptsPerWeek = 3;
    private static readonly CultureInfo Vi = new("vi-VN");
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        // Vietnamese stays readable (fewer tokens in the facts); < > & are still escaped.
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.Create(System.Text.Unicode.UnicodeRanges.All)
    };

    /// <summary>What is stored in AIInsight.DataJson of a weekly summary.</summary>
    private sealed record WeeklyData(DateOnly WeekStart, DateOnly WeekEnd, IReadOnlyList<AIInsightItem> Items,
        IReadOnlyList<Guid> RecommendationIds, bool WrittenByAI);

    /// <summary>What is stored in AIRecommendation.DataJson: a chat function call, as the AI action service expects it.</summary>
    private sealed record StoredAction(string Name, JsonElement Args);

    // ---- read ----

    public async Task<WeeklySummaryResponse?> GetLatestWeeklyAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var insight = await db.AIInsights.AsNoTracking()
            .Where(i => i.UserId == userId && i.InsightType == WeeklySummaryType && !i.IsDismissed)
            .OrderByDescending(i => i.CreatedAt).FirstOrDefaultAsync(cancellationToken);
        return insight is null ? null : await MapAsync(insight, cancellationToken);
    }

    public async Task MarkReadAsync(Guid userId, Guid insightId, CancellationToken cancellationToken = default)
    {
        var updated = await db.AIInsights.Where(i => i.Id == insightId && i.UserId == userId)
            .ExecuteUpdateAsync(s => s.SetProperty(i => i.IsRead, true), cancellationToken);
        if (updated == 0) throw new NotFoundException("Không tìm thấy bản tổng kết.");
    }

    // ---- generate ----

    public async Task<WeeklySummaryResponse?> GenerateWeeklyAsync(Guid userId, bool notify,
        CancellationToken cancellationToken = default)
    {
        using var slot = gate.TryEnter(userId)
            ?? throw new ConflictException("Bạn đang có một yêu cầu AI đang xử lý. Vui lòng đợi hoàn tất.");

        var timeZoneId = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.TimeZoneId)
            .FirstOrDefaultAsync(cancellationToken) ?? "UTC";
        var zone = FindZone(timeZoneId);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone));
        var thisMonday = today.AddDays(-(((int)today.DayOfWeek + 6) % 7));
        var weekStart = thisMonday.AddDays(-7);
        var weekEnd = thisMonday.AddDays(-1);

        // One summary per week: anything created since this Monday (local) already covers last week.
        var since = LocalMidnightUtc(thisMonday, zone);
        var existing = await db.AIInsights
            .Where(i => i.UserId == userId && i.InsightType == WeeklySummaryType && i.CreatedAt >= since)
            .OrderByDescending(i => i.CreatedAt).FirstOrDefaultAsync(cancellationToken);
        if (existing is not null)
        {
            // A numbers-only summary (the AI was down) may try the AI again, up to MaxAIAttemptsPerWeek calls.
            var writtenByAI = existing.DataJson is { } stored && JsonSerializer.Deserialize<WeeklyData>(stored, Json)?.WrittenByAI == true;
            var attempts = await db.AIProcessingLogs.CountAsync(l => l.UserId == userId
                && l.TaskType == AITasks.WeeklyInsight && l.CreatedAt >= since, cancellationToken);
            if (writtenByAI || attempts >= MaxAIAttemptsPerWeek) return await MapAsync(existing, cancellationToken);
        }

        var facts = await BuildFactsAsync(userId, weekStart, today, cancellationToken);
        if (facts is null) return existing is null ? null : await MapAsync(existing, cancellationToken);

        var ai = await orchestration.GenerateInsightsAsync(userId, JsonSerializer.Serialize(facts.Json, Json), cancellationToken);
        if (existing is not null && ai is not { Summary.Length: > 0 }) return await MapAsync(existing, cancellationToken);
        var summary = ai is { Summary.Length: > 0 } ? Clip(ai.Summary, 1000) : FallbackSummary(facts);
        var items = ai is { Summary.Length: > 0 }
            ? ai.Items.Take(4).Select(i => new AIInsightItem(Clip(i.Title, 150), Clip(i.Content, 500), Severity(i.Severity))).ToList()
            : FallbackItems(facts);

        var recommendations = new List<AIRecommendation>();
        foreach (var r in ai?.Recommendations.Take(2) ?? [])
        {
            if (string.IsNullOrWhiteSpace(r.Title)) continue;
            var action = r.Action is null ? null : Validate(r.Action, facts);
            recommendations.Add(new AIRecommendation
            {
                UserId = userId,
                RecommendationType = action?.Name ?? "tip",
                Title = Clip(r.Title, 150),
                Description = Clip(r.Description, 500),
                DataJson = action is null ? null : JsonSerializer.Serialize(action, Json),
                ExpiresAt = DateTime.UtcNow.AddDays(14)
            });
        }

        var title = $"Tổng kết tuần {weekStart:dd/MM} – {weekEnd:dd/MM}";
        // A successful retry replaces the numbers-only summary in place, so there is still one per week.
        var insight = existing ?? new AIInsight { UserId = userId, InsightType = WeeklySummaryType, SchemaVersion = 1 };
        insight.Title = title;
        insight.Content = summary;
        insight.Severity = items.Count == 0 ? AIInsightSeverity.Info : items.Max(i => ParseSeverity(i.Severity));
        insight.IsRead = false;
        insight.DataJson = JsonSerializer.Serialize(new WeeklyData(weekStart, weekEnd, items,
            recommendations.Select(r => r.Id).ToList(), ai is { Summary.Length: > 0 }), Json);
        db.AIRecommendations.AddRange(recommendations);
        if (existing is null) db.AIInsights.Add(insight);
        await db.SaveChangesAsync(cancellationToken);

        if (notify && existing is null)
        {
            try
            {
                await notifications.CreateAsync(userId, NotificationType.Report, NotificationSource.AI, title,
                    Clip(summary, 300), "AIInsight", insight.Id, cancellationToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Could not send the weekly summary notification to {UserId}", userId);
            }
        }
        return await MapAsync(insight, cancellationToken);
    }

    // ---- recommendations ----

    public async Task<AcceptRecommendationResponse> AcceptRecommendationAsync(Guid userId, Guid id,
        CancellationToken cancellationToken = default)
    {
        var recommendation = await FindRecommendationAsync(userId, id, cancellationToken);
        if (recommendation.Status != AIRecommendationStatus.Pending) throw new ConflictException("Đề xuất này đã được xử lý.");

        AIActionResponse? action = null;
        if (recommendation.DataJson is { } data && JsonSerializer.Deserialize<StoredAction>(data, Json) is { } stored)
        {
            // Still a proposal: the user checks (and may edit) it on the card before anything is saved.
            var proposed = await chat.ProposeActionsAsync(userId, $"Đề xuất từ tổng kết tuần: {recommendation.Title}",
                [new AIProposedAction(stored.Name, stored.Args)], cancellationToken);
            action = proposed.FirstOrDefault();
        }
        recommendation.Status = AIRecommendationStatus.Accepted;
        await db.SaveChangesAsync(cancellationToken);
        return new AcceptRecommendationResponse(Map(recommendation), action);
    }

    public async Task<RecommendationResponse> DismissRecommendationAsync(Guid userId, Guid id,
        CancellationToken cancellationToken = default)
    {
        var recommendation = await FindRecommendationAsync(userId, id, cancellationToken);
        if (recommendation.Status == AIRecommendationStatus.Pending)
        {
            recommendation.Status = AIRecommendationStatus.Dismissed;
            await db.SaveChangesAsync(cancellationToken);
        }
        return Map(recommendation);
    }

    private async Task<AIRecommendation> FindRecommendationAsync(Guid userId, Guid id, CancellationToken cancellationToken) =>
        await db.AIRecommendations.FirstOrDefaultAsync(r => r.Id == id && r.UserId == userId, cancellationToken)
        ?? throw new NotFoundException("Không tìm thấy đề xuất.");

    // ---- facts (computed here, never by the AI) ----

    private sealed record Facts(object Json, DateOnly WeekStart, DateOnly WeekEnd, long Expense, long PreviousExpense,
        long Income, IReadOnlyList<(string Name, long Amount, long Previous)> Top,
        IReadOnlyList<(string Category, long Amount, long Spent, int UsedPercent, int DaysLeft)> Budgets,
        IReadOnlyList<string> ExpenseCategories, IReadOnlyList<(string Name, long Target, long Current)> Goals);

    private async Task<Facts?> BuildFactsAsync(Guid userId, DateOnly weekStart, DateOnly today,
        CancellationToken cancellationToken)
    {
        var weekEnd = weekStart.AddDays(6);
        var previousStart = weekStart.AddDays(-7);
        // Transactions keep their date at a fixed time of day in UTC, so whole-day UTC bounds select by date.
        var rangeStart = previousStart.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var split = weekStart.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var rangeEnd = weekEnd.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);

        var rows = await (from t in db.Transactions.AsNoTracking()
                          join c in db.Categories on t.CategoryId equals c.Id
                          where t.UserId == userId && t.TransactionDate >= rangeStart && t.TransactionDate < rangeEnd
                          group t by new { t.Type, c.Name, LastWeek = t.TransactionDate >= split } into g
                          select new { g.Key.Type, g.Key.Name, g.Key.LastWeek, Total = g.Sum(x => x.Amount), Count = g.Count() })
            .ToListAsync(cancellationToken);
        var count = rows.Where(r => r.LastWeek).Sum(r => r.Count);
        if (count == 0) return null;

        long Sum(TransactionType type, bool lastWeek) =>
            Vnd(rows.Where(r => r.Type == type && r.LastWeek == lastWeek).Sum(r => r.Total));
        var top = rows.Where(r => r.Type == TransactionType.Expense && r.LastWeek)
            .OrderByDescending(r => r.Total).Take(4)
            .Select(r => (r.Name, Vnd(r.Total),
                Vnd(rows.Where(p => p.Type == TransactionType.Expense && !p.LastWeek && p.Name == r.Name).Sum(p => p.Total))))
            .ToList();

        var budgetRows = await (from b in db.Budgets.AsNoTracking()
                                join c in db.Categories on b.CategoryId equals c.Id
                                where b.UserId == userId && b.StartDate <= today && b.EndDate >= today
                                select new
                                {
                                    c.Name, b.Amount, b.EndDate,
                                    Spent = db.Transactions
                                        .Where(t => t.UserId == userId && t.CategoryId == b.CategoryId
                                            && t.Type == TransactionType.Expense
                                            && DateOnly.FromDateTime(t.TransactionDate) >= b.StartDate
                                            && DateOnly.FromDateTime(t.TransactionDate) <= b.EndDate)
                                        .Sum(t => (decimal?)t.Amount) ?? 0m
                                })
            .ToListAsync(cancellationToken);
        var budgets = budgetRows
            .Select(b => (b.Name, Vnd(b.Amount), Vnd(b.Spent),
                b.Amount > 0 ? (int)Math.Round(b.Spent / b.Amount * 100) : 0, b.EndDate.DayNumber - today.DayNumber))
            .OrderByDescending(b => b.Item4).Take(5).ToList();

        var goals = (await db.FinancialGoals.AsNoTracking()
                .Where(g => g.UserId == userId && g.Status == FinancialGoalStatus.Active)
                .OrderBy(g => g.Deadline).Take(5)
                .Select(g => new { g.Name, g.TargetAmount, g.CurrentAmount, g.Deadline })
                .ToListAsync(cancellationToken));

        var expenseCategories = await db.Categories.AsNoTracking()
            .Where(c => c.IsActive && c.Type == CategoryType.Expense && (c.IsSystem || c.UserId == userId))
            .Select(c => c.Name).Distinct().ToListAsync(cancellationToken);

        var budgeted = budgets.Select(b => TextFold.Fold(b.Name)).ToHashSet();
        var json = new
        {
            week = $"{weekStart:yyyy-MM-dd}..{weekEnd:yyyy-MM-dd}",
            today = today.ToString("yyyy-MM-dd"),
            transactions = count,
            expense = Sum(TransactionType.Expense, true),
            previousWeekExpense = Sum(TransactionType.Expense, false),
            income = Sum(TransactionType.Income, true),
            topCategories = top.Select(t => new { name = t.Item1, amount = t.Item2, previousWeek = t.Item3 }),
            budgets = budgets.Select(b => new { category = b.Item1, amount = b.Item2, spent = b.Item3, usedPercent = b.Item4, daysLeft = b.Item5 }),
            // Candidates for create_budget: spent on last week but without a budget.
            categoriesWithoutBudget = top.Select(t => t.Item1).Where(n => !budgeted.Contains(TextFold.Fold(n))),
            goals = goals.Select(g => new
            {
                name = g.Name, target = Vnd(g.TargetAmount), current = Vnd(g.CurrentAmount),
                deadline = g.Deadline?.ToString("yyyy-MM-dd")
            })
        };
        return new Facts(json, weekStart, weekEnd, Sum(TransactionType.Expense, true), Sum(TransactionType.Expense, false),
            Sum(TransactionType.Income, true), top, budgets, expenseCategories,
            goals.Select(g => (g.Name, Vnd(g.TargetAmount), Vnd(g.CurrentAmount))).ToList());
    }

    /// <summary>
    /// Keeps an AI-proposed action only when it fits the user's data: a budget for an expense category without one,
    /// a contribution to an existing fund that does not exceed what is missing, or a new fund. Returns it in the
    /// argument format of the chat functions (snake_case), ready for the AI action service.
    /// </summary>
    private static StoredAction? Validate(AIInsightAction a, Facts facts)
    {
        var amount = a.Amount is > 0 and < 1_000_000_000_000m ? Math.Round(a.Amount.Value) : (decimal?)null;
        switch (a.Name)
        {
            case AIActionTypes.CreateBudget:
            {
                var category = facts.ExpenseCategories.FirstOrDefault(c => TextFold.Fold(c) == TextFold.Fold(a.Category));
                if (category is null || amount is null
                    || facts.Budgets.Any(b => TextFold.Fold(b.Category) == TextFold.Fold(category))) return null;
                return Stored(a.Name, new { category, amount });
            }
            case AIActionTypes.ContributeToGoal:
            {
                var goal = facts.Goals.FirstOrDefault(g => TextFold.Fold(g.Name) == TextFold.Fold(a.Goal));
                if (goal.Name is null || amount is null || amount > goal.Target - goal.Current) return null;
                return Stored(a.Name, new { goal = goal.Name, amount });
            }
            case AIActionTypes.CreateSavingsGoal:
            {
                var target = a.TargetAmount is > 0 and < 1_000_000_000_000m ? Math.Round(a.TargetAmount.Value) : (decimal?)null;
                if (string.IsNullOrWhiteSpace(a.FundName) || target is null) return null;
                var deadline = DateOnly.TryParseExact(a.Deadline, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                    DateTimeStyles.None, out var day) && day > facts.WeekEnd ? day.ToString("yyyy-MM-dd") : null;
                return Stored(a.Name, new { name = Clip(a.FundName, 150), target_amount = target, deadline });
            }
            default:
                return null;
        }
    }

    private static StoredAction Stored(string name, object args) =>
        new(name, JsonSerializer.SerializeToElement(args, Json));

    // ---- facts-only summary when the AI is unavailable ----

    private static string FallbackSummary(Facts f)
    {
        var change = f.PreviousExpense > 0
            ? $" ({(f.Expense >= f.PreviousExpense ? "+" : "")}{(f.Expense - f.PreviousExpense) * 100.0 / f.PreviousExpense:0}% so với tuần trước)"
            : "";
        return $"Tuần {f.WeekStart:dd/MM} – {f.WeekEnd:dd/MM} bạn chi {Money(f.Expense)}{change} và thu {Money(f.Income)}.";
    }

    private static List<AIInsightItem> FallbackItems(Facts f)
    {
        var items = new List<AIInsightItem>();
        if (f.Top.Count > 0)
            items.Add(new AIInsightItem($"Chi nhiều nhất: {f.Top[0].Name}",
                $"{Money(f.Top[0].Amount)} trong tuần (tuần trước {Money(f.Top[0].Previous)}).", "info"));
        foreach (var b in f.Budgets.Where(b => b.UsedPercent >= 80).Take(3))
            items.Add(new AIInsightItem($"Ngân sách {b.Category}",
                $"Đã dùng {b.UsedPercent}% ({Money(b.Spent)} / {Money(b.Amount)}), còn {b.DaysLeft} ngày.",
                b.UsedPercent >= 100 ? "critical" : "warning"));
        return items;
    }

    // ---- mapping and helpers ----

    private async Task<WeeklySummaryResponse> MapAsync(AIInsight insight, CancellationToken cancellationToken)
    {
        var data = insight.DataJson is null ? null : JsonSerializer.Deserialize<WeeklyData>(insight.DataJson, Json);
        var ids = data?.RecommendationIds ?? [];
        List<AIRecommendation> recommendations = ids.Count == 0 ? [] : await db.AIRecommendations.AsNoTracking()
            .Where(r => r.UserId == insight.UserId && ids.Contains(r.Id))
            .OrderBy(r => r.CreatedAt).ToListAsync(cancellationToken);
        return new WeeklySummaryResponse(insight.Id, data?.WeekStart ?? default, data?.WeekEnd ?? default, insight.Title,
            insight.Content, insight.Severity, data?.Items ?? [], recommendations.Select(Map).ToList(),
            data?.WrittenByAI ?? false, insight.IsRead, AsUtc(insight.CreatedAt));
    }

    private static RecommendationResponse Map(AIRecommendation r) =>
        new(r.Id, r.RecommendationType, r.Title, r.Description, r.DataJson, r.Status, AsUtc(r.CreatedAt),
            r.ExpiresAt is { } at ? AsUtc(at) : null);

    private static string Severity(string? value) => value is "warning" or "critical" ? value : "info";

    private static AIInsightSeverity ParseSeverity(string value) => value switch
    {
        "critical" => AIInsightSeverity.Critical,
        "warning" => AIInsightSeverity.Warning,
        _ => AIInsightSeverity.Info
    };

    private static long Vnd(decimal amount) => (long)Math.Round(amount, MidpointRounding.AwayFromZero);

    private static string Money(long amount) => $"{amount.ToString("N0", Vi)} ₫";

    private static string Clip(string? value, int max) =>
        string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim() is var text && text.Length > max ? text[..max] : value.Trim();

    private static DateTime AsUtc(DateTime value) =>
        value.Kind == DateTimeKind.Utc ? value : DateTime.SpecifyKind(value, DateTimeKind.Utc);

    private static TimeZoneInfo FindZone(string timeZoneId)
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById(timeZoneId); }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException) { return TimeZoneInfo.Utc; }
    }

    private static DateTime LocalMidnightUtc(DateOnly day, TimeZoneInfo zone)
    {
        var local = day.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified);
        // Midnight can fall in a daylight-saving gap; the first valid hour after it is used then.
        while (zone.IsInvalidTime(local)) local = local.AddHours(1);
        return TimeZoneInfo.ConvertTimeToUtc(local, zone);
    }
}
