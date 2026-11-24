using System.ComponentModel.DataAnnotations;
using backend.Models;

namespace backend.DTOs.Requests;

public sealed record CreateAccountRequest(
    [property: Required]
    [property: StringLength(100)]
    string Name,
    AccountType AccountType,
    decimal InitialBalance,
    [property: StringLength(3, MinimumLength = 3)]
    string Currency = "VND");

public sealed record UpdateAccountRequest(
    [property: Required]
    [property: StringLength(100)]
    string Name,
    AccountType AccountType,
    bool IsArchived);

public sealed record UpsertCategoryRequest(
    [property: Required]
    [property: StringLength(100)]
    string Name,
    CategoryType Type,
    [property: StringLength(50)]
    string? Icon,
    [property: StringLength(50)]
    string? Color,
    bool IsActive = true);

public sealed record UpsertTransactionRequest(
    Guid AccountId,
    Guid CategoryId,
    [property: Range(typeof(decimal), "0.0001", "999999999999999")] decimal Amount,
    TransactionType Type,
    [property: StringLength(500)] string? Description,
    DateTime TransactionDate,
    TransactionSource Source = TransactionSource.Manual);

public sealed class TransactionQuery : PagingQuery
{
    public DateTime? From { get; set; }
    public DateTime? To { get; set; }
    public Guid? AccountId { get; set; }
    public Guid? CategoryId { get; set; }
    public TransactionType? Type { get; set; }
    public string? Search { get; set; }
}

public sealed record SuggestCategoryRequest(
    [property: Required]
    [property: StringLength(500)]
    string Description,
    TransactionType Type = TransactionType.Expense,
    decimal? Amount = null);

public sealed record ConfirmCategorySuggestionRequest(Guid FinalCategoryId);

public sealed record UpsertBudgetRequest(
    Guid CategoryId,
    [property: Range(typeof(decimal), "0.0001", "999999999999999")] decimal Amount,
    DateOnly StartDate,
    DateOnly EndDate,
    [property: Range(1, 100)] byte AlertThreshold = 80);

/// <param name="ReminderDay">Day of the month (1-31) for a contribution reminder; null turns it off.</param>
public sealed record UpsertGoalRequest(
    [property: Required]
    [property: StringLength(150)]
    string Name,
    [property: Range(typeof(decimal), "0.0001", "999999999999999")] decimal TargetAmount,
    DateOnly? Deadline,
    [property: Range(1, 31)] byte? ReminderDay = null);

/// <param name="AccountId">Account the money is taken from (its balance goes down). null = only record it in the goal.</param>
public sealed record GoalContributionRequest(
    [property: Range(typeof(decimal), "0.0001", "999999999999999")] decimal Amount,
    Guid? AccountId = null);

public sealed record UpdateGoalStatusRequest(FinancialGoalStatus Status);

public sealed class NotificationQuery : PagingQuery
{
    public bool UnreadOnly { get; set; }
}
