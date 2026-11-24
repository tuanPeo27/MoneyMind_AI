using System.Text.Json;

namespace backend.DTOs;

// Contracts exchanged with the external AI service (see IAIServiceClient).

public sealed record AIChatTurn(string Role, string Content);

public static class AIChatModes
{
    public const string Chat = "chat";
    /// <summary>Quick entry: the model only turns the text into transactions (and categories).</summary>
    public const string Capture = "capture";
}

/// <param name="Language">`vi` or `en`: the language the answer must be written in. null = follow the user.</param>
/// <param name="Mode">See <see cref="AIChatModes"/>.</param>
public sealed record AIChatPayload(string Message, IReadOnlyList<AIChatTurn> History, string FinancialContext,
    string? Language = null, string Mode = AIChatModes.Chat);

/// <summary>A function call from the model, exactly as the AI service received it (arguments not yet checked).</summary>
public sealed record AIProposedAction(string Name, JsonElement Args);

/// <param name="Model">The model that answered. It differs from the first choice when the AI service fell back.</param>
/// <param name="Actions">Changes the model proposed. They still need the user's confirmation.</param>
public sealed record AIChatResult(string Content, string? Intent, int? TokenUsage, string? Provider, string? Model = null,
    IReadOnlyList<AIProposedAction>? Actions = null);

/// <summary>One line of the AI service's streamed answer.</summary>
/// <param name="Type">delta, action, done or error.</param>
public sealed record AIStreamEvent(string Type, string? Text = null, string? Name = null, JsonElement? Args = null,
    string? Intent = null, int? TokenUsage = null, string? Model = null, string? Provider = null, string? Message = null);

public sealed record AICategoryOption(Guid Id, string Name);

/// <param name="Id">A short id ("1", "2", ...) instead of the Guid: a Guid costs about 20 tokens.</param>
public sealed record AICategoryChoice(string Id, string Name);

public sealed record AICategorizePayload(
    string Description,
    decimal? Amount,
    string Type,
    IReadOnlyList<AICategoryChoice> Categories);

/// <summary>The AI service's answer; CategoryId is one of the short ids that were sent, or null.</summary>
public sealed record AICategorizeReply(string? CategoryId, decimal Confidence, string? Reason, int? TokenUsage,
    string? Provider, string? Model);

public sealed record AICategorizeResult(Guid? CategoryId, decimal Confidence, string? Reason, int? TokenUsage, string? Provider);

/// <param name="Facts">Compact JSON of numbers the backend computed; the AI only writes about them.</param>
public sealed record AIInsightPayload(string Facts, string? Language = "vi");

/// <param name="Severity">info, warning or critical.</param>
public sealed record AIInsightItem(string Title, string Content, string Severity);

/// <summary>Same argument meaning as the chat functions; FundName is the name of a new savings fund.</summary>
public sealed record AIInsightAction(string Name, string? Category, decimal? Amount, string? Goal, string? FundName,
    decimal? TargetAmount, string? Deadline);

public sealed record AIInsightRecommendation(string Title, string Description, AIInsightAction? Action);

public sealed record AIInsightResult(string Summary, IReadOnlyList<AIInsightItem> Items,
    IReadOnlyList<AIInsightRecommendation> Recommendations, int? TokenUsage, string? Provider, string? Model);

/// <summary>Candidate insight produced by deterministic rules (no AI call).</summary>
public sealed record InsightCandidate(
    string Type,
    string Title,
    string Content,
    backend.Models.AIInsightSeverity Severity,
    string? DataJson);

public sealed record FinancialSummary(
    DateTime From,
    DateTime To,
    decimal TotalIncome,
    decimal TotalExpense,
    IReadOnlyList<CategoryTotal> TopExpenseCategories,
    IReadOnlyList<BudgetStatus> Budgets,
    IReadOnlyList<GoalStatus> Goals);

public sealed record CategoryTotal(Guid CategoryId, string CategoryName, decimal Amount);

public sealed record BudgetStatus(string CategoryName, decimal Amount, decimal Spent, decimal UsedPercent);

public sealed record GoalStatus(string Name, decimal TargetAmount, decimal CurrentAmount, DateOnly? Deadline);
