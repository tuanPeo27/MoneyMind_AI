/**
 * Window event fired after something outside the current page changed the user's data (an AI action was confirmed,
 * for example), so the app reloads transactions, budgets, funds and notifications.
 * Kept in its own module: importing it must not pull the AI action card (and its form fields) into the first bundle.
 */
export const FINANCE_CHANGED_EVENT = 'mm-finance-changed';
