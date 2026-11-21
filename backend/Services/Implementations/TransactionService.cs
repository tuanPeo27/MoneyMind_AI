using backend.Data;
using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Helpers;
using backend.Models;
using backend.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.Implementations;

public sealed class TransactionService(
    AppDbContext db,
    IBudgetService budgetService,
    ILogger<TransactionService> logger) : ITransactionService
{
    public async Task<PagedResult<TransactionResponse>> GetPagedAsync(Guid userId, TransactionQuery query,
        CancellationToken cancellationToken = default)
    {
        var source = db.Transactions.AsNoTracking().Where(t => t.UserId == userId);

        if (query.From is { } from) source = source.Where(t => t.TransactionDate >= DateRange.AsUtc(from));
        if (query.To is { } to) source = source.Where(t => t.TransactionDate < DateRange.EndExclusive(DateRange.AsUtc(to)));
        if (query.AccountId is { } accountId) source = source.Where(t => t.AccountId == accountId);
        if (query.CategoryId is { } categoryId) source = source.Where(t => t.CategoryId == categoryId);
        if (query.Type is { } type) source = source.Where(t => t.Type == type);
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var search = query.Search.Trim();
            source = source.Where(t => t.Description != null && t.Description.Contains(search));
        }

        var total = await source.CountAsync(cancellationToken);
        var items = await Project(source)
            .OrderByDescending(t => t.TransactionDate).ThenByDescending(t => t.CreatedAt)
            .Skip((query.Page - 1) * query.PageSize)
            .Take(query.PageSize)
            .ToListAsync(cancellationToken);

        return new PagedResult<TransactionResponse>(items, query.Page, query.PageSize, total);
    }

    public async Task<TransactionResponse> GetByIdAsync(Guid userId, Guid id,
        CancellationToken cancellationToken = default) =>
        await Project(db.Transactions.AsNoTracking().Where(t => t.Id == id && t.UserId == userId))
            .FirstOrDefaultAsync(cancellationToken)
        ?? throw new NotFoundException("Không tìm thấy giao dịch.");

    public async Task<TransactionResponse> CreateAsync(Guid userId, UpsertTransactionRequest request,
        CancellationToken cancellationToken = default)
    {
        await ValidateAsync(userId, request, checkArchivedAccount: true, cancellationToken);

        var transaction = new Transaction
        {
            UserId = userId,
            AccountId = request.AccountId,
            CategoryId = request.CategoryId,
            Amount = request.Amount,
            Type = request.Type,
            Description = NormalizeDescription(request.Description),
            TransactionDate = DateRange.AsUtc(request.TransactionDate),
            Source = request.Source
        };
        db.Transactions.Add(transaction);
        await db.SaveChangesAsync(cancellationToken);

        await CheckBudgetAsync(transaction, cancellationToken);
        return await GetByIdAsync(userId, transaction.Id, cancellationToken);
    }

    public async Task<TransactionResponse> UpdateAsync(Guid userId, Guid id, UpsertTransactionRequest request,
        CancellationToken cancellationToken = default)
    {
        var transaction = await db.Transactions
            .FirstOrDefaultAsync(t => t.Id == id && t.UserId == userId, cancellationToken)
            ?? throw new NotFoundException("Không tìm thấy giao dịch.");

        await ValidateAsync(userId, request, checkArchivedAccount: transaction.AccountId != request.AccountId,
            cancellationToken);

        transaction.AccountId = request.AccountId;
        transaction.CategoryId = request.CategoryId;
        transaction.Amount = request.Amount;
        transaction.Type = request.Type;
        transaction.Description = NormalizeDescription(request.Description);
        transaction.TransactionDate = DateRange.AsUtc(request.TransactionDate);
        transaction.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        await CheckBudgetAsync(transaction, cancellationToken);
        return await GetByIdAsync(userId, id, cancellationToken);
    }

    public async Task DeleteAsync(Guid userId, Guid id, CancellationToken cancellationToken = default)
    {
        var transaction = await db.Transactions
            .FirstOrDefaultAsync(t => t.Id == id && t.UserId == userId, cancellationToken)
            ?? throw new NotFoundException("Không tìm thấy giao dịch.");

        // Keep suggestion logs, only detach them from the deleted transaction.
        await db.CategorySuggestionLogs
            .Where(l => l.TransactionId == id)
            .ExecuteUpdateAsync(setters => setters.SetProperty(l => l.TransactionId, (Guid?)null), cancellationToken);

        db.Transactions.Remove(transaction);
        await db.SaveChangesAsync(cancellationToken);
    }

    private IQueryable<TransactionResponse> Project(IQueryable<Transaction> source) =>
        from t in source
        join a in db.Accounts on t.AccountId equals a.Id
        join c in db.Categories on t.CategoryId equals c.Id
        select new TransactionResponse(t.Id, t.AccountId, a.Name, t.CategoryId, c.Name, t.Amount, t.Type,
            t.Description, t.TransactionDate, t.Source, t.CreatedAt, t.UpdatedAt);

    private async Task ValidateAsync(Guid userId, UpsertTransactionRequest request, bool checkArchivedAccount,
        CancellationToken cancellationToken)
    {
        var account = await db.Accounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == request.AccountId && a.UserId == userId, cancellationToken)
            ?? throw new BadRequestException("Ví không tồn tại.");
        if (checkArchivedAccount && account.IsArchived)
            throw new BadRequestException("Ví đã được lưu trữ.");

        var category = await db.Categories.AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == request.CategoryId && (c.IsSystem || c.UserId == userId),
                cancellationToken)
            ?? throw new BadRequestException("Danh mục không tồn tại.");
        if (!category.IsActive)
            throw new BadRequestException("Danh mục đã bị vô hiệu hóa.");

        var categoryIsExpense = category.Type == CategoryType.Expense;
        var transactionIsExpense = request.Type == TransactionType.Expense;
        if (categoryIsExpense != transactionIsExpense)
            throw new BadRequestException("Loại danh mục không khớp với loại giao dịch.");
    }

    /// <summary>Budget alerts are secondary: a failure must not fail the transaction that was already saved.</summary>
    private async Task CheckBudgetAsync(Transaction transaction, CancellationToken cancellationToken)
    {
        if (transaction.Type != TransactionType.Expense) return;

        try
        {
            await budgetService.CheckAlertsAsync(transaction.UserId, transaction.CategoryId,
                transaction.TransactionDate, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "Budget alert check failed for transaction {TransactionId}", transaction.Id);
        }
    }

    private static string? NormalizeDescription(string? description) =>
        string.IsNullOrWhiteSpace(description) ? null : description.Trim();
}
