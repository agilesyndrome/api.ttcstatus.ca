import { useActivity } from '../../services/platform/react';
import { overlayLaunch } from '../../services/http/live-transport';
import { useEffect, useRef, useState } from 'react';
import { requestStopsTickUpdate } from '../../../../shared/live/polling';
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

/** One service feed owner per page (the useVehicleFeed rule), repointed to
 * the public live tick path (docs/optimize-overlay.md E2S1): every poll
 * derives its tick URL from the launch-time config — no Worker service
 * endpoint, no session, no 5xx parsing. The overlay is broadcast data for
 * every visitor (E2S2): no account state participates — signed-out users
 * see the same field from the same CDN bytes. Disabled means disabled: no
 * requests are made at all. Pauses when the tab is hidden or offline;
 * returning to an overdue view refreshes immediately. */
export function useServiceFeed(enabled: boolean): ServiceFeedState {
  const activity = useActivity();
  const eligible = enabled && activity.active && activity.online;
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
    if (!eligible) return;
    let stopped = false;
    let timer: number | undefined;
    const controller = new AbortController();
    let backoffSeconds = DEFAULT_SECONDS;
    const schedule = (milliseconds: number) => {
      if (!stopped) timer = window.setTimeout(pull, milliseconds);
    };
    const pull = async () => {
      try {
        // Config is the only origin source (same doctrine as the fleet
        // path): a failed config fetch is a retry-able failure, never a
        // fallback URL. One fetch per launch, shared with the fleet.
        const launch = await overlayLaunch();
        const update = await requestStopsTickUpdate(
          launch.transport,
          controller.signal,
          etag.current ?? undefined,
        );
        if (stopped) return;
        backoffSeconds = update.updateSeconds;
        if (update.unpublished) {
          // The clock is ahead of publish: the last-good states stand with
          // their age and the next scheduled poll retries — never a failure.
          setState((current) => ({ ...current, loading: false, failed: false }));
          schedule(update.updateSeconds * 1000);
          return;
        }
        if (update.states) {
          // A full document (an outage doc's `states: []` included — the
          // honest unavailable state, never a fabricated void and never a
          // failure banner). Its ETag is only retained with its states.
          etag.current = update.etag ?? null;
          setState({
            loading: false,
            failed: false,
            at: update.at ?? null,
            updateSeconds: update.updateSeconds,
            states: update.states,
          });
        } else {
          // 304: identical same-tick refetch — the current states stand.
          setState((current) => ({ ...current, loading: false, failed: false }));
        }
        schedule(update.updateSeconds * 1000);
      } catch (error) {
        if (stopped || controller.signal.aborted) return;
        setState((current) => ({ ...current, loading: false, failed: true }));
        schedule(Math.min(300, backoffSeconds) * 1000);
        backoffSeconds = Math.min(300, backoffSeconds * 2);
      }
    };
    void pull();
    return () => {
      stopped = true;
      controller.abort();
      if (timer) window.clearTimeout(timer);
    };
    // Eligibility flips (visibility, connectivity) restart the loop; an
    // overdue return refreshes immediately through the initial pull.
  }, [enabled, eligible]);
  return state;
}
