using System.Data;
using backend.Data;
using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.Implementations;

public sealed class BudgetService(
    AppDbContext db,
    INotificationService notifications,
    ILogger<BudgetService> logger,
    FinancialContextCache contextCache) : IBudgetService
{
    private const decimal MaxAmount = 999_999_999_999_999m;

    public async Task<IReadOnlyList<BudgetResponse>> GetAllAsync(Guid userId, DateOnly? activeOn = null,
        CancellationToken cancellationToken = default)
    {
        var query = db.Budgets.AsNoTracking().Where(b => b.UserId == userId);
        if (activeOn is { } date) query = query.Where(b => b.StartDate <= date && b.EndDate >= date);

        var rows = await (from b in query
                          join c in db.Categories on b.CategoryId equals c.Id
                          orderby b.StartDate descending, c.Name
                          select new { Budget = b, CategoryName = c.Name })
            .ToListAsync(cancellationToken);

        var result = new List<BudgetResponse>(rows.Count);
        foreach (var row in rows)
        {
            var spent = await GetSpentAsync(userId, row.Budget, cancellationToken);
            result.Add(Map(row.Budget, row.CategoryName, spent));
        }
        return result;
    }

    public async Task<BudgetResponse> GetByIdAsync(Guid userId, Guid id, CancellationToken cancellationToken = default)
    {
        var budget = await db.Budgets.AsNoTracking()
            .FirstOrDefaultAsync(b => b.Id == id && b.UserId == userId, cancellationToken)
            ?? throw new NotFoundException("Không tìm thấy ngân sách.");
        return await BuildAsync(userId, budget, cancellationToken);
    }

    public async Task<BudgetResponse> CreateAsync(Guid userId, UpsertBudgetRequest request,
        CancellationToken cancellationToken = default)
    {
        await ValidateAsync(userId, request, null, cancellationToken);

        var budget = new Budget
        {
            UserId = userId,
            CategoryId = request.CategoryId,
            Amount = request.Amount,
            StartDate = request.StartDate,
            EndDate = request.EndDate,
            AlertThreshold = request.AlertThreshold
        };
        db.Budgets.Add(budget);
        await db.SaveChangesAsync(cancellationToken);
        await CheckAfterChangeAsync(userId, budget, cancellationToken);
        return await BuildAsync(userId, budget, cancellationToken);
    }

    public async Task<IReadOnlyList<BudgetResponse>> CreateManyAsync(Guid userId, IReadOnlyList<UpsertBudgetRequest> requests,
        CancellationToken cancellationToken = default)
    {
        if (requests.Count == 0) throw new BadRequestException("Hãy chọn ít nhất một danh mục.");
        if (requests.Count > BulkCreateBudgetsRequest.MaxItems)
            throw new BadRequestException($"Tối đa {BulkCreateBudgetsRequest.MaxItems} ngân sách mỗi lần.");

        // Attributes on the DTO only run on model binding; this is also called by the AI action service.
        foreach (var r in requests)
        {
            if (r.Amount <= 0) throw new BadRequestException("Hạn mức phải lớn hơn 0.");
            if (r.Amount > MaxAmount) throw new BadRequestException("Hạn mức quá lớn.");
            if (r.AlertThreshold is < 1 or > 100) throw new BadRequestException("Ngưỡng cảnh báo phải từ 1 đến 100%.");
            if (r.EndDate < r.StartDate) throw new BadRequestException("Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.");
        }

        var ids = requests.Select(r => r.CategoryId).Distinct().ToList();
        var categories = await db.Categories.AsNoTracking()
            .Where(c => ids.Contains(c.Id) && c.IsActive && (c.IsSystem || c.UserId == userId))
            .ToDictionaryAsync(c => c.Id, cancellationToken);
        if (categories.Count != ids.Count) throw new BadRequestException("Danh mục không tồn tại.");
        var notExpense = categories.Values.Where(c => c.Type != CategoryType.Expense).Select(c => c.Name).ToList();
        if (notExpense.Count > 0)
            throw new BadRequestException($"Ngân sách chỉ áp dụng cho danh mục chi tiêu: {string.Join(", ", notExpense)}.");

        // The same category twice with overlapping dates: the database check below cannot see unsaved rows.
        for (var i = 0; i < requests.Count; i++)
            for (var j = i + 1; j < requests.Count; j++)
                if (requests[i].CategoryId == requests[j].CategoryId
                    && requests[i].StartDate <= requests[j].EndDate && requests[j].StartDate <= requests[i].EndDate)
                    throw new BadRequestException($"Danh mục {categories[requests[i].CategoryId].Name} bị trùng trong yêu cầu.");

        var created = new List<Budget>(requests.Count);
        // Serializable: a second request for the same categories waits instead of also passing the overlap check.
        await using (var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken))
        {
            var existing = await db.Budgets.AsNoTracking()
                .Where(b => b.UserId == userId && ids.Contains(b.CategoryId))
                .Select(b => new { b.CategoryId, b.StartDate, b.EndDate })
                .ToListAsync(cancellationToken);
            var conflicts = requests
                .Where(r => existing.Any(b => b.CategoryId == r.CategoryId && b.StartDate <= r.EndDate && b.EndDate >= r.StartDate))
                .Select(r => categories[r.CategoryId].Name).Distinct().ToList();
            // Nothing is overwritten: the caller decides what to do with the categories that already have a budget.
            if (conflicts.Count > 0)
                throw new ConflictException($"Đã có ngân sách trong kỳ này cho: {string.Join(", ", conflicts)}. Hãy bỏ chọn các danh mục đó.");

            foreach (var r in requests)
            {
                var budget = new Budget
                {
                    UserId = userId, CategoryId = r.CategoryId, Amount = r.Amount,
                    StartDate = r.StartDate, EndDate = r.EndDate, AlertThreshold = r.AlertThreshold
                };
                db.Budgets.Add(budget);
                created.Add(budget);
            }
            try
            {
                await db.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
            }
            catch
            {
                // Not saved: detach the rows so a retry on the same context does not insert them twice.
                foreach (var budget in created) db.Entry(budget).State = EntityState.Detached;
                throw;
            }
        }

        var result = new List<BudgetResponse>(created.Count);
        foreach (var budget in created)
        {
            await CheckAfterChangeAsync(userId, budget, cancellationToken);
            result.Add(Map(budget, categories[budget.CategoryId].Name, await GetSpentAsync(userId, budget, cancellationToken)));
        }
        return result;
    }

    public async Task<BulkCreateBudgetsResponse> CreateForPeriodAsync(Guid userId, BulkCreateBudgetsRequest request,
        CancellationToken cancellationToken = default)
    {
        var timeZoneId = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.TimeZoneId)
            .FirstOrDefaultAsync(cancellationToken) ?? "UTC";
        var (start, end) = BudgetPeriod.Require(request.Period, FinancialAnalysisService.LocalToday(timeZoneId));
        var created = await CreateManyAsync(userId,
            request.Budgets.Select(b => new UpsertBudgetRequest(b.CategoryId, b.LimitAmount, start, end, b.AlertThreshold)).ToList(),
            cancellationToken);
        return new BulkCreateBudgetsResponse(BudgetPeriod.Format(start), start, end, created);
    }

    public async Task<BudgetResponse> UpdateAsync(Guid userId, Guid id, UpsertBudgetRequest request,
        CancellationToken cancellationToken = default)
    {
        var budget = await db.Budgets.FirstOrDefaultAsync(b => b.Id == id && b.UserId == userId, cancellationToken)
            ?? throw new NotFoundException("Không tìm thấy ngân sách.");

        await ValidateAsync(userId, request, id, cancellationToken);

        budget.CategoryId = request.CategoryId;
        budget.Amount = request.Amount;
        budget.StartDate = request.StartDate;
        budget.EndDate = request.EndDate;
        budget.AlertThreshold = request.AlertThreshold;
        await db.SaveChangesAsync(cancellationToken);
        await CheckAfterChangeAsync(userId, budget, cancellationToken);
        return await BuildAsync(userId, budget, cancellationToken);
    }

    public async Task DeleteAsync(Guid userId, Guid id, CancellationToken cancellationToken = default)
    {
        var deleted = await db.Budgets
            .Where(b => b.Id == id && b.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken);
        contextCache.Invalidate(userId); // ExecuteDelete bypasses the change interceptor
        if (deleted == 0) throw new NotFoundException("Không tìm thấy ngân sách.");
    }

    public async Task CheckAlertsAsync(Guid userId, Guid categoryId, DateTime transactionDate,
        CancellationToken cancellationToken = default)
    {
        var date = DateOnly.FromDateTime(transactionDate);
        var budgets = await db.Budgets.AsNoTracking()
            .Where(b => b.UserId == userId && b.CategoryId == categoryId && b.StartDate <= date && b.EndDate >= date)
            .ToListAsync(cancellationToken);
        if (budgets.Count == 0) return;

        var categoryName = await db.Categories.Where(c => c.Id == categoryId).Select(c => c.Name)
            .FirstOrDefaultAsync(cancellationToken) ?? string.Empty;

        foreach (var budget in budgets)
        {
            var spent = await GetSpentAsync(userId, budget, cancellationToken);
            var usedPercent = budget.Amount > 0 ? spent / budget.Amount * 100m : 0m;

            string title, message;
            if (spent > budget.Amount)
            {
                title = $"Vượt ngân sách {categoryName}";
                message = $"Chi tiêu {categoryName} đã vượt ngân sách {spent - budget.Amount:N0} ({spent:N0} / {budget.Amount:N0}).";
            }
            else if (spent == budget.Amount)
            {
                title = $"Đạt ngân sách {categoryName}";
                message = $"Bạn đã dùng hết ngân sách {categoryName} ({spent:N0} / {budget.Amount:N0}).";
            }
            else if (usedPercent >= budget.AlertThreshold)
            {
                title = $"Sắp vượt ngân sách {categoryName}";
                message = $"Bạn đã dùng {usedPercent:N0}% ngân sách {categoryName} ({spent:N0} / {budget.Amount:N0}).";
            }
            else
            {
                continue;
            }

            // One notification per budget and level.
            var alreadySent = await db.Notifications.AnyAsync(
                n => n.UserId == userId && n.RelatedType == "Budget" && n.RelatedId == budget.Id && n.Title == title,
                cancellationToken);
            if (alreadySent) continue;

            await notifications.CreateAsync(userId, NotificationType.Warning, NotificationSource.Budget, title,
                message, "Budget", budget.Id, cancellationToken);
        }
    }

    /// <summary>
    /// A budget created or raised/lowered after spending already happened can be at or over its limit right away.
    /// Alerts are secondary, so a failure here must not fail the saved budget.
    /// </summary>
    private async Task CheckAfterChangeAsync(Guid userId, Budget budget, CancellationToken cancellationToken)
    {
        try
        {
            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            var date = today < budget.StartDate ? budget.StartDate : today > budget.EndDate ? budget.EndDate : today;
            await CheckAlertsAsync(userId, budget.CategoryId, DateRange.StartOfDay(date), cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "Budget alert check failed for budget {BudgetId}", budget.Id);
        }
    }

    private async Task ValidateAsync(Guid userId, UpsertBudgetRequest request, Guid? excludeId,
        CancellationToken cancellationToken)
    {
        if (request.EndDate < request.StartDate)
            throw new BadRequestException("Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.");

        var category = await db.Categories.AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == request.CategoryId && (c.IsSystem || c.UserId == userId),
                cancellationToken)
            ?? throw new BadRequestException("Danh mục không tồn tại.");
        if (category.Type != CategoryType.Expense)
            throw new BadRequestException("Ngân sách chỉ áp dụng cho danh mục chi tiêu.");

        var overlaps = await db.Budgets.AnyAsync(b =>
            b.UserId == userId && b.CategoryId == request.CategoryId && b.Id != excludeId
            && b.StartDate <= request.EndDate && b.EndDate >= request.StartDate, cancellationToken);
        if (overlaps) throw new ConflictException("Đã có ngân sách cho danh mục này trong khoảng thời gian đó.");
    }

    private async Task<BudgetResponse> BuildAsync(Guid userId, Budget budget, CancellationToken cancellationToken)
    {
        var categoryName = await db.Categories.AsNoTracking().Where(c => c.Id == budget.CategoryId)
            .Select(c => c.Name).FirstOrDefaultAsync(cancellationToken) ?? string.Empty;
        var spent = await GetSpentAsync(userId, budget, cancellationToken);
        return Map(budget, categoryName, spent);
    }

    private async Task<decimal> GetSpentAsync(Guid userId, Budget budget, CancellationToken cancellationToken)
    {
        var from = DateRange.StartOfDay(budget.StartDate);
        var to = DateRange.StartOfDay(budget.EndDate.AddDays(1));

        return await db.Transactions.AsNoTracking()
            .Where(t => t.UserId == userId && t.CategoryId == budget.CategoryId
                && t.Type == TransactionType.Expense && t.TransactionDate >= from && t.TransactionDate < to)
            .SumAsync(t => (decimal?)t.Amount, cancellationToken) ?? 0m;
    }

    private static BudgetResponse Map(Budget b, string categoryName, decimal spent)
    {
        var used = b.Amount > 0 ? Math.Round(spent / b.Amount * 100m, 2) : 0m;
        return new BudgetResponse(b.Id, b.CategoryId, categoryName, b.Amount, spent, b.Amount - spent, used,
            b.StartDate, b.EndDate, b.AlertThreshold, used >= b.AlertThreshold, spent > b.Amount);
    }
}
