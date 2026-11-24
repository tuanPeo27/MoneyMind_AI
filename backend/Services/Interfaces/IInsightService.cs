using backend.DTOs.Responses;

namespace backend.Services.Interfaces;

/// <summary>
/// Weekly summary of the last complete week (Monday to Sunday, user's time zone). The numbers are computed here; the
/// AI only writes the text and up to 2 recommendations, with at most one AI call per user per week.
/// </summary>
public interface IInsightService
{
    /// <returns>null when the user has no weekly summary yet.</returns>
    Task<WeeklySummaryResponse?> GetLatestWeeklyAsync(Guid userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns this week's summary of last week, creating it when missing. Without transactions last week nothing
    /// is created (null). <paramref name="notify"/> sends an in-app notification (used by the background job).
    /// </summary>
    Task<WeeklySummaryResponse?> GenerateWeeklyAsync(Guid userId, bool notify, CancellationToken cancellationToken = default);

    Task MarkReadAsync(Guid userId, Guid insightId, CancellationToken cancellationToken = default);

    /// <summary>Turns the recommendation's action (if any) into an AI action the user still has to confirm.</summary>
    Task<AcceptRecommendationResponse> AcceptRecommendationAsync(Guid userId, Guid id,
        CancellationToken cancellationToken = default);

    Task<RecommendationResponse> DismissRecommendationAsync(Guid userId, Guid id,
        CancellationToken cancellationToken = default);
}
