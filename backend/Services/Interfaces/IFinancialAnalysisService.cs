using backend.DTOs;

namespace backend.Services.Interfaces;

public interface IFinancialAnalysisService
{
    Task<FinancialSummary> GetSummaryAsync(Guid userId, DateTime from, DateTime to,
        CancellationToken cancellationToken = default);

    /// <summary>Serialized summary (current month) used as context for AI prompts.</summary>
    Task<string> BuildContextAsync(Guid userId, CancellationToken cancellationToken = default);

    /// <summary>Rule-based insights: budget overruns, spending spikes, goals near deadline.</summary>
    Task<IReadOnlyList<InsightCandidate>> DetectInsightsAsync(Guid userId,
        CancellationToken cancellationToken = default);
}
