import { useEffect, useState } from 'react';
import type { ServiceHistoryResponse } from '../../../../shared/service/contracts';

export interface ServiceHistoryState {
  history: ServiceHistoryResponse | null;
  failed: boolean;
}

/** One-shot history fetch for the sparkline (story 5.4): per-bucket touches
 * and gaps for the selected stop's directions, over the 36-hour window. */
export function useServiceHistory(
  enabled: boolean,
  stopId: string | null,
): ServiceHistoryState {
  const [history, setHistory] = useState<ServiceHistoryResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled || !stopId) {
      setHistory(null);
      setFailed(false);
      return;
    }
    let stopped = false;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `/api/v1/service/history?stop=${encodeURIComponent(stopId)}`,
          {
            signal: controller.signal,
            cache: 'no-store',
            credentials: 'omit',
          },
        );
        if (!response.ok) throw new Error(`history HTTP ${response.status}`);
        const payload = (await response.json()) as ServiceHistoryResponse;
        if (!stopped) {
          setHistory(payload);
          setFailed(false);
        }
      } catch {
        if (!stopped) {
          setHistory(null);
          setFailed(true);
        }
      }
    })();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [enabled, stopId]);
  return { history, failed };
}
