using backend.DTOs.Requests;
using backend.DTOs.Responses;
using backend.Models;

namespace backend.Services.Interfaces;

public interface IAIProcessingLogService
{
    Task LogAsync(Guid? userId, Guid requestId, string taskType, string? provider, int durationMs,
        AIProcessingStatus status, string? errorCode = null, int? tokenUsage = null,
        CancellationToken cancellationToken = default);

    Task<PagedResult<AIProcessingLogResponse>> GetPagedAsync(AIProcessingLogQuery query,
        CancellationToken cancellationToken = default);

    Task<AIUsageStatsResponse> GetStatsAsync(DateTime from, DateTime to,
        CancellationToken cancellationToken = default);
}
