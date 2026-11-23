import { useCallback, useEffect, useState } from 'react';
import type { Page } from './data';

export const pagePaths: Record<Page, string> = {
  Overview: '/',
  Accounts: '/accounts',
  Transactions: '/transactions',
  Budgets: '/budgets',
  Categories: '/categories',
  Reports: '/reports',
  'AI Financial Assistant': '/assistant',
  'Smart Insights': '/insights',
  Settings: '/settings',
  Workspace: '/workspace',
  Notifications: '/notifications',
};
export type DemoRole = 'USER' | 'ADMIN';
export function useRoute() {
  const [path, setPath] = useState(window.location.pathname.replace(/\/$/, '') || '/');
  useEffect(() => {
    const update = () => setPath(window.location.pathname.replace(/\/$/, '') || '/');
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  const navigate = useCallback((next: string, replace = false) => {
    if (replace) window.history.replaceState({}, '', next);
    else if (next !== window.location.pathname) window.history.pushState({}, '', next);
    setPath(next);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);
  const page = (Object.entries(pagePaths).find(([, value]) => value === path)?.[0] || 'Overview') as Page;
  return { path, page, navigate };
}
