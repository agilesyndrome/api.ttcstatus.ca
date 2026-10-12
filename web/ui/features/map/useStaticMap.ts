import { useEffect, useState } from 'react';
import type { ViewerData } from '../../../../shared/map/model';
import { english } from '../../../../shared/i18n/messages';
import { apiRequest } from '../../services/http/client';
import { clientConfig } from '../../services/http/config';
import { readSnapshot, saveSnapshot, snapshotKey } from '../../services/cache/snapshots';
import { useActivity } from '../../services/platform/react';
import { useRoute } from '../../services/navigation/react';
import { mapRequestFromSearch } from './static/request';
import { isViewerData, viewerPayload } from './static/payload';
import { mapFailure } from './static/errors';
export { mapRequestFromSearch } from './static/request';

interface MapState {
  key: string;
  data?: ViewerData;
  error?: string;
  cached: boolean;
  savedAt?: number;
  refreshing: boolean;
}

export function useStaticMap() {
  const route = useRoute();
  const search = new URL(route, 'https://ttcstatus.ca').search;
  const request = mapRequestFromSearch(search);
  const key = snapshotKey('public-map', request, clientConfig().apiOrigin);
  const activity = useActivity();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<MapState>({ key, cached: false, refreshing: true });
  useEffect(() => {
    if (!activity.active) return;
    const controller = new AbortController();
    const stopped = () => controller.signal.aborted;
    void (async () => {
      const cached = await readSnapshot(key, isViewerData);
      if (stopped()) return;
      setState((current) => ({
        key,
        data: (current.key === key ? current.data : undefined) ?? cached?.value,
        cached: Boolean(cached || (current.key === key && current.data)),
        savedAt: cached?.savedAt ?? current.savedAt,
        refreshing: activity.online,
      }));
      if (!activity.online) {
        setState((current) => ({
          ...current,
          refreshing: false,
          error: english('map.wereExperiencingADelayPleaseTryAgainShortly'),
        }));
        return;
      }
      try {
        const response = await apiRequest(request, {
          signal: controller.signal,
          headers: cached?.etag ? { 'if-none-match': cached.etag } : {},
          // The app owns its snapshot cache and its ETag. Do not let the
          // browser's separate HTTP cache create a 304 when IndexedDB has no
          // matching snapshot for the app to use.
          cache: 'no-store',
        });
        if (response.status === 304 && cached) {
          if (!stopped())
            setState((current) => ({
              key,
              data: current.key === key ? (current.data ?? cached.value) : cached.value,
              cached: false,
              savedAt: cached.savedAt,
              refreshing: false,
              error: undefined,
            }));
          return;
        }
        if (response.status === 304) {
          // A browser cache can still surface a 304 in some environments. If
          // the current view already has usable map data, retain it rather
          // than incorrectly reporting a refresh failure.
          setState((current) =>
            current.key === key && current.data
              ? { ...current, cached: false, refreshing: false, error: undefined }
              : current,
          );
          return;
        }
        if (!response.ok) throw new Error(await mapFailure(response));
        const data = viewerPayload(await response.json());
        if (stopped()) return;
        const savedAt = Date.now();
        setState({ key, data, cached: false, savedAt, refreshing: false });
        await saveSnapshot(key, {
          value: data,
          savedAt,
          etag: response.headers.get('etag') ?? undefined,
          version: response.headers.get('x-network-version') ?? undefined,
        });
      } catch (error) {
        if (!stopped())
          setState((current) => ({
            ...current,
            refreshing: false,
            error:
              error instanceof TypeError
                ? english('map.wereExperiencingADelayPleaseTryAgainShortly')
                : error instanceof Error
                  ? error.message
                  : english('map.unableToLoadTheStreetcarMap'),
          }));
      }
    })();
    return () => controller.abort();
  }, [key, request, attempt, activity.active, activity.online]);
  return {
    ...(state.key === key ? state : { key, cached: false, refreshing: true }),
    retry: () => setAttempt((value) => value + 1),
  };
}
