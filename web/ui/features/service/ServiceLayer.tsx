import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ViewerData } from '../../../../shared/map/model';
import { useFeatureFlags } from './useFeatureFlags';
import { useServiceFeed } from './useServiceFeed';
import { useServiceWave } from './useServiceWave';
import { VoidOverlay } from './VoidOverlay';
import { ServicePanel } from './ServicePanel';

export interface ServiceOverlay {
  overlay: ((scale: number) => ReactNode) | null;
  panel: ReactNode | null;
}

const EMPTY_POSITIONS = new Map<string, { latitude: number; longitude: number }>();

/** The whole feature-gated service layer (sla.md §4.7): with `voidOverlay`
 * enabled the overlay renders and the panel mounts; without it — or signed
 * out — nothing renders and no /service/* requests are made at all. */
export function useServiceOverlay(data: ViewerData | undefined): ServiceOverlay {
  const flags = useFeatureFlags();
  const enabled = flags.loaded && flags.overlayEnabled && Boolean(data);
  const feed = useServiceFeed(enabled);
  const wave = useServiceWave(enabled);
  const [fallbackPositions, setFallbackPositions] = useState(EMPTY_POSITIONS);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setFallbackPositions(EMPTY_POSITIONS);
      return;
    }
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    // Dev-only fallback positions (the preview corpus): live data joins on
    // the map's own stop features; in production this 404s and stays empty.
    const controller = new AbortController();
    void fetch('/api/v1/service/preview-positions', {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        const positions = payload?.positions;
        if (positions && typeof positions === 'object') {
          setFallbackPositions(new Map(Object.entries(positions)));
        }
      })
      .catch(() => {});
    return () => {
      controller.abort();
      query.removeEventListener('change', update);
    };
  }, [enabled]);
  const statesByStop = useMemo(
    () => new Map(feed.states.map((state) => [state.stopId, state])),
    [feed.states],
  );
  if (!enabled || !data) return { overlay: null, panel: null };
  return {
    overlay: (scale: number) => (
      <VoidOverlay
        scale={scale}
        features={data.features}
        statesByStop={statesByStop}
        fallbackPositions={fallbackPositions}
        transform={data.geographicTransform}
      />
    ),
    panel: (
      <ServicePanel
        feed={feed}
        wave={wave.wave}
        onRefreshWave={wave.refresh}
        reducedMotion={reducedMotion}
      />
    ),
  };
}
