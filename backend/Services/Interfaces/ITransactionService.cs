using backend.DTOs.Requests;
using backend.DTOs.Responses;

namespace backend.Services.Interfaces;

public interface ITransactionService
{
    Task<PagedResult<TransactionResponse>> GetPagedAsync(Guid userId, TransactionQuery query,
        CancellationToken cancellationToken = default);
    Task<TransactionResponse> GetByIdAsync(Guid userId, Guid id, CancellationToken cancellationToken = default);
    Task<TransactionResponse> CreateAsync(Guid userId, UpsertTransactionRequest request,
        CancellationToken cancellationToken = default);
    Task<TransactionResponse> UpdateAsync(Guid userId, Guid id, UpsertTransactionRequest request,
        CancellationToken cancellationToken = default);
    Task DeleteAsync(Guid userId, Guid id, CancellationToken cancellationToken = default);
}
