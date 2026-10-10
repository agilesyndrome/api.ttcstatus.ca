import { useEffect, useRef, useState } from 'react';
import type { StopServiceState } from '../../../../shared/service/contracts';

export interface ServiceFeedState {
  loading: boolean;
  failed: boolean;
  /** The payload's tick watermark (epoch ms). */
  at: number | null;
  updateSeconds: number;
  states: StopServiceState[];
}

const DEFAULT_SECONDS = 30;

/** One service feed owner per page (the useVehicleFeed rule): polls
 * /api/v1/service/stops at the advertised X-Live cadence, sends If-None-Match
 * with the retained ETag, and pauses when the tab is hidden. Disabled means
 * disabled: no requests are made at all (the overlay gate, sla.md §4.7). */
export function useServiceFeed(enabled: boolean): ServiceFeedState {
  const [state, setState] = useState<ServiceFeedState>({
    loading: enabled,
    failed: false,
    at: null,
    updateSeconds: DEFAULT_SECONDS,
    states: [],
  });
  const etag = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) {
      etag.current = null;
      setState({
        loading: false,
        failed: false,
        at: null,
        updateSeconds: DEFAULT_SECONDS,
        states: [],
      });
      return;
    }
    let stopped = false;
    let timer: number | undefined;
    const controller = new AbortController();
    let backoffSeconds = DEFAULT_SECONDS;
    const schedule = (milliseconds: number) => {
      if (!stopped) timer = window.setTimeout(pull, milliseconds);
    };
    const pull = async () => {
      if (document.visibilityState === 'hidden') {
        schedule(5_000);
        return;
      }
      try {
        const headers = new Headers();
        if (etag.current) headers.set('if-none-match', etag.current);
        const response = await fetch('/api/v1/service/stops', {
          headers,
          signal: controller.signal,
          cache: 'no-store',
          credentials: 'omit',
        });
        if (response.status === 304) {
          backoffSeconds = DEFAULT_SECONDS;
          setState((current) => ({ ...current, loading: false, failed: false }));
          schedule(DEFAULT_SECONDS * 1000);
          return;
        }
        if (!response.ok) throw new Error(`service feed HTTP ${response.status}`);
        const nextEtag = response.headers.get('etag');
        if (nextEtag) etag.current = nextEtag;
        const updateSeconds =
          Number(response.headers.get('x-live-update-seconds')) || DEFAULT_SECONDS;
        const payload = (await response.json()) as {
          at?: number;
          states?: StopServiceState[];
        };
        backoffSeconds = DEFAULT_SECONDS;
        if (!stopped) {
          setState({
            loading: false,
            failed: false,
            at: payload.at ?? null,
            updateSeconds,
            states: Array.isArray(payload.states) ? payload.states : [],
          });
        }
        schedule(updateSeconds * 1000);
      } catch (error) {
        if (stopped || controller.signal.aborted) return;
        setState((current) => ({ ...current, loading: false, failed: true }));
        schedule(Math.min(300_000, backoffSeconds) * 1000);
        backoffSeconds = Math.min(300_000, backoffSeconds * 2);
      }
    };
    void pull();
    return () => {
      stopped = true;
      controller.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [enabled]);
  return state;
}
