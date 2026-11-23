using backend.Models;

namespace backend.DTOs.Responses;

public sealed record ConversationResponse(
    Guid Id,
    string Title,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    bool IsArchived);

public sealed record ChatMessageResponse(
    Guid Id,
    Guid? ConversationId,
    int Sequence,
    ChatMessageRole Role,
    string Content,
    string? Intent,
    AIProcessingStatus Status,
    DateTime CreatedAt);

/// <param name="DailyLimit">null when the user has no limit.</param>
/// <param name="Remaining">null when the user has no limit.</param>
/// <param name="ResetsAt">UTC time when the count starts again (the user's next local midnight).</param>
public sealed record AIUsageResponse(bool IsUnlimited, int? DailyLimit, int Used, int? Remaining, DateTime ResetsAt);

public sealed record SendChatMessageResponse(
    Guid? ConversationId,
    ChatMessageResponse UserMessage,
    ChatMessageResponse AssistantMessage,
    AIUsageResponse Usage);

public sealed record InsightResponse(
    Guid Id,
    string InsightType,
    string Title,
    string Content,
    AIInsightSeverity Severity,
    string? DataJson,
    bool IsRead,
    DateTime CreatedAt,
    DateTime? ExpiresAt);

public sealed record RecommendationResponse(
    Guid Id,
    string RecommendationType,
    string Title,
    string Description,
    string? DataJson,
    AIRecommendationStatus Status,
    DateTime CreatedAt,
    DateTime? ExpiresAt);

public sealed record AISettingsResponse(
    bool ProactiveEnabled,
    string ReportFrequency,
    byte DefaultAlertThreshold,
    bool SaveChatHistory,
    int RetentionDays,
    DateTime UpdatedAt);
