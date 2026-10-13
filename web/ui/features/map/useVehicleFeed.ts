import { useActivity } from '../../services/platform/react';
import { liveTransport } from '../../services/http/live-transport';
import { useEffect, useRef, useState } from 'react';
import { requestTickUpdate, VehiclePoller } from '../../../../shared/live/polling';
import { DEFAULT_LIVE_UPDATE_SECONDS } from '../../../../shared/live/config';
import type { FeedState } from './LiveFeedStatus';

/** One feed owner per page. Filters and legend never create their own requests.
 * The poller is repointed to the public live path (docs/optimize-transport.md
 * Epic 2): every request derives its tick URL from the launch-time config —
 * no Worker vehicle endpoint, no fallback host, no 5xx parsing. A failed
 * config fetch retries on the next activation, never a fallback URL. */
export function useVehicleFeed(
  enabled: boolean,
  options: { polling?: boolean } = {},
): FeedState {
  const activity = useActivity();
  const polling = options.polling ?? true;
  const [state, setState] = useState<FeedState>({
    failed: false,
    active: false,
    awaitingConfig: true,
    updateSeconds: DEFAULT_LIVE_UPDATE_SECONDS,
    retrySeconds: 0,
    now: Date.now(),
  });
  const poller = useRef<VehiclePoller | undefined>(undefined);
  const singleShotRequested = useRef(false);
  useEffect(() => {
    const instance = new VehiclePoller({
      // Config is the only origin source: no transport proceeds without it.
      // Cadence, host, and path template all come from the fetched block.
      request: (signal, etag) =>
        liveTransport().then((transport) => requestTickUpdate(transport, signal, etag)),
      onSnapshot: (snapshot) =>
        setState((current) => {
          const timestamp = Date.parse(snapshot.feedTimestamp ?? snapshot.fetchedAt);
          const previous =
            current.snapshot &&
            Date.parse(current.snapshot.feedTimestamp ?? current.snapshot.fetchedAt);
          return previous && timestamp < previous
            ? current
            : { ...current, snapshot, now: Date.now() };
        }),
      onStatus: (status) =>
        setState((current) => ({
          ...current,
          ...status,
          awaitingConfig: false,
          now: Date.now(),
        })),
    });
    poller.current = instance;
    const timer = window.setInterval(
      () => setState((current) => ({ ...current, now: Date.now() })),
      30_000,
    );
    return () => {
      window.clearInterval(timer);
      instance.dispose();
      poller.current = undefined;
    };
  }, []);
  useEffect(() => {
    const eligible = enabled && activity.active && activity.online;
    if (polling) {
      singleShotRequested.current = false;
      poller.current?.setActive(eligible);
    } else {
      poller.current?.setActive(false);
      if (eligible && !singleShotRequested.current) {
        singleShotRequested.current = true;
        void poller.current?.refreshOnce();
      }
    }
    setState((current) => ({ ...current, active: polling && eligible, now: Date.now() }));
  }, [enabled, polling, activity.active, activity.online]);
  return state;
}
