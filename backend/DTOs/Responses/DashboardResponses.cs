using backend.Models;

namespace backend.DTOs.Responses;

public sealed record DashboardOverviewResponse(
    DateTime From,
    DateTime To,
    decimal TotalBalance,
    decimal TotalIncome,
    decimal TotalExpense,
    decimal NetSavings,
    IReadOnlyList<TransactionResponse> RecentTransactions,
    IReadOnlyList<BudgetResponse> Budgets,
    IReadOnlyList<FinancialGoalResponse> Goals,
    int UnreadNotifications);

public sealed record CategoryBreakdownItem(
    Guid CategoryId,
    string CategoryName,
    decimal Amount,
    decimal Percent);

public sealed record TrendPoint(DateTime Date, decimal Income, decimal Expense);

public sealed record ReportResponse(
    DateTime From,
    DateTime To,
    decimal TotalIncome,
    decimal TotalExpense,
    decimal NetSavings,
    int TransactionCount,
    IReadOnlyList<CategoryBreakdownItem> ExpenseByCategory,
    IReadOnlyList<CategoryBreakdownItem> IncomeByCategory,
    IReadOnlyList<TrendPoint> Trend);

public sealed record ReportSnapshotResponse(
    Guid Id,
    ReportPeriodType PeriodType,
    DateOnly PeriodStart,
    DateOnly PeriodEnd,
    ReportResponse Data,
    DateTime CreatedAt);
