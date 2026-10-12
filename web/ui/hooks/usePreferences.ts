import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { platform } from '../services/platform';

/** Hydration must finish before writes, and never overwrite an intervening user choice. */
export function usePreference<T>(
  key: string,
  fallback: T,
  validate: (value: unknown) => value is T,
) {
  const parse = (stored: string | null) => {
    try {
      const value: unknown = JSON.parse(stored ?? 'null');
      return validate(value) ? value : fallback;
    } catch {
      return fallback;
    }
  };
  const [value, setValue] = useState<T>(() => parse(platform().preferences.peek(key)));
  const [persistent, setPersistent] = useState(true);
  const changed = useRef(false);
  const latest = useRef(value);
  latest.current = value;
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void platform()
      .preferences.get(key)
      .then((stored) => {
        if (!cancelled && !changed.current) setValue(parse(stored));
      })
      .catch(() => {
        if (!cancelled) setPersistent(false);
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
    // Call sites use fixed keys and validators; hydration is one read per preference.
  }, [key]);
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void platform()
      .preferences.set(key, JSON.stringify(value))
      .then(() => {
        if (!cancelled) setPersistent(true);
      })
      .catch(() => {
        if (!cancelled) setPersistent(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key, value, hydrated]);
  const change = useCallback((next: SetStateAction<T>) => {
    changed.current = true;
    const updated =
      typeof next === 'function' ? (next as (value: T) => T)(latest.current) : next;
    latest.current = updated;
    setValue(updated);
  }, []);
  return [value, change, persistent] as const;
}
