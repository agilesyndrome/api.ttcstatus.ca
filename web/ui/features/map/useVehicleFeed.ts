import { useEffect, useRef, useState } from 'react';
import { requestVehicleUpdate, VehiclePoller } from '../../../../shared/live/polling';
import { DEFAULT_LIVE_UPDATE_SECONDS } from '../../../../shared/live/config';
import type { FeedState } from './LiveFeedStatus';

/** One feed owner per page. Filters and legend never create their own requests. */
export function useVehicleFeed(
  enabled: boolean,
  options: { polling?: boolean } = {},
): FeedState {
  const polling = options.polling ?? true;
  const [state, setState] = useState<FeedState>({
    failed: false,
    active: false,
    updateSeconds: DEFAULT_LIVE_UPDATE_SECONDS,
    retrySeconds: 0,
    now: Date.now(),
  });
  const poller = useRef<VehiclePoller | undefined>(undefined);
  const singleShotRequested = useRef(false);
  useEffect(() => {
    const instance = new VehiclePoller({
      request: (signal, etag) =>
        requestVehicleUpdate('/api/v1/vehicles/streetcar', signal, etag),
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
        setState((current) => ({ ...current, ...status, now: Date.now() })),
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
    const sync = () => {
      const eligible = enabled && !document.hidden && navigator.onLine;
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
      setState((current) => ({
        ...current,
        active: polling && eligible,
        now: Date.now(),
      }));
    };
    const pause = () => {
      poller.current?.setActive(false);
      setState((current) => ({ ...current, active: false }));
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    window.addEventListener('pagehide', pause);
    window.addEventListener('pageshow', sync);
    return () => {
      poller.current?.setActive(false);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      window.removeEventListener('pagehide', pause);
      window.removeEventListener('pageshow', sync);
    };
  }, [enabled, polling]);
  return state;
}
