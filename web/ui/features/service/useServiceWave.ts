import { useCallback, useEffect, useState } from 'react';
import type { ServiceWaveResponse } from '../../../../shared/service/contracts';

export interface ServiceWaveState {
  wave: ServiceWaveResponse | null;
  failed: boolean;
  refresh: () => void;
}

/** One-shot wave fetch for the replay panel (story 5.3): a single request
 * reconstructs the full 30-minute space-time plot; refresh is manual. */
export function useServiceWave(enabled: boolean): ServiceWaveState {
  const [wave, setWave] = useState<ServiceWaveResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (!enabled) {
      setWave(null);
      setFailed(false);
      return;
    }
    let stopped = false;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/v1/service/wave', {
          signal: controller.signal,
          cache: 'no-store',
          credentials: 'omit',
        });
        if (!response.ok) throw new Error(`wave HTTP ${response.status}`);
        const payload = (await response.json()) as ServiceWaveResponse;
        if (!stopped) {
          setWave(payload);
          setFailed(false);
        }
      } catch {
        if (!stopped) {
          setWave(null);
          setFailed(true);
        }
      }
    })();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [enabled, attempt]);
  return { wave, failed, refresh };
}
