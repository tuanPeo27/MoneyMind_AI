using System.ComponentModel.DataAnnotations;
using backend.Models;

namespace backend.DTOs.Requests;

public sealed record SendChatMessageRequest(
    Guid? ConversationId,
    [Required, StringLength(4000)] string Message);

public sealed record RenameConversationRequest([Required, StringLength(200)] string Title);

public sealed record ChatFeedbackRequest(
    [Required, RegularExpression("^(up|down)$", ErrorMessage = "Rating must be 'up' or 'down'.")] string Rating,
    [StringLength(2000)] string? FeedbackText);

public sealed record UpdateAISettingsRequest(
    bool ProactiveEnabled,
    [Required, RegularExpression("^(Daily|Weekly|Monthly|Off)$")] string ReportFrequency,
    [Range(1, 100)] byte DefaultAlertThreshold,
    bool SaveChatHistory,
    [Range(1, 3650)] int RetentionDays);

public sealed class InsightQuery : PagingQuery
{
    public bool UnreadOnly { get; set; }
}

public sealed class RecommendationQuery : PagingQuery
{
    public AIRecommendationStatus? Status { get; set; }
}
