import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Bounds, Edge, Feature, ViewerData } from '../../../../shared/map/model';
import { serviceConfig } from '../../../../shared/service/config';
import { useActivity } from '../../services/platform/react';
import type { PlottedVehicle } from '../../../../shared/map/live-status';
import type { StopServiceState } from '../../../../shared/service/contracts';
import {
  intersectionPlatforms,
  intersectionTitle,
  pairDistinguishable,
  twinFeature,
} from '../map/platform-pairs';
import { SegmentedControl } from '../../components/SegmentedControl';
import { DirectionRose } from './DirectionRose';
import { overlayLaunch } from '../../services/http/live-transport';
import { useServiceFeed } from './useServiceFeed';
import { TrackService } from './TrackService';
import { SelectedStopMarker } from './SelectedStopMarker';
import { SelectedStopCard } from './SelectedStopCard';
import {
  advanceStopState,
  directionColorAlong,
  directionOptions,
  directionSiblings,
  earliestDeadlineMs,
  platformCompassKey,
  platformDirectionLabel,
  platformRoutes,
  routeOptions,
  surfaceStatesByStop,
  trackFieldSignature,
  visibleEdgesOf,
  visibleStopsOf,
  worstPlatform,
} from './wave-field';
import type { CompassKey } from './wave-field';

export interface ServiceOverlay {
  /** The field painted on the tracks — renders UNDER cars and labels. The
   * camera rect (the visible world) rides along since
   * docs/optimize-overlay.md E4S1: the engine advances and schedules only
   * what is on screen. */
  underlay: ((scale: number, camera: Bounds) => ReactNode) | null;
  /** The selected stop's marker — renders above the scene. */
  overlay: ((scale: number, camera: Bounds) => ReactNode) | null;
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

/** The breathing clock, promoted to an engine (docs/optimize-overlay.md
 * E4S1/E4S3/E4S4): no more 1 Hz metronome. The camera's visible rect is
 * captured from the underlay's render (it runs every camera frame) and
 * debounced to its settled position — 150 ms after the last frame — because
 * gestures move the world every frame but the visible set only matters
 * once the camera rests. The engine then schedules ONE timeout at the
 * earliest moment any on-screen stop's field actually changes (a quantised
 * dryness step, a state boundary, the void-absolute horizon, or the
 * selected card's next label tick), computed exactly because dryness grows
 * one second per second — fewer wakes than a clock, and transitions land at
 * the TRUE moment instead of the next tick of an interval. A hidden tab
 * schedules nothing at all. */

/** The public rollout switch (docs/optimize-overlay.md E2S2): the overlay's
 * `enabled` flag from the same launch config fetch that owns its transport —
 * `overlay.enabled` in `/api/v1/auth/config`, never a per-user grant and
 * never an account state. Null while the config is still in flight means
 * disabled: nothing renders and no requests are made (the config fetch is
 * the first request an overlay-on client ever makes). A failed config fetch
 * reads as off — retried on the next activation by the transport's cache. */
function useOverlayEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    overlayLaunch()
      .then((launch) => {
        if (!cancelled) setEnabled(launch.enabled);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}

/** The whole service layer (docs/optimize-overlay.md Epic 2): with the
 * rollout switch on, the dryness field paints the tracks (under
 * cars/labels), the map's own stops become the tap targets, and a selected
 * stop gets one marker plus a story card. For every visitor — signed-out
 * included (the data is public broadcast bytes from the CDN). Without the
 * switch — or while it loads — nothing renders and no requests are made
 * at all. */
export function useServiceOverlay(
  data: ViewerData | undefined,
  cars?: PlottedVehicle[],
  /** Hard suspend: nothing renders, nothing is fetched — the snake game
   * (E7S7). The overlay never appears over the game, by construction. */
  suspended = false,
  requested = false,
  onClearWorkspace?: () => void,
  selectedRoute?: string,
  selectedFeature?: Feature,
): ServiceOverlay {
  const overlayEnabled = useOverlayEnabled();
  const enabled = requested && !suspended && Boolean(data) && overlayEnabled === true;
  const feed = useServiceFeed(enabled);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  // Directionless mode (the street test): a tap on a MERGED platform pair
  // opens the story without assuming a direction — the rose offers the
  // platforms, none pressed, until the rider picks one. Null = platform
  // mode (a specific boarding point speaks the facts).
  const [intersectionIds, setIntersectionIds] = useState<string[] | null>(null);
  // The camera's latest screen-px per world unit, captured from the
  // underlay's render (it runs every camera frame) so merge decisions at
  // tap time use the zoom the rider actually sees.
  const scaleRef = useRef(1);
  // E4S1: the same render also debounces the camera's settled position AND
  // zoom — the timer re-arms every frame and fires 150 ms after the last
  // one, so gestures cost nothing, and the guard means only a real camera
  // or zoom change ever lands (feed ticks and engine wakes never churn it).
  const [settled, setSettled] = useState<{ camera: Bounds; scale: number } | null>(null);
  const settledRef = useRef<{ camera: Bounds; scale: number } | null>(null);
  const settleTimer = useRef<number | undefined>(undefined);
  const settleCamera = (camera: Bounds, scale: number) => {
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const previous = settledRef.current;
      if (previous && previous.camera === camera && previous.scale === scale) return;
      const next = { camera, scale };
      settledRef.current = next;
      setSettled(next);
    }, 150);
  };
  useEffect(() => () => window.clearTimeout(settleTimer.current), []);
  /** The on-screen stops (with a half-viewport margin, so a fast pan keeps
   * the field painted past the screen edge until the camera settles). Null
   * before the camera settles = treat everything as visible once. */
  const visibleStopIds = useMemo(
    () => (data && settled ? visibleStopsOf(data.features, settled.camera) : null),
    [data, settled],
  );
  /** The painted field's cull set (E5S1): DOM count scales with the
   * viewport, not the network. Null before the camera settles = paint all. */
  const visibleEdges = useMemo(
    () => (data && settled ? visibleEdgesOf(data.edges, settled.camera) : null),
    [data, settled],
  );
  const [reducedMotion, setReducedMotion] = useState(false);
  // E4S4: the engine runs only while the tab is foreground — a hidden tab
  // performs zero timer work (the feed already pauses there; returning to
  // an overdue view refreshes immediately through its own seam).
  const activity = useActivity();
  const engineOn = enabled && activity.active;
  const [now, setNow] = useState(() => Date.now());
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
  // The heartbeat: advance stops between ticks (elapsed since their last
  // touch grows in real time), scored with the same shared machine the API
  // uses — a stop crosses fresh → due → void at the true moment, not the
  // next tick. Estimates and coverage stay tick-fresh; a blind spot never
  // advances into a verdict. Subway-only stops are filtered out entirely
  // (E7S7): no fields, no tints, no trails, no cards on the subway network.
  // E4S5: only the ON-SCREEN stops (and the selected one, whose card speaks
  // even from off-screen) advance between ticks — off-screen anchors keep
  // their tick-fresh values until the settled camera brings them back.
  const statesByStop = useMemo(() => {
    const byMs = feed.at === null ? 0 : now - feed.at;
    return surfaceStatesByStop(
      new Map(
        feed.states.map((state) => [
          state.stopId,
          byMs > 0 &&
          (!visibleStopIds ||
            visibleStopIds.has(state.stopId) ||
            state.stopId === selectedStopId)
            ? advanceStopState(state, byMs)
            : state,
        ]),
      ),
    );
  }, [feed.states, feed.at, now, visibleStopIds, selectedStopId]);
  // The scheduler (E4S3): one timeout at the earliest VISIBLE change — see
  // the engine comment above the hook. Wakes only ever set `now`; the
  // states/repaint pipeline gates itself exactly as before. Infinity (no
  // live stops) falls to the 5 s safety re-check, which also absorbs
  // anything a camera move or feed tick did not already reschedule.
  useEffect(() => {
    if (!engineOn) return;
    const deadline = earliestDeadlineMs(statesByStop, {
      selectedStopId,
      visibleStopIds,
      config: serviceConfig(),
    });
    const delay = Number.isFinite(deadline)
      ? Math.min(5_000, Math.max(250, deadline))
      : 5_000;
    const timer = window.setTimeout(() => setNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [engineOn, statesByStop, visibleStopIds, selectedStopId]);
  /** Stop names from the map's own features — the map already knows these. */
  const stopNameOf = useMemo(() => {
    const names = new Map<string, string>();
    for (const feature of data?.features ?? []) {
      for (const stopId of feature.stopIds ?? []) names.set(stopId, feature.name);
    }
    return (stopId: string) => names.get(stopId);
  }, [data]);
  const selectedStop = selectedStopId ? (statesByStop.get(selectedStopId) ?? null) : null;
  // The car tint rides the field's quantised steps — the signature is a
  // number compared by value (E4S5: a 32-bit hash over the same fields the
  // old string carried, no per-stop allocations), so the callback's
  // identity (and TransitMap's memo) holds still between visible steps even
  // as the engine wakes.
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
  }, [signature]);
  // E4S5: one edge-id map per map version — the tint's old per-car linear
  // scan over every edge was O(cars × edges) on every feed tick.
  const edgesById = useMemo(() => {
    const byId = new Map<string, Edge>();
    for (const edge of data?.edges ?? []) byId.set(edge.id, edge);
    return byId;
  }, [data]);
  const carTint = useMemo(() => {
    const features = data?.features ?? [];
    return (car: PlottedVehicle): string | null => {
      // Subway cars never carry the field (E7S7) — the overlay is
      // surface-only, and their stops no longer anchor anything anyway.
      if (car.vehicle.mode === 'subway') return null;
      if (!car.match || car.stale) return null;
      const edge = edgesById.get(car.match.edgeId);
      if (!edge) return null;
      return directionColorAlong(
        edge,
        car.match.direction === 1 ? 0 : 1,
        car.match.distanceAlongMetres,
        features,
        tintStates,
      );
    };
  }, [data, tintStates, edgesById]);
  const selectFromFeature = useMemo(() => {
    return (feature: Feature | undefined | null) => {
      const clear = () => {
        setSelectedStopId(null);
        setIntersectionIds(null);
      };
      const features = data?.features ?? [];
      if (!feature || !feature.stopIds || feature.stopIds.length === 0) return clear();
      const platforms = intersectionPlatforms(feature, features, statesByStop);
      const twin = twinFeature(feature, features);
      // A MERGED dot (one feature carrying both boarding points — a dot
      // that never splits — or a pair closer on screen than a rider can
      // tell apart at this zoom) never assumes a direction: both
      // platforms are offered, none pressed.
      const merged =
        platforms.length >= 2 &&
        (twin === null
          ? feature.stopIds.length >= 2
          : !pairDistinguishable(feature, twin, scaleRef.current));
      if (merged) {
        setSelectedStopId(null);
        setIntersectionIds(platforms.map((platform) => platform.stopId));
        return;
      }
      setIntersectionIds(null);
      setSelectedStopId(feature.stopIds.find((id) => statesByStop.has(id)) ?? null);
    };
  }, [statesByStop, data]);
  const selectFromFeatureRef = useRef(selectFromFeature);
  selectFromFeatureRef.current = selectFromFeature;
  useEffect(() => {
    if (enabled) selectFromFeatureRef.current(selectedFeature);
  }, [enabled, selectedFeature?.id, feed.states.length]);
  const empty = {
    underlay: null,
    overlay: null,
    card: null,
    onSelectServiceStop: () => {},
    onFeatureSelectForService: () => {},
    carTint: () => null,
  };
  if (!enabled || !data) return empty;
  /** Directionless mode: the tapped dot was a merged pair (or one dot
   * carrying both boarding points) — `platforms` are the offered
   * directions, none assumed. */
  const platforms = (intersectionIds ?? [])
    .map((id) => statesByStop.get(id))
    .filter((state): state is StopServiceState => state !== undefined);
  const focus =
    selectedStop ?? (platforms.length > 0 ? platforms.reduce(worstPlatform) : null);
  const clearSelection = () => {
    setSelectedStopId(null);
    setIntersectionIds(null);
    onClearWorkspace?.();
  };
  const pickPlatform = (stopId: string) => {
    setIntersectionIds(null);
    setSelectedStopId(stopId);
  };
  /** Route first, then Direction (the street test): a gloved tap lands
   * on the wrong platform, and an intersection can host several
   * corridors. Route is a switcher ONLY when switching lands you on a
   * different platform — corridors that share the platform share its
   * numbers, so they read as text. Direction is the compass rose: every
   * direction at its own position, none moved by selection; in
   * directionless mode nothing is pressed until the rider picks. */
  const routeControl = () => {
    if (!focus) return null;
    const options = routeOptions(focus, data.features, statesByStop, data.routes);
    if (options.length === 0) return null;
    const switches = options.some((option) => option.stopId !== focus.stopId);
    if (!switches) {
      // Every route here shares the platform — a switcher would be a
      // button that changes nothing. Text, day numbers only ("505
      // Dundas", never the 305 night twin).
      return (
        <p className="service-card__route-line">
          {options.length === 1 ? 'Route' : 'Routes'}{' '}
          {options.map((option) => `${option.number} ${option.name}`).join(', ')}
        </p>
      );
    }
    // The pressed button is the route whose platform speaks the facts
    // (the card's platform), in the list's stable day-number order. The
    // order itself never changes with selection: a selected button is
    // highlighted, never moved to the front (fast hands learn one layout).
    const current =
      options.find((option) => option.stopId === focus.stopId)?.number ?? '';
    return (
      <SegmentedControl
        value={current}
        label="Route"
        options={options.map((option) => ({
          value: option.number,
          label: `${option.number} ${option.name}`,
        }))}
        onChange={(number) => {
          const target = options.find((option) => option.number === number);
          if (target?.stopId) pickPlatform(target.stopId);
        }}
      />
    );
  };
  const directionControl = () => {
    if (!focus) return null;
    const patterns = data.patterns ?? [];
    const directionless = selectedStop === null && platforms.length >= 2;
    const ownKey = platformCompassKey(focus, data.features, patterns);
    // The rose needs an honest compass key for every entry; without one it
    // falls back to the plain segmented pair (direction words), never a
    // guessed position.
    const offered = directionless
      ? platforms
      : directionSiblings(focus, data.features, statesByStop);
    const roseReady =
      ownKey !== null &&
      offered.every(
        (option) => platformCompassKey(option, data.features, patterns) !== null,
      );
    if (roseReady) {
      // One button per compass position: the card's own platform first
      // (pressed in platform mode), then paired twins, then stopId order —
      // deterministic, and never reordered by selection.
      const byKey = new Map<CompassKey, string>([[ownKey, focus.stopId]]);
      const paired = new Set(
        data.features.find((entry) => entry.stopIds?.includes(focus.stopId))?.stopIds ??
          [],
      );
      const ranked = offered
        .map((option) => ({
          option,
          key: platformCompassKey(option, data.features, patterns)!,
        }))
        .sort(
          (a, b) =>
            (paired.has(a.option.stopId) ? 0 : 1) -
              (paired.has(b.option.stopId) ? 0 : 1) ||
            a.option.stopId.localeCompare(b.option.stopId),
        );
      for (const { option, key } of ranked)
        if (!byKey.has(key)) byKey.set(key, option.stopId);
      return (
        <DirectionRose
          value={selectedStop?.stopId ?? ''}
          label="Boarding direction"
          options={[...byKey].map(([compass, stopId]) => ({ stopId, compass }))}
          onChange={pickPlatform}
        />
      );
    }
    const labelOf = (stop: StopServiceState) => ({
      value: stop.stopId,
      label: platformDirectionLabel(stop, data.features, patterns),
    });
    const fallback = directionless
      ? platforms.map(labelOf)
      : [
          labelOf(focus),
          ...directionOptions(focus, data.features, statesByStop, patterns).map(
            (option) => ({ value: option.stopId, label: option.label }),
          ),
        ];
    if (fallback.length < 2) return null;
    return (
      <SegmentedControl
        value={selectedStop?.stopId ?? ''}
        label="Boarding direction"
        options={fallback}
        onChange={pickPlatform}
      />
    );
  };
  return {
    underlay: (scale: number, camera: Bounds) => {
      // Capture the live zoom: merge decisions at tap time read the zoom;
      // the engine's settled-camera debounce (E4S1) reads the rect, and the
      // painted field's cull set (E5S1) reads the settled pair.
      scaleRef.current = scale;
      settleCamera(camera, scale);
      return (
        <TrackService
          edges={data.edges}
          features={data.features}
          statesByStop={statesByStop}
          cars={cars}
          visibleEdges={visibleEdges}
          scale={settled?.scale ?? 0}
          selectedRoute={selectedRoute}
        />
      );
    },
    onSelectServiceStop: (stopId: string | null) => {
      // A tap on the selected platform's ring toggles it off; other rings
      // switch platforms. Both clear the directionless offer.
      if (stopId && selectedStopId !== stopId) pickPlatform(stopId);
      else clearSelection();
    },
    onFeatureSelectForService: selectFromFeature,
    carTint,
    // No ring in directionless mode: nothing is selected until the rider
    // picks a direction — the dot they tapped was one stop, not two.
    overlay: selectedStop
      ? (scale: number, camera: Bounds) => {
          scaleRef.current = scale;
          settleCamera(camera, scale);
          return (
            <SelectedStopMarker
              stop={selectedStop}
              features={data.features}
              selectedStopId={selectedStopId}
              reducedMotion={reducedMotion}
            />
          );
        }
      : null,
    card: focus ? (
      <SelectedStopCard
        key={focus.stopId}
        stop={focus}
        name={
          selectedStop
            ? stopNameOf(selectedStop.stopId)
            : intersectionTitle(stopNameOf(focus.stopId) ?? focus.stopId)
        }
        onClear={clearSelection}
        controls={
          <>
            {routeControl()}
            {directionControl()}
          </>
        }
        routes={platformRoutes(focus.routeIds, data.routes)}
      />
    ) : null,
  };
}
