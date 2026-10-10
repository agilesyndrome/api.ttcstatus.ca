import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Feature, ViewerData } from '../../../../shared/map/model';
import type { PlottedVehicle } from '../../../../shared/map/live-status';
import type { StopServiceState } from '../../../../shared/service/contracts';
import { useAccount } from '../accounts/auth';
import { useFeatureFlags } from './useFeatureFlags';
import { useServiceFeed } from './useServiceFeed';
import { TrackService } from './TrackService';
import { SelectedStopMarker } from './SelectedStopMarker';
import { SelectedStopCard } from './SelectedStopCard';
import { advanceStopState, directionColorAlong, trackFieldSignature } from './wave-field';
import { readDevOverlayBypass } from './useDevOverlayBypass';

export interface ServiceOverlay {
  /** The field painted on the tracks — renders UNDER cars and labels. */
  underlay: ((scale: number) => ReactNode) | null;
  /** The selected stop's marker — renders above the scene. */
  overlay: ((scale: number) => ReactNode) | null;
  /** The selected stop's story card — render anywhere in the workspace. */
  card: ReactNode | null;
  /** Map-tap selection for the selected marker (the camera's pointer-up
   * hit-test resolves `data-service-stop`; tapping it again clears). */
  onSelectServiceStop: (stopId: string | null) => void;
  /** Follow map feature selection: tapping a stop on the base map selects
   * its delivered-service story. Undefined/featureless clears. */
  onFeatureSelectForService: (feature: Feature | undefined | null) => void;
  /** The car tint: a car's direction field colour where it rides, or null
   * when that direction has no data on its track. Identity is stable while
   * the quantised field holds still, so TransitMap's memo survives the
   * heartbeat. */
  carTint: (car: PlottedVehicle) => string | null;
}

/** The breathing clock: a 1 Hz `now` while the layer is enabled. Elapsed
 * time genuinely advances one second per second, so the field intensifies
 * in real time between feed ticks — honest interpolation, not animation. */
function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return now;
}

/** The whole feature-gated service layer (sla.md §4.7): with `voidOverlay`
 * enabled, the dryness field paints the tracks (under cars/labels), the map's
 * own stops become the tap targets, and a selected stop gets one marker plus
 * a story card. Without the flag — or signed out — nothing renders and no
 * /service/* requests are made at all. */
export function useServiceOverlay(
  data: ViewerData | undefined,
  cars?: PlottedVehicle[],
): ServiceOverlay {
  const flags = useFeatureFlags();
  const account = useAccount();
  // Local-dev bypass: only consulted when the site itself runs without auth
  // (production always has Clerk configured, so this can never fire).
  const devBypass = account.loaded && !account.enabled ? readDevOverlayBypass() : false;
  const enabled = Boolean(data) && (devBypass || (flags.loaded && flags.overlayEnabled));
  const feed = useServiceFeed(enabled);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const now = useNow(enabled);
  useEffect(() => {
    if (!enabled) {
      setSelectedStopId(null);
      return;
    }
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [enabled]);
  // The heartbeat: advance every stop between ticks (elapsed since its last
  // touch grows in real time), scored with the same shared machine the API
  // uses — a stop crosses fresh → due → void at the true moment, not the
  // next tick. Estimates and coverage stay tick-fresh; a blind spot never
  // advances into a verdict.
  const statesByStop = useMemo(() => {
    const byMs = feed.at === null ? 0 : now - feed.at;
    return new Map(
      feed.states.map((state) => [
        state.stopId,
        byMs > 0 ? advanceStopState(state, byMs) : state,
      ]),
    );
  }, [feed.states, feed.at, now]);
  /** Stop names from the map's own features — the map already knows these. */
  const stopNameOf = useMemo(() => {
    const names = new Map<string, string>();
    for (const feature of data?.features ?? []) {
      for (const stopId of feature.stopIds ?? []) names.set(stopId, feature.name);
    }
    return (stopId: string) => names.get(stopId);
  }, [data]);
  const selectedStop = selectedStopId ? (statesByStop.get(selectedStopId) ?? null) : null;
  // The car tint rides the field's quantised steps — the signature string is
  // compared by value, so the callback's identity (and TransitMap's memo)
  // holds still between visible steps even as the heartbeat ticks 1 Hz.
  const signature = useMemo(
    () => trackFieldSignature(data?.features ?? [], statesByStop),
    [data, statesByStop],
  );
  const statesRef = useRef(statesByStop);
  statesRef.current = statesByStop;
  const tintStates = useMemo(() => {
    const rounded = new Map<string, StopServiceState>();
    for (const [stopId, state] of statesRef.current) {
      rounded.set(
        stopId,
        state.dryness === null
          ? state
          : { ...state, dryness: Math.round(state.dryness * 4) / 4 },
      );
    }
    return rounded;
    // eslint-disable-next-line -- value-stable string: recomputes only on a visible step
  }, [signature]);
  const carTint = useMemo(() => {
    const edges = data?.edges ?? [];
    const features = data?.features ?? [];
    return (car: PlottedVehicle): string | null => {
      if (!car.match || car.stale) return null;
      const edge = edges.find((entry) => entry.id === car.match?.edgeId);
      if (!edge) return null;
      return directionColorAlong(
        edge,
        car.match.direction === 1 ? 0 : 1,
        car.match.distanceAlongMetres,
        features,
        tintStates,
      );
    };
  }, [data, tintStates]);
  const selectFromFeature = useMemo(() => {
    return (feature: Feature | undefined | null) => {
      if (!feature || !feature.stopIds) {
        setSelectedStopId(null);
        return;
      }
      setSelectedStopId(
        (feature.stopIds ?? []).find((stopId) => statesByStop.has(stopId)) ?? null,
      );
    };
  }, [statesByStop]);
  const empty = {
    underlay: null,
    overlay: null,
    card: null,
    onSelectServiceStop: () => {},
    onFeatureSelectForService: () => {},
    carTint: () => null,
  };
  if (!enabled || !data) return empty;
  return {
    onSelectServiceStop: (stopId: string | null) =>
      setSelectedStopId((current) => (current === stopId ? null : stopId)),
    onFeatureSelectForService: selectFromFeature,
    carTint,
    underlay: (_scale: number) => (
      <TrackService
        edges={data.edges}
        features={data.features}
        statesByStop={statesByStop}
        cars={cars}
      />
    ),
    overlay: selectedStop
      ? (_scale: number) => (
          <SelectedStopMarker
            stop={selectedStop}
            features={data.features}
            selectedStopId={selectedStopId}
            reducedMotion={reducedMotion}
          />
        )
      : null,
    card: selectedStop ? (
      <SelectedStopCard
        stop={selectedStop}
        name={stopNameOf(selectedStop.stopId)}
        onClear={() => setSelectedStopId(null)}
      />
    ) : null,
  };
}
