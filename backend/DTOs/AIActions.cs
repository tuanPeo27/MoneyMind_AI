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

    public const int MaxPerMessage = 5;

    public static readonly IReadOnlySet<string> All = new HashSet<string>
    {
        CreateTransaction, CreateAccount, CreateCategory, CreateBudget, CreateSavingsGoal, ContributeToGoal
    };
}

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
    decimal? InitialBalance = null);

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
