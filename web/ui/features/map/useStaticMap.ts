import { english } from '../../../../shared/i18n/messages';
import { t } from '../../i18n';
import { useEffect, useState } from 'react';
import {
  buildViewerData,
  type ViewerData,
  type ViewerSource,
} from '../../../../shared/map/model';

/** A published artifact is either a generator source (re-derived by the client)
 * or a fully derived viewer payload (the snake board). Discriminate on the
 * source's `graph` field, which viewer data never carries. */
function mapPayload(value: ViewerSource | ViewerData): ViewerData {
  return 'graph' in value ? buildViewerData(value) : value;
}

/** Map URL parameters to a published map request:
 *   ?map=<name>          — named artifact (streetcar | snake), default streetcar
 *   ?mapVersion=<tag>    — a published tag (latest, stable, ...) selecting a
 *                          pinned artifact for that name; without it the API
 *                          serves the active pipeline pointer. */
export function mapRequestFromSearch(search: string) {
  const params = new URLSearchParams(search);
  const name = params.get('map') === 'snake' ? 'snake' : 'streetcar';
  const version = params.get('mapVersion');
  const tag =
    version && /^[\w][\w.-]{0,63}$/.test(version)
      ? `?tag=${encodeURIComponent(version)}`
      : '';
  const suffix = name === 'streetcar' && !tag ? '?format=schematic-v1' : '';
  return `/api/v1/map/${name}${tag || suffix}`;
}

export function useStaticMap() {
  // Throwaway experiment (not an API contract): ?map=snake previews the game's
  // published board — collapsed corridors, rounded corners, no duplicate rails —
  // as the production explorer map, and ?mapVersion=<tag> pins a published
  // version. Delete freely if the idea is dumped.
  const [mapRequest] = useState(() => mapRequestFromSearch(window.location.search));
  const [data, setData] = useState<ViewerData>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(undefined);
    async function load() {
      try {
        const response = await fetch(mapRequest, {
          signal: controller.signal,
          cache: 'no-cache',
        });
        if (!response.ok)
          throw new Error(
            response.status === 503
              ? english('map.theStreetcarMapIsBeingPreparedPleaseTryAgainShortly')
              : t('map.mapRequestFailedValue', { value1: response.status }),
          );
        setData(mapPayload((await response.json()) as ViewerSource | ViewerData));
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : english('map.unableToLoadTheStreetcarMap'),
          );
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt, mapRequest]);
  return { data, error, retry: () => setAttempt((value) => value + 1) };
}
