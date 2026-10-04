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
              ? 'The streetcar map is being prepared. Please try again shortly.'
              : `Map request failed (${response.status}).`,
          );
        setData(buildViewerData((await response.json()) as ViewerSource));
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : 'Unable to load the streetcar map.',
          );
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);
  return { data, error, retry: () => setAttempt((value) => value + 1) };
}
