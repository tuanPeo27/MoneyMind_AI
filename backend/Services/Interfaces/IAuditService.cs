using backend.DTOs.Requests;
using backend.DTOs.Responses;

namespace backend.Services.Interfaces;

public interface IAuditService
{
    /// <summary>Records an admin action. Admin id and IP address come from the current request.</summary>
    Task LogAsync(string action, string targetType, Guid? targetId = null, string? detail = null,
        CancellationToken cancellationToken = default);

    Task<PagedResult<AuditLogResponse>> GetPagedAsync(AuditLogQuery query,
        CancellationToken cancellationToken = default);
}
