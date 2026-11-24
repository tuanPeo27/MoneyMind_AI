namespace backend.Models;

public enum AccountType : byte
{
    Cash,
    Bank,
    EWallet
}

public enum CategoryType : byte
{
    Income,
    Expense
}

public enum TransactionType : byte
{
    Income,
    Expense
}

public enum TransactionSource : byte
{
    Manual,
    AIDraft
}

public enum FinancialGoalStatus : byte
{
    Active,
    Completed,
    Cancelled
}

public enum NotificationType : byte
{
    Info,
    Warning,
    Report
}

public enum NotificationSource : byte
{
    System,
    AI,
    Budget,
    Goal
}

public enum ChatMessageRole : byte
{
    User,
    Assistant,
    System
}

public enum AIInsightSeverity : byte
{
    Info,
    Warning,
    Critical
}

public enum AIRecommendationStatus : byte
{
    Pending,
    Accepted,
    Dismissed
}

public enum ReportPeriodType : byte
{
    Week,
    Month
}

public enum AIProcessingStatus : byte
{
    Pending,
    Completed,
    Failed
}

/// <summary>A change proposed by the AI assistant. Nothing is saved until the user confirms it.</summary>
public enum AIActionStatus : byte
{
    Pending,
    Confirmed,
    Cancelled
}
