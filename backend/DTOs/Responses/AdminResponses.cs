using backend.Models;

namespace backend.DTOs.Responses;

public sealed record AdminUserResponse(
    Guid Id,
    string FullName,
    string Email,
    string? AvatarUrl,
    bool IsActive,
    DateTime? LockedAt,
    string? LockedReason,
    DateTime? LastLoginAt,
    DateTime CreatedAt,
    IReadOnlyList<string> Roles);

public sealed record AuditLogResponse(
    Guid Id,
    Guid AdminId,
    string Action,
    string TargetType,
    Guid? TargetId,
    string? Detail,
    string? IpAddress,
    DateTime CreatedAt);

public sealed record AIProcessingLogResponse(
    Guid Id,
    Guid? UserId,
    Guid RequestId,
    string TaskType,
    string? Provider,
    int DurationMs,
    AIProcessingStatus Status,
    string? ErrorCode,
    int? TokenUsage,
    DateTime CreatedAt);

public sealed record AITaskStats(string TaskType, int Count, int Failed, double AvgDurationMs);

public sealed record AIUsageStatsResponse(
    DateTime From,
    DateTime To,
    int TotalRequests,
    int FailedRequests,
    double AvgDurationMs,
    long TotalTokens,
    IReadOnlyList<AITaskStats> ByTask);

public sealed record SystemStatsResponse(
    int TotalUsers,
    int ActiveUsers,
    int LockedUsers,
    int NewUsersLast7Days,
    int TotalTransactions,
    int TotalConversations,
    int AIRequestsLast24Hours,
    int AIFailuresLast24Hours);

public sealed record HealthCheckResponse(
    string ServiceName,
    string Status,
    int? LatencyMs,
    string? Message,
    DateTime CheckedAt);

public sealed record SystemHealthResponse(string OverallStatus, IReadOnlyList<HealthCheckResponse> Services);

public sealed record SystemSettingResponse(
    string Key,
    string Value,
    string? Description,
    string? UpdatedBy,
    DateTime UpdatedAt);

public sealed record AnnouncementResponse(
    Guid Id,
    Guid AdminId,
    string Title,
    string Content,
    DateTime StartAt,
    DateTime? EndAt,
    bool IsActive,
    DateTime CreatedAt);
