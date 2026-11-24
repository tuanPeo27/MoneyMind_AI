export { ApiError, http } from './client';
export { getSession, setSession, patchSessionUser, useSession } from './session';
export type { AuthSession, AuthUser } from './session';
export * from './types';

export * as authApi from './auth';
export * as usersApi from './users';
export * as categoriesApi from './categories';
export * as accountsApi from './accounts';
export * as transactionsApi from './transactions';
export * as budgetsApi from './budgets';
export * as goalsApi from './goals';
export * as dashboardApi from './dashboard';
export * as notificationsApi from './notifications';
export * as aiChatApi from './aiChat';
export * as insightsApi from './insights';
export * as adminUsersApi from './adminUsers';

export * as adminTransactionsApi from './adminTransactions';
export * as adminCategoriesApi from './adminCategories';