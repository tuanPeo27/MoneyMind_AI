namespace backend.DTOs;

// Contracts exchanged with the external AI service (see IAIServiceClient).

public sealed record AIChatTurn(string Role, string Content);

/// <param name="Language">`vi` or `en`: the language the answer must be written in. null = follow the user.</param>
public sealed record AIChatPayload(string Message, IReadOnlyList<AIChatTurn> History, string FinancialContext,
    string? Language = null);

/// <param name="Model">The model that answered. It differs from the first choice when the AI service fell back.</param>
public sealed record AIChatResult(string Content, string? Intent, int? TokenUsage, string? Provider, string? Model = null);

public sealed record AICategoryOption(Guid Id, string Name);

public sealed record AICategorizePayload(
    string Description,
    decimal? Amount,
    string Type,
    IReadOnlyList<AICategoryOption> Categories);

public sealed record AICategorizeResult(Guid? CategoryId, decimal Confidence, string? Reason, int? TokenUsage, string? Provider);

public sealed record AIInsightPayload(string FinancialContext);

public sealed record AIInsightItem(
    string Kind,
    string Type,
    string Title,
    string Content,
    string Severity,
    string? DataJson);

public sealed record AIInsightResult(IReadOnlyList<AIInsightItem> Items, int? TokenUsage, string? Provider);

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
