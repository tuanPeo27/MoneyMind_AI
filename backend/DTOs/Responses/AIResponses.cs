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

public sealed record SendChatMessageResponse(
    Guid? ConversationId,
    ChatMessageResponse UserMessage,
    ChatMessageResponse AssistantMessage);

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
