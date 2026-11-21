using backend.DTOs;

namespace backend.Services.Interfaces;

/// <summary>Low-level HTTP client for the external AI service.</summary>
public interface IAIServiceClient
{
    Task<AIChatResult> ChatAsync(AIChatPayload payload, CancellationToken cancellationToken = default);
    Task<AICategorizeResult> CategorizeAsync(AICategorizePayload payload,
        CancellationToken cancellationToken = default);
    Task<AIInsightResult> GenerateInsightsAsync(AIInsightPayload payload,
        CancellationToken cancellationToken = default);
    Task<bool> IsHealthyAsync(CancellationToken cancellationToken = default);
}
