using backend.Models;

namespace backend.DTOs;

/// <summary>Changes the AI assistant may propose. Anything else the model asks for is ignored.</summary>
public static class AIActionTypes
{
    public const string CreateTransaction = "create_transaction";
    public const string CreateAccount = "create_account";
    public const string CreateCategory = "create_category";
    public const string CreateBudget = "create_budget";
    public const string CreateSavingsGoal = "create_savings_goal";
    public const string ContributeToGoal = "contribute_to_goal";
    /// <summary>Several monthly budgets in one card; the user picks and edits them, then they are created together.</summary>
    public const string ProposeBudgets = "propose_budgets";

    public const int MaxPerMessage = 5;
    /// <summary>Items kept from one budget proposal.</summary>
    public const int MaxBudgetItems = 10;

    public static readonly IReadOnlySet<string> All = new HashSet<string>
    {
        CreateTransaction, CreateAccount, CreateCategory, CreateBudget, CreateSavingsGoal, ContributeToGoal, ProposeBudgets
    };
}

/// <summary>
/// One category in a budget proposal. Amount and Reason come from the AI; the history figures are computed by the
/// backend from the user's own transactions (never taken from the model), so the card shows what the amount rests on.
/// </summary>
/// <param name="AverageSpent">Average monthly spending in the category over the last full months with data.</param>
/// <param name="HistoryMonths">How many full months that average covers (0–3).</param>
/// <param name="CurrentSpent">Spending in the category so far this month.</param>
/// <param name="BudgetId">Set once the budget has been created.</param>
public sealed record AIBudgetProposalItem(
    Guid? CategoryId = null,
    string? CategoryName = null,
    decimal? Amount = null,
    string? Reason = null,
    decimal? AverageSpent = null,
    int? HistoryMonths = null,
    decimal? CurrentSpent = null,
    Guid? BudgetId = null);

/// <summary>
/// The details of a proposed action, for every action type (each type uses only its own fields). The user can edit them
/// before confirming. Names keep what the AI said; ids are the matching records, or null when nothing matched yet.
/// </summary>
/// <param name="Type">create_transaction / create_category: "Expense" or "Income".</param>
/// <param name="Date">create_transaction: the day of the transaction.</param>
/// <param name="Name">create_account / create_category / create_savings_goal.</param>
/// <param name="AccountType">create_account: "Cash", "Bank" or "EWallet".</param>
/// <param name="InitialBalance">create_account: money already in the account (VND).</param>
/// <param name="AccountId">contribute_to_goal: null means the money is only recorded in the fund.</param>
/// <param name="Period">propose_budgets: the month, "yyyy-MM".</param>
/// <param name="Summary">propose_budgets: one sentence from the AI on what the proposal is based on.</param>
/// <param name="Budgets">propose_budgets: the proposed categories. On confirm, only the ones the user kept.</param>
/// <param name="SkippedCategories">propose_budgets: categories the AI named that already have a budget in the period.</param>
public sealed record AIActionPayload(
    string? Type = null,
    decimal? Amount = null,
    Guid? CategoryId = null,
    string? CategoryName = null,
    Guid? AccountId = null,
    string? AccountName = null,
    DateOnly? Date = null,
    string? Description = null,
    string? Name = null,
    DateOnly? StartDate = null,
    DateOnly? EndDate = null,
    byte? AlertThreshold = null,
    decimal? TargetAmount = null,
    DateOnly? Deadline = null,
    Guid? GoalId = null,
    string? GoalName = null,
    string? AccountType = null,
    decimal? InitialBalance = null,
    string? Period = null,
    string? Summary = null,
    IReadOnlyList<AIBudgetProposalItem>? Budgets = null,
    IReadOnlyList<string>? SkippedCategories = null);

/// <param name="ResultId">The record created when the user confirmed it.</param>
public sealed record AIActionResponse(
    Guid Id,
    string Type,
    AIActionStatus Status,
    AIActionPayload Payload,
    Guid? ResultId,
    DateTime CreatedAt,
    DateTime? ResolvedAt);

/// <param name="Payload">The details as edited by the user; null confirms what the AI proposed.</param>
public sealed record ConfirmAIActionRequest(AIActionPayload? Payload);
