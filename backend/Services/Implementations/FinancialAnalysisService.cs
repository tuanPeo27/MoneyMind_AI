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

        var (expenseCategories, incomeCategories) = await LoadCategoryNamesAsync(userId, cancellationToken);

        // Every token here is paid on every chat message, so the context is kept compact: whole VND amounts, no ids,
        // no repeated type fields, no nulls. No transaction descriptions or personal identifiers are sent.
        var context = JsonSerializer.Serialize(new
        {
            today = today.ToString("yyyy-MM-dd"),
            month = today.ToString("yyyy-MM"),
            accounts = balances.Select(a => new { a.Name, type = a.AccountType.ToString(), balance = Vnd(a.Balance) }),
            expenseCategories,
            incomeCategories,
            totalIncome = Vnd(summary.TotalIncome),
            totalExpense = Vnd(summary.TotalExpense),
            netSavings = Vnd(summary.TotalIncome - summary.TotalExpense),
            topExpenseCategories = summary.TopExpenseCategories.Select(c => new { name = c.CategoryName, amount = Vnd(c.Amount) }),
            budgets = summary.Budgets.Select(b => new
            {
                category = b.CategoryName, amount = Vnd(b.Amount), spent = Vnd(b.Spent), usedPercent = (int)Math.Round(b.UsedPercent)
            }),
            goals = summary.Goals.Select(g => new { g.Name, target = Vnd(g.TargetAmount), current = Vnd(g.CurrentAmount), g.Deadline })
        }, CompactJson);

        contextCache.Set(key, context);
        return context;
    }

    public async Task<string> BuildCaptureContextAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var key = contextCache.KeyFor(userId) + ":capture";
        if (contextCache.TryGet(key, out var cached)) return cached;

        var timeZoneId = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.TimeZoneId)
            .FirstOrDefaultAsync(cancellationToken) ?? "UTC";
        var accounts = await db.Accounts.AsNoTracking().Where(a => a.UserId == userId && !a.IsArchived)
            .OrderBy(a => a.CreatedAt).Select(a => a.Name).ToListAsync(cancellationToken);
        var (expenseCategories, incomeCategories) = await LoadCategoryNamesAsync(userId, cancellationToken);

        // Quick entry only needs the names it may use and today's date; balances and budgets would be wasted tokens.
        var context = JsonSerializer.Serialize(new
        {
            today = LocalToday(timeZoneId).ToString("yyyy-MM-dd"), accounts, expenseCategories, incomeCategories
        }, CompactJson);
        contextCache.Set(key, context);
        return context;
    }

    private static readonly JsonSerializerOptions CompactJson = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
        // Vietnamese letters stay as they are ("Ăn uống", not "\u0102n u\u1ED1ng": about 3x fewer tokens), while < > & ' "
        // are still escaped, so a category name cannot close the <financial_context> block of the prompt.
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.Create(System.Text.Unicode.UnicodeRanges.All)
    };

    private static long Vnd(decimal amount) => (long)Math.Round(amount, MidpointRounding.AwayFromZero);

    /// <summary>Names the AI must use when it proposes an action (the backend matches them to the user's records).</summary>
    private async Task<(List<string> Expense, List<string> Income)> LoadCategoryNamesAsync(Guid userId,
        CancellationToken cancellationToken)
    {
        var rows = await db.Categories.AsNoTracking()
            .Where(c => c.IsActive && (c.IsSystem || c.UserId == userId))
            .OrderBy(c => c.Name)
            .Select(c => new { c.Name, c.Type })
            .ToListAsync(cancellationToken);
        return (rows.Where(c => c.Type == CategoryType.Expense).Select(c => c.Name).Distinct().ToList(),
            rows.Where(c => c.Type == CategoryType.Income).Select(c => c.Name).Distinct().ToList());
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
