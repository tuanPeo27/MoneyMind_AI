using backend.DTOs;

namespace backend.Services.Interfaces;

/// <summary>Low-level HTTP client for the external AI service.</summary>
public interface IAIServiceClient
{
    Task<AIChatResult> ChatAsync(AIChatPayload payload, CancellationToken cancellationToken = default);

    /// <summary>Same as <see cref="ChatAsync"/>, calling <paramref name="onDelta"/> with each piece of text as it arrives.</summary>
    Task<AIChatResult> StreamChatAsync(AIChatPayload payload, Func<string, Task>? onDelta,
        CancellationToken cancellationToken = default);
    Task<AICategorizeReply> CategorizeAsync(AICategorizePayload payload,
        CancellationToken cancellationToken = default);
    Task<AIInsightResult> GenerateInsightsAsync(AIInsightPayload payload,
        CancellationToken cancellationToken = default);
    Task<bool> IsHealthyAsync(CancellationToken cancellationToken = default);
}
