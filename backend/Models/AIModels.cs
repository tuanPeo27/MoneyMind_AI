namespace backend.Models;

public sealed class AIConversation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public byte[] TitleCipher { get; set; } = [];
    public byte[] TitleNonce { get; set; } = [];
    public int KeyVersion { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public bool IsArchived { get; set; }
    public DateTime? DeletedAt { get; set; }
}

public sealed class AIChatMessage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ConversationId { get; set; }
    public int Sequence { get; set; }
    public ChatMessageRole Role { get; set; }
    public byte[] ContentCipher { get; set; } = [];
    public byte[] Nonce { get; set; } = [];
    public int KeyVersion { get; set; }
    public string? Intent { get; set; }
    public string? Metadata { get; set; }
    public AIProcessingStatus Status { get; set; } = AIProcessingStatus.Pending;
    public int? TokenUsage { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class AIFeedback
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public Guid MessageId { get; set; }
    public string Rating { get; set; } = string.Empty;
    public string? FeedbackText { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class UserEncryptionKey
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public byte[] WrappedDek { get; set; } = [];
    public int KeyVersion { get; set; }
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? RotatedAt { get; set; }
}

public sealed class AIInsight
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string InsightType { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public AIInsightSeverity Severity { get; set; }
    public string? DataJson { get; set; }
    public int? SchemaVersion { get; set; }
    public bool IsRead { get; set; }
    public bool IsDismissed { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ExpiresAt { get; set; }
}

public sealed class AIRecommendation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string RecommendationType { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string? DataJson { get; set; }
    public AIRecommendationStatus Status { get; set; } = AIRecommendationStatus.Pending;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ExpiresAt { get; set; }
}

public sealed class ReportSnapshot
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public ReportPeriodType PeriodType { get; set; }
    public DateOnly PeriodStart { get; set; }
    public DateOnly PeriodEnd { get; set; }
    public string DataJson { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class UserAISettings
{
    public Guid UserId { get; set; }
    public bool ProactiveEnabled { get; set; }
    public string ReportFrequency { get; set; } = string.Empty;
    public byte DefaultAlertThreshold { get; set; }
    public bool SaveChatHistory { get; set; }
    public int RetentionDays { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class CategorySuggestionLog
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public Guid? TransactionId { get; set; }
    public string Description { get; set; } = string.Empty;
    public Guid SuggestedCategoryId { get; set; }
    public Guid? FinalCategoryId { get; set; }
    public decimal Confidence { get; set; }
    public string? Reason { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// A change the AI assistant proposed in a reply (add a transaction, a category, ...). It is only carried out when the
/// user confirms it. The details are encrypted with the user's key, like the chat message they came from.
/// </summary>
public sealed class AIAction
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    /// <summary>The assistant message that proposed it.</summary>
    public Guid MessageId { get; set; }
    public string ActionType { get; set; } = string.Empty;
    public byte[] PayloadCipher { get; set; } = [];
    public byte[] PayloadNonce { get; set; } = [];
    public int KeyVersion { get; set; }
    public AIActionStatus Status { get; set; } = AIActionStatus.Pending;
    /// <summary>Id of the record created when the action was confirmed (transaction, category, budget or goal).</summary>
    public Guid? ResultId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ResolvedAt { get; set; }
}
