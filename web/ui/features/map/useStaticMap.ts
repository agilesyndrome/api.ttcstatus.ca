import { english } from '../../../../shared/i18n/messages';
import { t } from '../../i18n';
import { useEffect, useState } from 'react';
import {
  buildViewerData,
  type ViewerData,
  type ViewerSource,
} from '../../../../shared/map/model';

export function useStaticMap() {
  const [data, setData] = useState<ViewerData>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(undefined);
    async function load() {
      try {
        const response = await fetch('/api/v1/map/streetcar?format=schematic-v1', {
          signal: controller.signal,
          cache: 'no-cache',
        });
        if (!response.ok)
          throw new Error(
            response.status === 503
              ? english('map.theStreetcarMapIsBeingPreparedPleaseTryAgainShortly')
              : t('map.mapRequestFailedValue', { value1: response.status }),
          );
        setData(buildViewerData((await response.json()) as ViewerSource));
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
  }, [attempt]);
  return { data, error, retry: () => setAttempt((value) => value + 1) };
}
