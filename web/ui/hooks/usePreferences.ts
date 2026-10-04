import { useEffect, useState } from 'react';

/** Storage can be unavailable in private/embedded browsers; the UI still works. */
export function usePreference<T>(
  key: string,
  fallback: T,
  validate: (value: unknown) => value is T,
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
      return validate(stored) ? stored : fallback;
    } catch {
      return fallback;
    }
  });
  const [persistent, setPersistent] = useState(true);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      setPersistent(true);
    } catch {
      setPersistent(false);
    }
  }, [key, value]);
  return [value, setValue, persistent] as const;
}
