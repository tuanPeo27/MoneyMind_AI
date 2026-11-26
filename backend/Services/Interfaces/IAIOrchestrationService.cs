using backend.DTOs;
using backend.Models;

namespace backend.Services.Interfaces;

/// <summary>
/// Coordinates AI features: builds financial context, calls the AI client, measures duration
/// and writes an <see cref="AIProcessingLog"/> for every request.
/// </summary>
public interface IAIOrchestrationService
{
    /// <exception cref="backend.Helpers.ServiceUnavailableException">The AI service failed.</exception>
    /// <param name="onDelta">Called with each piece of the answer as it is generated (streaming); may be null.</param>
    /// <param name="mode">See <see cref="AIChatModes"/>.</param>
    Task<AIChatResult> ChatAsync(Guid userId, string message, IReadOnlyList<AIChatTurn> history,
        string? language = null, Func<string, Task>? onDelta = null, string mode = AIChatModes.Chat,
        CancellationToken cancellationToken = default);

    /// <returns>null when the AI service failed (the failure is logged).</returns>
    Task<AICategorizeResult?> CategorizeAsync(Guid userId, string description, decimal? amount, TransactionType type,
        IReadOnlyList<AICategoryOption> categories, CancellationToken cancellationToken = default);

    /// <summary>Writes the weekly summary for facts the backend computed (logged as WeeklyInsight).</summary>
    /// <returns>null when the AI service failed (the failure is logged).</returns>
    Task<AIInsightResult?> GenerateInsightsAsync(Guid userId, string facts, CancellationToken cancellationToken = default);
}
