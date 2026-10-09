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
 *   ?map=<name>          — named artifact (ttcstatus | streetcar | snake)
 *   ?mapVersion=<tag>    — a published tag (latest, stable, ...) selecting a
 *                          pinned artifact for that name; without it the API
 *                          serves the active pipeline pointer. */
const MAP_NAMES = ['ttcstatus', 'streetcar', 'snake'] as const;
export function mapRequestFromSearch(search: string) {
  const params = new URLSearchParams(search);
  const requested = params.get('map');
  // The homepage consumes the stable 'ttcstatus' board by default: it is the
  // published snake-derived map frozen under its own name, so the snake game's
  // 'snake' artifact can change direction freely without touching this site.
  const name = (MAP_NAMES as readonly string[]).includes(requested ?? '')
    ? (requested as (typeof MAP_NAMES)[number])
    : 'ttcstatus';
  const version = params.get('mapVersion');
  const tag =
    version && /^[\w][\w.-]{0,63}$/.test(version)
      ? `?tag=${encodeURIComponent(version)}`
      : '';
  const suffix = name === 'streetcar' && !tag ? '?format=schematic-v1' : '';
  return `/api/v1/map/${name}${tag || suffix}`;
}

export function useStaticMap() {
  // ?map=streetcar or ?map=snake previews the other published boards (the raw
  // schematic or the game's own artifact), and ?mapVersion=<tag> pins a
  // published version. The default 'ttcstatus' board is the stable site map,
  // decoupled from the snake game's 'snake' artifact.
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
        if (!response.ok) {
          if (response.status === 503 || response.status === 404) {
            // Only 503 'map-generating' means a generation is running right now
            // and the map really is on its way. Every other 503 ('map-not-ready'
            // — nothing ever generated, 'map-artifact-incomplete' — a broken
            // artifact) and the 404 'not-found' / 'map-tag-missing' mean the
            // map has failed or the pipeline is not running.
            const cause =
              response.status === 503
                ? ((await response
                    .clone()
                    .json()
                    .catch(() => null)) as { error?: string } | null)
                : null;
            throw new Error(
              cause?.error === 'map-generating'
                ? english('map.theStreetcarMapIsBeingPreparedPleaseTryAgainShortly')
                : t('map.mapTemporarilyUnavailableWhileWePerformTrackWork'),
            );
          }
          throw new Error(t('map.mapRequestFailedValue', { value1: response.status }));
        }
        setData(mapPayload((await response.json()) as ViewerSource | ViewerData));
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            // Network-level failures (offline, DNS, connection refused) reject
            // with a TypeError whose raw message ("Failed to fetch") is noise
            // for visitors — show the delay message instead.
            error instanceof TypeError
              ? t('map.wereExperiencingADelayPleaseTryAgainShortly')
              : error instanceof Error
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
