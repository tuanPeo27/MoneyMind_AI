using backend.DTOs.Responses;

namespace backend.Services.Interfaces;

public interface IHealthCheckService
{
    /// <summary>Probes every dependency (database, AI service, email) and stores the results.</summary>
    Task<SystemHealthResponse> CheckAsync(CancellationToken cancellationToken = default);

    /// <summary>Most recent stored result per service.</summary>
    Task<SystemHealthResponse> GetLatestAsync(CancellationToken cancellationToken = default);

    Task<IReadOnlyList<HealthCheckResponse>> GetHistoryAsync(string? serviceName, int take = 50,
        CancellationToken cancellationToken = default);

    Task<SystemStatsResponse> GetSystemStatsAsync(CancellationToken cancellationToken = default);
}
