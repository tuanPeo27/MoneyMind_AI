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
}
