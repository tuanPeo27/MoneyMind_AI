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
