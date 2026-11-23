import { useCallback, useEffect, useState } from 'react';
import { goalsApi, type FinancialGoalResponse, type FinancialGoalStatus, type UpsertGoalRequest } from '../services';

/** The signed-in user's savings funds (financial goals) from /api/financial-goals. */
export function useSavingsGoals(userId: string | undefined) {
  const [goals, setGoals] = useState<FinancialGoalResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const reload = useCallback(async () => {
    if (!userId) return;
    try {
      setGoals(await goalsApi.listGoals());
      setError(null);
    } catch (e) { setError(e); }
  }, [userId]);

  useEffect(() => {
    setGoals([]); setError(null);
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    goalsApi.listGoals()
      .then(items => { if (!cancelled) setGoals(items); })
      .catch(e => { if (!cancelled) setError(e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId]);

  // The server orders goals (deadline, then name) and may complete one, so each change reloads the list.
  const create = useCallback(async (request: UpsertGoalRequest) => { await goalsApi.createGoal(request); await reload(); }, [reload]);
  const update = useCallback(async (id: string, request: UpsertGoalRequest) => { await goalsApi.updateGoal(id, request); await reload(); }, [reload]);
  const setStatus = useCallback(async (id: string, status: FinancialGoalStatus) => { await goalsApi.setGoalStatus(id, status); await reload(); }, [reload]);
  const remove = useCallback(async (id: string) => { await goalsApi.deleteGoal(id); await reload(); }, [reload]);
  const contribute = useCallback(async (id: string, amount: number, accountId?: string | null) => {
    const goal = await goalsApi.contributeToGoal(id, amount, accountId);
    await reload();
    return goal;
  }, [reload]);

  return { goals, loading, error, reload, create, update, setStatus, remove, contribute };
}
