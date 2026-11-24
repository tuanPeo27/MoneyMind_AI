using System.Text.Json;
using backend.Data;
using backend.DTOs;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.Implementations;

public sealed class FinancialAnalysisService(AppDbContext db, FinancialContextCache contextCache) : IFinancialAnalysisService
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<FinancialSummary> GetSummaryAsync(Guid userId, DateTime start, DateTime end,
        CancellationToken cancellationToken = default) =>
        await GetSummaryAsync(userId, start, end, DateOnly.FromDateTime(DateTime.UtcNow), cancellationToken);

    private async Task<FinancialSummary> GetSummaryAsync(Guid userId, DateTime start, DateTime end, DateOnly today,
        CancellationToken cancellationToken)
    {
        var categoryRows = await (from t in db.Transactions.AsNoTracking()
                                  join c in db.Categories on t.CategoryId equals c.Id
                                  where t.UserId == userId && t.TransactionDate >= start && t.TransactionDate < end
                                  group t by new { t.Type, t.CategoryId, c.Name } into g
                                  select new { g.Key.Type, g.Key.CategoryId, g.Key.Name, Total = g.Sum(x => x.Amount) })
            .ToListAsync(cancellationToken);

        var income = categoryRows.Where(x => x.Type == TransactionType.Income).Sum(x => x.Total);
        var expense = categoryRows.Where(x => x.Type == TransactionType.Expense).Sum(x => x.Total);

        // One query for every active budget; the amount spent is a subquery per row instead of a round trip per budget.
        // Transaction dates are stored at midnight UTC of their day, so a budget covers [StartDate, EndDate + 1 day).
        var budgetRows = await (from b in db.Budgets.AsNoTracking()
                                join c in db.Categories on b.CategoryId equals c.Id
                                where b.UserId == userId && b.StartDate <= today && b.EndDate >= today
                                select new
                                {
                                    c.Name,
                                    b.Amount,
                                    Spent = db.Transactions
                                        .Where(t => t.UserId == userId && t.CategoryId == b.CategoryId
                                            && t.Type == TransactionType.Expense
                                            && DateOnly.FromDateTime(t.TransactionDate) >= b.StartDate
                                            && DateOnly.FromDateTime(t.TransactionDate) <= b.EndDate)
                                        .Sum(t => (decimal?)t.Amount) ?? 0m
                                })
            .ToListAsync(cancellationToken);

        var budgets = budgetRows
            .Select(r => new BudgetStatus(r.Name, r.Amount, r.Spent,
                r.Amount > 0 ? Math.Round(r.Spent / r.Amount * 100m, 2) : 0m))
            .ToList();

        var goals = await db.FinancialGoals.AsNoTracking()
            .Where(g => g.UserId == userId && g.Status == FinancialGoalStatus.Active)
            .OrderBy(g => g.Deadline)
            .Take(10)
            .Select(g => new GoalStatus(g.Name, g.TargetAmount, g.CurrentAmount, g.Deadline))
            .ToListAsync(cancellationToken);

        return new FinancialSummary(start, end, income, expense,
            categoryRows.Where(x => x.Type == TransactionType.Expense)
                .OrderByDescending(x => x.Total).Take(10)
                .Select(x => new CategoryTotal(x.CategoryId, x.Name, x.Total)).ToList(),
            budgets, goals);
    }

    public async Task<string> BuildContextAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        // Take the key before reading: if the data changes while this runs, the result is stored under a stale key.
        var key = contextCache.KeyFor(userId);
        if (contextCache.TryGet(key, out var cached)) return cached;

        var timeZoneId = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.TimeZoneId)
            .FirstOrDefaultAsync(cancellationToken) ?? "UTC";
        var today = LocalToday(timeZoneId);
        var from = new DateTime(today.Year, today.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var summary = await GetSummaryAsync(userId, from, from.AddMonths(1), today, cancellationToken);

        var balances = await (from a in db.Accounts.AsNoTracking()
                              where a.UserId == userId && !a.IsArchived
                              let net = db.Transactions.Where(t => t.UserId == userId && t.AccountId == a.Id)
                                  .Sum(t => (decimal?)(t.Type == TransactionType.Income ? t.Amount : -t.Amount)) ?? 0m
                              let saved = db.GoalContributions.Where(c => c.AccountId == a.Id).Sum(c => (decimal?)c.Amount) ?? 0m
                              select new { a.Name, a.AccountType, Balance = a.InitialBalance + net - saved, a.Currency })
            .ToListAsync(cancellationToken);

        // Names the AI must use when it proposes an action (the backend matches them to the user's own records).
        var categories = await db.Categories.AsNoTracking()
            .Where(c => c.IsActive && (c.IsSystem || c.UserId == userId))
            .OrderBy(c => c.Type).ThenBy(c => c.Name)
            .Select(c => new { c.Name, c.Type })
            .ToListAsync(cancellationToken);

        // No transaction descriptions or personal identifiers are sent to the AI provider.
        var context = JsonSerializer.Serialize(new
        {
            today = today.ToString("yyyy-MM-dd"),
            timeZone = timeZoneId,
            currency = "VND",
            period = new { summary.From, summary.To },
            accounts = balances,
            categories,
            summary.TotalIncome,
            summary.TotalExpense,
            netSavings = summary.TotalIncome - summary.TotalExpense,
            summary.TopExpenseCategories,
            summary.Budgets,
            summary.Goals
        }, Json);

        contextCache.Set(key, context);
        return context;
    }

    public async Task<IReadOnlyList<InsightCandidate>> DetectInsightsAsync(Guid userId,
        CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        var from = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var summary = await GetSummaryAsync(userId, from, from.AddMonths(1), cancellationToken);
        var insights = new List<InsightCandidate>();

        foreach (var budget in summary.Budgets.Where(b => b.UsedPercent >= 80))
        {
            insights.Add(new InsightCandidate("BudgetThreshold", $"Ngân sách {budget.CategoryName}",
                $"Bạn đã dùng {budget.UsedPercent:N0}% ngân sách {budget.CategoryName}.",
                budget.UsedPercent > 100 ? AIInsightSeverity.Critical : AIInsightSeverity.Warning,
                JsonSerializer.Serialize(budget, Json)));
        }

        if (summary.TotalExpense > summary.TotalIncome && summary.TotalIncome > 0)
            insights.Add(new InsightCandidate("NegativeCashFlow", "Chi tiêu vượt thu nhập",
                "Tổng chi trong tháng đang cao hơn tổng thu.", AIInsightSeverity.Warning, null));

        return insights;
    }

    public static DateOnly LocalToday(string timeZoneId)
    {
        TimeZoneInfo zone;
        try { zone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId); }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException) { zone = TimeZoneInfo.Utc; }
        return DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone));
    }
}
