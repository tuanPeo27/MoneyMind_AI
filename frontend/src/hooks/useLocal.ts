import { useCallback, useEffect, useState, type SetStateAction } from 'react';

function read<T>(key: string, initial: T | (() => T)): T {
  try {
    const saved = localStorage.getItem(key);
    if (saved) return JSON.parse(saved);
  } catch {}
  return typeof initial === 'function' ? (initial as () => T)() : initial;
}

/**
 * State persisted in localStorage under `key`. When `key` changes (e.g. it contains the signed-in user's id),
 * the value is re-read for the new key, so one account never sees or overwrites another account's data.
 */
export function useLocal<T>(key: string, initial: T | (() => T)) {
  const [state, setState] = useState(() => ({ key, value: read(key, initial) }));
  // Derived-state reset during render (React's documented pattern), so no frame shows the old key's value.
  let current = state;
  if (state.key !== key) { current = { key, value: read(key, initial) }; setState(current); }
  const [error, setError] = useState(false);
  useEffect(() => {
    if (state.key !== key) return; // wait for the reset above; never write the old value under the new key
    try {
      localStorage.setItem(key, JSON.stringify(state.value));
      setError(false);
    } catch { setError(true); }
  }, [key, state]);
  const setValue = useCallback((next: SetStateAction<T>) => setState(old => ({
    key: old.key,
    value: typeof next === 'function' ? (next as (value: T) => T)(old.value) : next,
  })), []);
  return [current.value, setValue, error] as const;
}
