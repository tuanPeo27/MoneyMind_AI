using backend.Models;

namespace backend.DTOs.Responses;

public sealed record AccountResponse(
    Guid Id,
    string Name,
    AccountType AccountType,
    decimal InitialBalance,
    decimal Balance,
    string Currency,
    bool IsArchived,
    DateTime CreatedAt,
    /// <summary>Total moved from this account into savings goals (already subtracted from Balance).</summary>
    decimal Contributed = 0m);

public sealed record CategoryResponse(
    Guid Id,
    string Name,
    CategoryType Type,
    string? Icon,
    string? Color,
    bool IsSystem,
    bool IsActive);

public sealed record TransactionResponse(
    Guid Id,
    Guid AccountId,
    string AccountName,
    Guid CategoryId,
    string CategoryName,
    decimal Amount,
    TransactionType Type,
    string? Description,
    DateTime TransactionDate,
    TransactionSource Source,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public sealed record CategorySuggestionResponse(
    Guid? LogId,
    Guid? CategoryId,
    string? CategoryName,
    decimal Confidence,
    string? Reason,
    string Method);

public sealed record BudgetResponse(
    Guid Id,
    Guid CategoryId,
    string CategoryName,
    decimal Amount,
    decimal Spent,
    decimal Remaining,
    decimal UsedPercent,
    DateOnly StartDate,
    DateOnly EndDate,
    byte AlertThreshold,
    bool IsOverThreshold,
    bool IsExceeded);

public sealed record FinancialGoalResponse(
    Guid Id,
    string Name,
    decimal TargetAmount,
    decimal CurrentAmount,
    decimal ProgressPercent,
    DateOnly? Deadline,
    FinancialGoalStatus Status,
    byte? ReminderDay = null);

public sealed record NotificationResponse(
    Guid Id,
    NotificationType Type,
    NotificationSource Source,
    string Title,
    string Message,
    string? RelatedType,
    Guid? RelatedId,
    bool IsRead,
    DateTime CreatedAt);

public sealed record UnreadCountResponse(int Count);
