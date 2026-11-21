using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Models;

namespace backend.Services.Interfaces;

public interface IFinancialGoalService
{
    Task<IReadOnlyList<FinancialGoalResponse>> GetAllAsync(Guid userId, FinancialGoalStatus? status = null,
        CancellationToken cancellationToken = default);
    Task<FinancialGoalResponse> GetByIdAsync(Guid userId, Guid id, CancellationToken cancellationToken = default);
    Task<FinancialGoalResponse> CreateAsync(Guid userId, UpsertGoalRequest request,
        CancellationToken cancellationToken = default);
    Task<FinancialGoalResponse> UpdateAsync(Guid userId, Guid id, UpsertGoalRequest request,
        CancellationToken cancellationToken = default);
    Task<FinancialGoalResponse> ContributeAsync(Guid userId, Guid id, GoalContributionRequest request,
        CancellationToken cancellationToken = default);
    Task<FinancialGoalResponse> UpdateStatusAsync(Guid userId, Guid id, UpdateGoalStatusRequest request,
        CancellationToken cancellationToken = default);
    Task DeleteAsync(Guid userId, Guid id, CancellationToken cancellationToken = default);
}
