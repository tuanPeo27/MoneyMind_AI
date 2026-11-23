using backend.Data;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.Implementations;

public sealed class AdminTransactionService(AppDbContext db) : IAdminTransactionService
{
    /// <summary>A category row is only shown when at least this many different people used it in the range.</summary>
    public const int MinGroupSize = 3;
    private const int MaxRangeDays = 366;
    private const int DefaultRangeDays = 30;

    public async Task<AdminTransactionStatsResponse> GetStatsAsync(DateTime? from, DateTime? to,
        CancellationToken cancellationToken = default)
    {
        var toValue = to ?? DateTime.UtcNow.Date;
        var fromValue = from ?? DateRange.AsUtc(toValue).Date.AddDays(-(DefaultRangeDays - 1));
        var (start, end) = DateRange.Bounds(fromValue, toValue);
        if ((end - start).TotalDays > MaxRangeDays)
            throw new BadRequestException($"Khoảng thời gian tối đa là {MaxRangeDays} ngày.");

        var range = db.Transactions.AsNoTracking()
            .Where(t => t.TransactionDate >= start && t.TransactionDate < end);

        var count = await range.CountAsync(cancellationToken);
        var activeUsers = await range.Select(t => t.UserId).Distinct().CountAsync(cancellationToken);
        var income = await range.Where(t => t.Type == TransactionType.Income)
            .SumAsync(t => (decimal?)t.Amount, cancellationToken) ?? 0m;
        var expense = await range.Where(t => t.Type == TransactionType.Expense)
            .SumAsync(t => (decimal?)t.Amount, cancellationToken) ?? 0m;

        var dailyRows = await range
            .GroupBy(t => t.TransactionDate.Date)
            .Select(g => new
            {
                Day = g.Key,
                Count = g.Count(),
                Income = g.Sum(t => t.Type == TransactionType.Income ? t.Amount : 0m),
                Expense = g.Sum(t => t.Type == TransactionType.Expense ? t.Amount : 0m)
            })
            .ToListAsync(cancellationToken);
        // Every day of the range, including days without transactions, so charts have a continuous axis.
        var byDay = dailyRows.ToDictionary(r => DateOnly.FromDateTime(r.Day));
        var daily = new List<AdminDailyTransactionStat>();
        for (var day = DateOnly.FromDateTime(start); day < DateOnly.FromDateTime(end); day = day.AddDays(1))
            daily.Add(byDay.TryGetValue(day, out var r)
                ? new AdminDailyTransactionStat(day, r.Count, r.Income, r.Expense)
                : new AdminDailyTransactionStat(day, 0, 0m, 0m));

        var categoryRows = await (
                from t in range
                join c in db.Categories.AsNoTracking() on t.CategoryId equals c.Id
                group t by new { c.Id, c.Name, c.IsSystem, t.Type } into g
                select new
                {
                    g.Key.Name,
                    g.Key.IsSystem,
                    g.Key.Type,
                    Count = g.Count(),
                    Amount = g.Sum(x => x.Amount),
                    Users = g.Select(x => x.UserId).Distinct().Count()
                })
            .ToListAsync(cancellationToken);
        // User-created category names can identify a person, and a system category used by one or two people
        // reveals their totals, so both are merged into one anonymous bucket per type.
        var categories = categoryRows
            .GroupBy(r => new { Name = r.IsSystem && r.Users >= MinGroupSize ? r.Name : null, r.Type })
            .Select(g => new AdminCategoryTransactionStat(g.Key.Name, g.Key.Type, g.Sum(r => r.Count), g.Sum(r => r.Amount)))
            .OrderByDescending(s => s.Amount)
            .ToList();

        var sources = await range
            .GroupBy(t => t.Source)
            .Select(g => new AdminSourceTransactionStat(g.Key, g.Count()))
            .ToListAsync(cancellationToken);

        return new AdminTransactionStatsResponse(start, end.AddTicks(-1), count, activeUsers, income, expense,
            MinGroupSize, daily, categories, sources);
    }
}
