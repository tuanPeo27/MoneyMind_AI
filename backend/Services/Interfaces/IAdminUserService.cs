using backend.DTOs.Requests;
using backend.DTOs.Responses;

namespace backend.Services.Interfaces;

public interface IAdminUserService
{
    Task<PagedResult<AdminUserResponse>> GetPagedAsync(AdminUserQuery query,
        CancellationToken cancellationToken = default);
    Task<AdminUserResponse> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<AdminUserResponse> LockAsync(Guid id, LockUserRequest request, CancellationToken cancellationToken = default);
    Task<AdminUserResponse> UnlockAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>Grants the user 10, 20 or 50 AI messages per day, or unlimited (-1). null follows the system default.</summary>
    Task<AdminUserResponse> SetAIQuotaAsync(Guid id, SetAIQuotaRequest request,
        CancellationToken cancellationToken = default);
}
