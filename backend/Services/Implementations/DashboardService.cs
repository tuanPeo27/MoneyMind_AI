using System.Text.Json;
using backend.Data;
using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.Implementations;

public sealed class DashboardService(
    AppDbContext db,
    IAccountService accountService,
    ITransactionService transactionService,
    IBudgetService budgetService,
    IFinancialGoalService goalService,
    INotificationService notificationService) : IDashboardService
{
    private const int MaxRangeDays = 3660;
    private const int MaxDailyPoints = 366;
    private const int DailyTrendMaxDays = 93;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<DashboardOverviewResponse> GetOverviewAsync(Guid userId, DateTime? from = null,
        DateTime? to = null, CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        var start = from ?? new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var end = to ?? start.AddMonths(1).AddDays(-1);
        var (rangeStart, rangeEnd) = ValidateRange(start, end);

        var totals = await GetTotalsAsync(userId, rangeStart, rangeEnd, cancellationToken);

        // The same DbContext backs every service, so these calls run one after another.
        var accounts = await accountService.GetAllAsync(userId, includeArchived: false, cancellationToken);
        var recent = await transactionService.GetPagedAsync(userId, new TransactionQuery { Page = 1, PageSize = 5 },
            cancellationToken);
        var budgets = await budgetService.GetAllAsync(userId, DateOnly.FromDateTime(now), cancellationToken);
        var goals = await goalService.GetAllAsync(userId, FinancialGoalStatus.Active, cancellationToken);
        var unread = await notificationService.GetUnreadCountAsync(userId, cancellationToken);

        return new DashboardOverviewResponse(
            start, end,
            accounts.Sum(a => a.Balance),
            totals.Income, totals.Expense, totals.Income - totals.Expense,
            recent.Items, budgets, goals, unread);
    }

    public async Task<ReportResponse> GetReportAsync(Guid userId, DateTime from, DateTime to,
        CancellationToken cancellationToken = default)
    {
        var (start, end) = ValidateRange(from, to);

        var rows = await (from t in db.Transactions.AsNoTracking()
                          where t.UserId == userId && t.TransactionDate >= start && t.TransactionDate < end
                          join c in db.Categories on t.CategoryId equals c.Id
                          group t by new { t.CategoryId, c.Name, t.Type } into g
                          select new
                          {
                              g.Key.CategoryId,
                              CategoryName = g.Key.Name,
                              g.Key.Type,
                              Total = g.Sum(x => x.Amount),
                              Count = g.Count()
                          })
            .ToListAsync(cancellationToken);

        var income = rows.Where(r => r.Type == TransactionType.Income).Sum(r => r.Total);
        var expense = rows.Where(r => r.Type == TransactionType.Expense).Sum(r => r.Total);

        var days = (end - start).TotalDays;
        var trend = await BuildTrendAsync(userId, start, end, groupByMonth: days > DailyTrendMaxDays,
            cancellationToken);

        return new ReportResponse(
            from, to, income, expense, income - expense, rows.Sum(r => r.Count),
            Breakdown(rows.Where(r => r.Type == TransactionType.Expense)
                .Select(r => (r.CategoryId, r.CategoryName, r.Total)), expense),
            Breakdown(rows.Where(r => r.Type == TransactionType.Income)
                .Select(r => (r.CategoryId, r.CategoryName, r.Total)), income),
            trend);
    }

    public async Task<IReadOnlyList<TrendPoint>> GetTrendAsync(Guid userId, DateTime from, DateTime to,
        bool groupByMonth = false, CancellationToken cancellationToken = default)
    {
        var (start, end) = ValidateRange(from, to);
        if (!groupByMonth && (end - start).TotalDays > MaxDailyPoints)
            throw new BadRequestException($"Xem theo ngày tối đa {MaxDailyPoints} ngày. Hãy chọn xem theo tháng.");

        return await BuildTrendAsync(userId, start, end, groupByMonth, cancellationToken);
    }

    public async Task<ReportSnapshotResponse> CreateSnapshotAsync(Guid userId, ReportPeriodType periodType,
        DateOnly? referenceDate = null, CancellationToken cancellationToken = default)
    {
        var reference = referenceDate ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var (periodStart, periodEnd) = GetPeriod(periodType, reference);

        var report = await GetReportAsync(userId, DateRange.StartOfDay(periodStart), DateRange.StartOfDay(periodEnd),
            cancellationToken);
        var json = JsonSerializer.Serialize(report, Json);

        var snapshot = await db.ReportSnapshots.FirstOrDefaultAsync(
            s => s.UserId == userId && s.PeriodType == periodType && s.PeriodStart == periodStart, cancellationToken);
        if (snapshot is null)
        {
            snapshot = new ReportSnapshot
            {
                UserId = userId,
                PeriodType = periodType,
                PeriodStart = periodStart,
                PeriodEnd = periodEnd,
                DataJson = json
            };
            db.ReportSnapshots.Add(snapshot);
        }
        else
        {
            snapshot.PeriodEnd = periodEnd;
            snapshot.DataJson = json;
            snapshot.CreatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync(cancellationToken);
        return new ReportSnapshotResponse(snapshot.Id, snapshot.PeriodType, snapshot.PeriodStart, snapshot.PeriodEnd,
            report, snapshot.CreatedAt);
    }

    public async Task<PagedResult<ReportSnapshotResponse>> GetSnapshotsAsync(Guid userId,
        ReportPeriodType? periodType, PagingQuery paging, CancellationToken cancellationToken = default)
    {
        var source = db.ReportSnapshots.AsNoTracking().Where(s => s.UserId == userId);
        if (periodType is not null) source = source.Where(s => s.PeriodType == periodType);

        var total = await source.CountAsync(cancellationToken);
        var snapshots = await source
            .OrderByDescending(s => s.PeriodStart)
            .Skip((paging.Page - 1) * paging.PageSize)
            .Take(paging.PageSize)
            .ToListAsync(cancellationToken);

        var items = snapshots
            .Select(s => new { Snapshot = s, Data = JsonSerializer.Deserialize<ReportResponse>(s.DataJson, Json) })
            .Where(x => x.Data is not null)
            .Select(x => new ReportSnapshotResponse(x.Snapshot.Id, x.Snapshot.PeriodType, x.Snapshot.PeriodStart,
                x.Snapshot.PeriodEnd, x.Data!, x.Snapshot.CreatedAt))
            .ToList();

        return new PagedResult<ReportSnapshotResponse>(items, paging.Page, paging.PageSize, total);
    }

    // ---- helpers ----

    private static (DateTime Start, DateTime EndExclusive) ValidateRange(DateTime from, DateTime to)
    {
        var (start, end) = DateRange.Bounds(from, to);
        if ((end - start).TotalDays > MaxRangeDays)
            throw new BadRequestException("Khoảng thời gian tối đa là 10 năm.");
        return (start, end);
    }

    private async Task<(decimal Income, decimal Expense)> GetTotalsAsync(Guid userId, DateTime start, DateTime end,
        CancellationToken cancellationToken)
    {
        var rows = await db.Transactions.AsNoTracking()
            .Where(t => t.UserId == userId && t.TransactionDate >= start && t.TransactionDate < end)
            .GroupBy(t => t.Type)
            .Select(g => new { Type = g.Key, Total = g.Sum(x => x.Amount) })
            .ToListAsync(cancellationToken);

        return (rows.Where(r => r.Type == TransactionType.Income).Sum(r => r.Total),
            rows.Where(r => r.Type == TransactionType.Expense).Sum(r => r.Total));
    }

    private async Task<IReadOnlyList<TrendPoint>> BuildTrendAsync(Guid userId, DateTime start, DateTime end,
        bool groupByMonth, CancellationToken cancellationToken)
    {
        var rows = await db.Transactions.AsNoTracking()
            .Where(t => t.UserId == userId && t.TransactionDate >= start && t.TransactionDate < end)
            .GroupBy(t => new { Date = t.TransactionDate.Date, t.Type })
            .Select(g => new { g.Key.Date, g.Key.Type, Total = g.Sum(x => x.Amount) })
            .ToListAsync(cancellationToken);

        DateTime Bucket(DateTime date) => groupByMonth ? new DateTime(date.Year, date.Month, 1) : date.Date;

        var buckets = rows
            .GroupBy(r => Bucket(r.Date))
            .ToDictionary(
                g => g.Key,
                g => (Income: g.Where(r => r.Type == TransactionType.Income).Sum(r => r.Total),
                    Expense: g.Where(r => r.Type == TransactionType.Expense).Sum(r => r.Total)));

        // Fill empty days/months so charts get a continuous series.
        var points = new List<TrendPoint>();
        var cursor = Bucket(start);
        var last = end.AddTicks(-1);
        while (cursor <= last)
        {
            var (income, expense) = buckets.GetValueOrDefault(cursor);
            points.Add(new TrendPoint(cursor, income, expense));
            cursor = groupByMonth ? cursor.AddMonths(1) : cursor.AddDays(1);
        }
        return points;
    }

    private static IReadOnlyList<CategoryBreakdownItem> Breakdown(
        IEnumerable<(Guid CategoryId, string Name, decimal Total)> items, decimal grandTotal) =>
        items
            .OrderByDescending(i => i.Total)
            .Select(i => new CategoryBreakdownItem(i.CategoryId, i.Name, i.Total,
                grandTotal > 0 ? Math.Round(i.Total / grandTotal * 100m, 2) : 0m))
            .ToList();

    private static (DateOnly Start, DateOnly End) GetPeriod(ReportPeriodType type, DateOnly reference)
    {
        if (type == ReportPeriodType.Month)
        {
            var first = new DateOnly(reference.Year, reference.Month, 1);
            return (first, first.AddMonths(1).AddDays(-1));
        }

        // Weeks run Monday to Sunday.
        var offset = ((int)reference.DayOfWeek + 6) % 7;
        var monday = reference.AddDays(-offset);
        return (monday, monday.AddDays(6));
    }
}
