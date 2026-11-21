using backend.DTOs.Requests;
using backend.DTOs.Responses;

namespace backend.Services.Interfaces;

public interface IInsightService
{
    Task<PagedResult<InsightResponse>> GetInsightsAsync(Guid userId, InsightQuery query,
        CancellationToken cancellationToken = default);
    Task MarkReadAsync(Guid userId, Guid id, CancellationToken cancellationToken = default);
    Task DismissAsync(Guid userId, Guid id, CancellationToken cancellationToken = default);

    Task<PagedResult<RecommendationResponse>> GetRecommendationsAsync(Guid userId, RecommendationQuery query,
        CancellationToken cancellationToken = default);
    Task<RecommendationResponse> AcceptRecommendationAsync(Guid userId, Guid id,
        CancellationToken cancellationToken = default);
    Task<RecommendationResponse> DismissRecommendationAsync(Guid userId, Guid id,
        CancellationToken cancellationToken = default);

    /// <summary>Runs rule-based analysis and the AI service, stores new insights/recommendations.</summary>
    Task<IReadOnlyList<InsightResponse>> GenerateAsync(Guid userId, CancellationToken cancellationToken = default);
}
