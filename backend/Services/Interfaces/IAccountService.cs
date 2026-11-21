using backend.DTOs.Requests;
using backend.DTOs.Responses;

namespace backend.Services.Interfaces;

public interface IAccountService
{
    Task<IReadOnlyList<AccountResponse>> GetAllAsync(Guid userId, bool includeArchived = false,
        CancellationToken cancellationToken = default);
    Task<AccountResponse> GetByIdAsync(Guid userId, Guid id, CancellationToken cancellationToken = default);
    Task<AccountResponse> CreateAsync(Guid userId, CreateAccountRequest request,
        CancellationToken cancellationToken = default);
    Task<AccountResponse> UpdateAsync(Guid userId, Guid id, UpdateAccountRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>Deletes the account, or archives it when it already has transactions.</summary>
    Task DeleteAsync(Guid userId, Guid id, CancellationToken cancellationToken = default);
}
