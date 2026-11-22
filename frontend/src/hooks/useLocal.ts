import { useEffect, useState } from 'react';

export function useLocal<T>(key: string, initial: T | (() => T)) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) return JSON.parse(saved);
    } catch {}
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });
  const [error, setError] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      setError(false);
    } catch { setError(true); }
  }, [key, value]);
  return [value, setValue, error] as const;
}
