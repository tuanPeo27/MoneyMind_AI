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
export type UpsertGoalRequest = { name: string; targetAmount: number; deadline?: string | null };
/** The backend clears the avatar when `avatarUrl` is empty, so always send the current one. */
export type AIConversationResponse = {
  id: string; title: string; createdAt: string; updatedAt: string; isArchived: boolean;
};
export type AIChatMessageResponse = {
  id: string; conversationId: string; sequence: number; role: 'User' | 'Assistant' | 'System';
  content: string; intent?: string | null; status: 'Pending' | 'Completed' | 'Failed'; createdAt: string;
};
export type SendAIChatMessageResponse = {
  conversationId: string; userMessage: AIChatMessageResponse; assistantMessage: AIChatMessageResponse;
};

export type UpdateProfileRequest = { fullName: string; phoneNumber?: string | null; avatarUrl?: string | null };
export type ChangePasswordRequest = { currentPassword: string; newPassword: string };

export type TransactionQuery = {
  page?: number; pageSize?: number; from?: string; to?: string;
  accountId?: string; categoryId?: string; type?: TransactionType; search?: string;
};
export type NotificationQuery = { page?: number; pageSize?: number; unreadOnly?: boolean };

// --- Admin: users (AdminUsersController / IAdminUserService) ---
export type AdminUserResponse = {
  id: string; fullName: string; email: string; avatarUrl?: string | null; isActive: boolean;
  lockedAt?: string | null; lockedReason?: string | null; lastLoginAt?: string | null; createdAt: string; roles: string[];
};
/** `search` matches full name or email. `isActive` false = locked accounts. */
export type AdminUserQuery = { page?: number; pageSize?: number; search?: string; isActive?: boolean };