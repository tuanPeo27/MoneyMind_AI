using backend.DTOs.Requests;
using backend.DTOs.Responses;

namespace backend.Services.Interfaces;

public interface IBudgetService
{
    /// <param name="activeOn">When set, only budgets covering this date are returned.</param>
    Task<IReadOnlyList<BudgetResponse>> GetAllAsync(Guid userId, DateOnly? activeOn = null,
        CancellationToken cancellationToken = default);
    Task<BudgetResponse> GetByIdAsync(Guid userId, Guid id, CancellationToken cancellationToken = default);
    Task<BudgetResponse> CreateAsync(Guid userId, UpsertBudgetRequest request,
        CancellationToken cancellationToken = default);
    Task<BudgetResponse> UpdateAsync(Guid userId, Guid id, UpsertBudgetRequest request,
        CancellationToken cancellationToken = default);
    Task DeleteAsync(Guid userId, Guid id, CancellationToken cancellationToken = default);

    /// <summary>Creates a notification when spending in the category crosses a budget threshold.</summary>
    Task CheckAlertsAsync(Guid userId, Guid categoryId, DateTime transactionDate,
        CancellationToken cancellationToken = default);
}
