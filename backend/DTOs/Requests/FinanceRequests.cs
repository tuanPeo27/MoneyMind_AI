using System.ComponentModel.DataAnnotations;
using backend.Models;

namespace backend.DTOs.Requests;

public sealed record CreateAccountRequest(
    [Required]
    [StringLength(100)]
    string Name,
    AccountType AccountType,
    decimal InitialBalance,
    [StringLength(3, MinimumLength = 3)]
    string Currency = "VND");

public sealed record UpdateAccountRequest(
    [Required]
    [StringLength(100)]
    string Name,
    AccountType AccountType,
    bool IsArchived);

public sealed record UpsertCategoryRequest(
    [Required]
    [StringLength(100)]
    string Name,
    CategoryType Type,
    [StringLength(50)]
    string? Icon,
    [StringLength(50)]
    string? Color,
    bool IsActive = true);

public sealed record UpsertTransactionRequest(
    Guid AccountId,
    Guid CategoryId,
    [Range(typeof(decimal), "0.0001", "999999999999999")] decimal Amount,
    TransactionType Type,
    [StringLength(500)] string? Description,
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
    [Required]
    [StringLength(500)]
    string Description,
    TransactionType Type = TransactionType.Expense,
    decimal? Amount = null);

public sealed record ConfirmCategorySuggestionRequest(Guid FinalCategoryId);

public sealed record UpsertBudgetRequest(
    Guid CategoryId,
    [Range(typeof(decimal), "0.0001", "999999999999999")] decimal Amount,
    DateOnly StartDate,
    DateOnly EndDate,
    [Range(1, 100)] byte AlertThreshold = 80);

/// <summary>Several monthly budgets created together: all of them, or none if any one is invalid.</summary>
/// <param name="Period">The month, "yyyy-MM" (e.g. "2026-11"): the current month or one of the next 12.</param>
public sealed record BulkCreateBudgetsRequest(
    [Required, RegularExpression(@"^\d{4}-(0[1-9]|1[0-2])$", ErrorMessage = "Kỳ ngân sách phải có dạng yyyy-MM.")] string Period,
    [Required, MinLength(1, ErrorMessage = "Hãy chọn ít nhất một danh mục."), MaxLength(BulkCreateBudgetsRequest.MaxItems)]
    IReadOnlyList<BulkBudgetItem> Budgets)
{
    public const int MaxItems = 20;
}

public sealed record BulkBudgetItem(
    Guid CategoryId,
    [Range(typeof(decimal), "0.0001", "999999999999999")] decimal LimitAmount,
    [Range(1, 100)] byte AlertThreshold = 80);

/// <param name="ReminderDay">Day of the month (1-31) for a contribution reminder; null turns it off.</param>
public sealed record UpsertGoalRequest(
    [Required]
    [StringLength(150)]
    string Name,
    [Range(typeof(decimal), "0.0001", "999999999999999")] decimal TargetAmount,
    DateOnly? Deadline,
    [Range(1, 31)] byte? ReminderDay = null);

/// <param name="AccountId">Account the money is taken from (its balance goes down). null = only record it in the goal.</param>
public sealed record GoalContributionRequest(
    [Range(typeof(decimal), "0.0001", "999999999999999")] decimal Amount,
    Guid? AccountId = null);

public sealed record UpdateGoalStatusRequest(FinancialGoalStatus Status);

public sealed class NotificationQuery : PagingQuery
{
    public bool UnreadOnly { get; set; }
}
