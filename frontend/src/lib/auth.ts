// Auth now lives in ../services. This file re-exports the same API so existing imports keep working.
export { ApiError } from '../services/client';
export { getSession, setSession, useSession } from '../services/session';
export type { AuthSession, AuthUser } from '../services/session';
export { login, loginWithGoogle, register, logout, forgotPassword, resetPassword } from '../services/auth';
