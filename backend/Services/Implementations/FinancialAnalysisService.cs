using System.Text.Json;
using backend.Data;
using backend.DTOs;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.Implementations;

public sealed class FinancialAnalysisService(AppDbContext db) : IFinancialAnalysisService
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<FinancialSummary> GetSummaryAsync(Guid userId, DateTime start, DateTime end,
        CancellationToken cancellationToken = default)
    {
        var categoryRows = await (from t in db.Transactions.AsNoTracking()
                                  join c in db.Categories on t.CategoryId equals c.Id
                                  where t.UserId == userId && t.TransactionDate >= start && t.TransactionDate < end
                                  group t by new { t.Type, t.CategoryId, c.Name } into g
                                  select new { g.Key.Type, g.Key.CategoryId, g.Key.Name, Total = g.Sum(x => x.Amount) })
            .ToListAsync(cancellationToken);

        var income = categoryRows.Where(x => x.Type == TransactionType.Income).Sum(x => x.Total);
        var expense = categoryRows.Where(x => x.Type == TransactionType.Expense).Sum(x => x.Total);

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var budgetRows = await (from b in db.Budgets.AsNoTracking()
                                join c in db.Categories on b.CategoryId equals c.Id
                                where b.UserId == userId && b.StartDate <= today && b.EndDate >= today
                                select new { Budget = b, CategoryName = c.Name })
            .ToListAsync(cancellationToken);

        var budgets = new List<BudgetStatus>(budgetRows.Count);
        foreach (var row in budgetRows)
        {
            var budgetFrom = row.Budget.StartDate.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
            var budgetTo = row.Budget.EndDate.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
            var spent = await db.Transactions.AsNoTracking()
                .Where(t => t.UserId == userId && t.CategoryId == row.Budget.CategoryId
                    && t.Type == TransactionType.Expense && t.TransactionDate >= budgetFrom
                    && t.TransactionDate < budgetTo)
                .SumAsync(t => (decimal?)t.Amount, cancellationToken) ?? 0m;
            budgets.Add(new BudgetStatus(row.CategoryName, row.Budget.Amount, spent,
                row.Budget.Amount > 0 ? Math.Round(spent / row.Budget.Amount * 100m, 2) : 0m));
        }

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
        var now = DateTime.UtcNow;
        var from = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var summary = await GetSummaryAsync(userId, from, from.AddMonths(1), cancellationToken);
        var balances = await (from a in db.Accounts.AsNoTracking()
                              where a.UserId == userId && !a.IsArchived
                              let net = db.Transactions.Where(t => t.UserId == userId && t.AccountId == a.Id)
                                  .Sum(t => (decimal?)(t.Type == TransactionType.Income ? t.Amount : -t.Amount)) ?? 0m
                              select new { a.Name, a.AccountType, Balance = a.InitialBalance + net, a.Currency })
            .ToListAsync(cancellationToken);

        // No transaction descriptions or personal identifiers are sent to the AI provider.
        return JsonSerializer.Serialize(new
        {
            generatedAtUtc = now,
            period = new { summary.From, summary.To },
            accounts = balances,
            summary.TotalIncome,
            summary.TotalExpense,
            netSavings = summary.TotalIncome - summary.TotalExpense,
            summary.TopExpenseCategories,
            summary.Budgets,
            summary.Goals
        }, Json);
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
}
