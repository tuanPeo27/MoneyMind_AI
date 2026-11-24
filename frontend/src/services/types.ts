// Mirrors backend DTOs. Enums are serialized as strings (JsonStringEnumConverter); fields are camelCase.

export type AccountType = 'Cash' | 'Bank' | 'EWallet';
export type CategoryType = 'Income' | 'Expense';
export type TransactionType = 'Income' | 'Expense';
export type TransactionSource = 'Manual' | 'AIDraft';
export type FinancialGoalStatus = 'Active' | 'Completed' | 'Cancelled';
export type NotificationType = 'Info' | 'Warning' | 'Report';
export type NotificationSource = 'System' | 'AI' | 'Budget' | 'Goal';
export type ReportPeriodType = 'Week' | 'Month';

export type PagedResult<T> = { items: T[]; page: number; pageSize: number; totalCount: number; totalPages: number };
export type MessageResponse = { message: string };

// --- Auth / user ---
export type UserResponse = {
  id: string; fullName: string; email: string; phoneNumber?: string | null;
  roles: string[]; createdAt: string; lastLoginAt?: string | null; avatarUrl?: string | null;
  timeZoneId: string;
  /** False for accounts that sign in with Google only: they have no password to change or reset. */
  hasPassword: boolean;
};
export type AuthResponse = { accessToken: string; refreshToken: string; accessTokenExpiresAt: string; user: UserResponse };
export type SessionResponse = { id: string; deviceInfo?: string | null; ipAddress?: string | null; createdAt: string; expiresAt: string };

// --- Finance ---
export type AccountResponse = {
  id: string; name: string; accountType: AccountType; initialBalance: number; balance: number;
  currency: string; isArchived: boolean; createdAt: string;
  /** Moved from this account into savings funds; already subtracted from `balance`. */
  contributed?: number;
};
export type CategoryResponse = {
  id: string; name: string; type: CategoryType; icon?: string | null; color?: string | null;
  isSystem: boolean; isActive: boolean;
};
export type TransactionResponse = {
  id: string; accountId: string; accountName: string; categoryId: string; categoryName: string;
  amount: number; type: TransactionType; description?: string | null; transactionDate: string;
  source: TransactionSource; createdAt: string; updatedAt: string;
};
export type BudgetResponse = {
  id: string; categoryId: string; categoryName: string; amount: number; spent: number; remaining: number;
  usedPercent: number; startDate: string; endDate: string; alertThreshold: number;
  isOverThreshold: boolean; isExceeded: boolean;
};
export type FinancialGoalResponse = {
  id: string; name: string; targetAmount: number; currentAmount: number; progressPercent: number;
  deadline?: string | null; status: FinancialGoalStatus;
  /** Day of the month (1-31) for the contribution reminder; null = none. */
  reminderDay?: number | null;
};
export type NotificationResponse = {
  id: string; type: NotificationType; source: NotificationSource; title: string; message: string;
  relatedType?: string | null; relatedId?: string | null; isRead: boolean; createdAt: string;
};
export type UnreadCountResponse = { count: number };
export type CategorySuggestionResponse = {
  logId?: string | null; categoryId?: string | null; categoryName?: string | null;
  confidence: number; reason?: string | null; method: string;
};

// --- Dashboard ---
export type DashboardOverviewResponse = {
  from: string; to: string; totalBalance: number; totalIncome: number; totalExpense: number; netSavings: number;
  recentTransactions: TransactionResponse[]; budgets: BudgetResponse[]; goals: FinancialGoalResponse[];
  unreadNotifications: number;
};
export type CategoryBreakdownItem = { categoryId: string; categoryName: string; amount: number; percent: number };
export type TrendPoint = { date: string; income: number; expense: number };
export type ReportResponse = {
  from: string; to: string; totalIncome: number; totalExpense: number; netSavings: number; transactionCount: number;
  expenseByCategory: CategoryBreakdownItem[]; incomeByCategory: CategoryBreakdownItem[]; trend: TrendPoint[];
};
export type ReportSnapshotResponse = {
  id: string; periodType: ReportPeriodType; periodStart: string; periodEnd: string; data: ReportResponse; createdAt: string;
};

// --- Request payloads ---
export type UpsertTransactionRequest = {
  accountId: string; categoryId: string; amount: number; type: TransactionType;
  description?: string | null; transactionDate: string; source?: TransactionSource;
};
export type UpsertCategoryRequest = { name: string; type: CategoryType; icon?: string | null; color?: string | null; isActive?: boolean };
export type CreateAccountRequest = { name: string; accountType: AccountType; initialBalance: number; currency?: string };
export type UpdateAccountRequest = { name: string; accountType: AccountType; isArchived: boolean };
export type UpsertBudgetRequest = { categoryId: string; amount: number; startDate: string; endDate: string; alertThreshold?: number };
export type UpsertGoalRequest = { name: string; targetAmount: number; deadline?: string | null; reminderDay?: number | null };
/** The backend clears the avatar when `avatarUrl` is empty, so always send the current one. */
export type AIConversationResponse = {
  id: string; title: string; createdAt: string; updatedAt: string; isArchived: boolean;
};
export type AIActionType = 'create_transaction' | 'create_category' | 'create_budget' | 'create_savings_goal' | 'contribute_to_goal';
export type AIActionStatus = 'Pending' | 'Confirmed' | 'Cancelled';
/**
 * Details of a change the AI proposed. Each type uses only its own fields. Names are what the AI said; ids are the
 * matching records, or null when nothing matched (the user then picks one before confirming). Amounts are in VND.
 */
export type AIActionPayload = {
  type?: 'Expense' | 'Income' | null; amount?: number | null;
  categoryId?: string | null; categoryName?: string | null; accountId?: string | null; accountName?: string | null;
  date?: string | null; description?: string | null; name?: string | null;
  startDate?: string | null; endDate?: string | null; alertThreshold?: number | null;
  targetAmount?: number | null; deadline?: string | null; goalId?: string | null; goalName?: string | null;
};
export type AIActionResponse = {
  id: string; type: AIActionType; status: AIActionStatus; payload: AIActionPayload;
  resultId?: string | null; createdAt: string; resolvedAt?: string | null;
};
export type AIChatMessageResponse = {
  id: string; conversationId: string; sequence: number; role: 'User' | 'Assistant' | 'System';
  content: string; intent?: string | null; status: 'Pending' | 'Completed' | 'Failed'; createdAt: string;
  /** Changes this reply proposed; empty for most messages. */
  actions?: AIActionResponse[];
};
/** `dailyLimit` and `remaining` are null when the user has no limit. `resetsAt` is the user's next local midnight (UTC). */
export type AIUsageResponse = { isUnlimited: boolean; dailyLimit: number | null; used: number; remaining: number | null; resetsAt: string };
export type InsightSeverity = 'info' | 'warning' | 'critical';
export type WeeklyRecommendation = {
  id: string; recommendationType: string; title: string; description: string; dataJson?: string | null;
  status: 'Pending' | 'Accepted' | 'Dismissed'; createdAt: string; expiresAt?: string | null;
};
/** Weekly summary of the last complete week. `writtenByAI` is false when only the numbers could be listed. */
export type WeeklySummaryResponse = {
  id: string; weekStart: string; weekEnd: string; title: string; summary: string;
  severity: 'Info' | 'Warning' | 'Critical';
  items: { title: string; content: string; severity: InsightSeverity }[];
  recommendations: WeeklyRecommendation[]; writtenByAI: boolean; isRead: boolean; createdAt: string;
};
export type AcceptRecommendationResponse = { recommendation: WeeklyRecommendation; action?: AIActionResponse | null };
export type SendAIChatMessageResponse = {
  conversationId: string; userMessage: AIChatMessageResponse; assistantMessage: AIChatMessageResponse; usage: AIUsageResponse;
};

export type UpdateProfileRequest = { fullName: string; phoneNumber?: string | null; avatarUrl?: string | null };
export type ChangePasswordRequest = { currentPassword: string; newPassword: string };

export type TransactionQuery = {
  page?: number; pageSize?: number; from?: string; to?: string;
  accountId?: string; categoryId?: string; type?: TransactionType; search?: string;
};
export type NotificationQuery = { page?: number; pageSize?: number; unreadOnly?: boolean };

// --- Admin: users (AdminUsersController / IAdminUserService) ---
/** -1 means unlimited. */
export const AI_UNLIMITED = -1;
/**
 * `customLimit` is what an admin set (null = follows the system default); `effectiveLimit` applies today
 * (null = unlimited). `usedToday` counts answered chat messages since the user's local midnight.
 */
export type AdminAIQuota = { customLimit: number | null; effectiveLimit: number | null; isUnlimited: boolean; usedToday: number };
export type AIQuotaSettingsResponse = { defaultDailyLimit: number; options: number[] };
export type AdminUserResponse = {
  id: string; fullName: string; email: string; avatarUrl?: string | null; isActive: boolean;
  lockedAt?: string | null; lockedReason?: string | null; lastLoginAt?: string | null; createdAt: string; roles: string[];
  aiQuota: AdminAIQuota;
};
/** `search` matches full name or email. `isActive` false = locked accounts. */
export type AdminUserQuery = { page?: number; pageSize?: number; search?: string; isActive?: boolean };
// --- Admin: transaction statistics (AdminTransactionsController). Aggregates only, no individual data. ---
export type AdminDailyTransactionStat = { date: string; count: number; income: number; expense: number };
/** `categoryName` null = merged bucket (user-created categories and those used by fewer than `minGroupSize` people). */
export type AdminCategoryTransactionStat = { categoryName: string | null; type: TransactionType; count: number; amount: number };
export type AdminTransactionStatsResponse = {
  from: string; to: string; transactionCount: number; activeUsers: number; totalIncome: number; totalExpense: number;
  minGroupSize: number; daily: AdminDailyTransactionStat[]; categories: AdminCategoryTransactionStat[];
  sources: { source: TransactionSource; count: number }[];
};