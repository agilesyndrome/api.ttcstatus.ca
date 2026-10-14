import { useEffect, useRef, useState } from 'react';
import { liveTransport } from '../../services/http/live-transport';
import { fetchHistoricalTick } from '../../../../shared/live/polling';
import type { LiveTransportConfig } from '../../../../shared/live/config';
import { projectSnapshot, type PlottedVehicle } from '../../../../shared/map/live-status';
import type { ViewerData } from '../../../../shared/map/model';
import {
  dwellStops,
  glideFleet,
  edgeIndexById,
  resolveReplayWindow,
  tickStartMs,
  type ReplayDwellStop,
  type ReplayRange,
  type ReplayVehicleSample,
} from './replay';

/** Replay playback engine (docs/replay.md) — one per workspace, mounted
 * while the Replay destination is open (inert otherwise).
 *
 * A virtual playhead advances at the chosen speed through the selected
 * window; tick documents are prefetched just ahead of it and projected
 * once each (the same placement pipeline as the live map). Between frame
 * boundaries the fleet glides through `glideFleet` at a gentle 12 fps, so
 * vehicles move continuously instead of jumping once per snapshot — the
 * "watch live" feel without watching real time. Missing ticks (outage
 * holes, the unpublished tail, retention-expired edges) are skipped
 * honestly: the glide spans to the next available frame (up to a sane
 * limit, beyond which the picture holds) and the missing count is
 * surfaced to the panel.
 *
 * The engine owns no transport of its own: tick URLs derive from the
 * launch-time live config exactly like the live poller's, and the live
 * feed itself is never touched — replay and live are separate owners. */

const MAX_INFLIGHT = 8;
/** Frames cached behind the playhead before eviction (≈ back-scrub depth). */
const FRAMES_KEPT_BEHIND = 200;
/** Hard cache bound — scrubbing far back refetches evicted frames. */
const MAX_FRAMES = 240;
/** Interpolated-frame cadence. 12 fps reads as smooth motion at every
 * speed because each glide spans a whole tick interval (30 s of virtual
 * time — metres of travel per step). */
const EMISSION_MS = 1000 / 12;
/** Per-tick cooldown after a network error — the rAF loop would otherwise
 * hammer a failing host once per frame. */
const FETCH_RETRY_MS = 2500;
/** How far past the playhead a next frame is searched before the glide
 * holds (also the deep probe that separates an outage hole from an empty
 * window). */
const PROBE_LIMIT = 240;
/** Glides span at most this many ticks; longer gaps (long outages) hold
 * the source frame instead of crawling the fleet across the gap. */
const GLIDE_MAX_TICKS = 20;

interface Frame {
  tickId: number;
  timeMs: number;
  cars: PlottedVehicle[];
}

interface ResolvedWindow {
  startTick: number;
  endTick: number;
  tickMs: number;
}

export interface ReplayState {
  /** The selected range (relative duration or a Toronto-local day). */
  range: ReplayRange;
  playing: boolean;
  speed: number;
  /** The resolved, tick-quantized window in epoch ms; undefined until the
   * live transport config resolves. */
  window?: {
    startMs: number;
    endMs: number;
    windowTicks: number;
    tickMs: number;
  };
  /** The virtual clock — the scrubber position, epoch ms. */
  playheadMs?: number;
  /** The time the on-screen picture was taken (the newest completed
   * frame's tick start), epoch ms. */
  frameMs?: number;
  buffering: boolean;
  /** The playhead reached the window's end; play restarts from the top. */
  ended: boolean;
  noData: boolean;
  failed: boolean;
  loadedTicks: number;
  missingTicks: number;
  /** Interpolated vehicles for the map. Mode filters apply at the call
   * site, exactly like the live feed's. */
  cars: PlottedVehicle[];
  /** The recorded stops (dwells) of one vehicle across the frames cached
   * behind the playhead — the followed-car card's list. One pass over the
   * cache, recomputed by the card at each frame boundary. */
  dwellStopsOf(vehicleId: string): ReplayDwellStop[];
  /** The remote's controls. */
  setRange(next: ReplayRange): void;
  setSpeed(next: number): void;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(ms: number): void;
}

interface ReplayView {
  window?: ReplayState['window'];
  playheadMs?: number;
  frameMs?: number;
  buffering: boolean;
  ended: boolean;
  noData: boolean;
  failed: boolean;
  loadedTicks: number;
  missingTicks: number;
  cars: PlottedVehicle[];
}

const INITIAL_VIEW: ReplayView = {
  buffering: false,
  ended: false,
  noData: false,
  failed: false,
  loadedTicks: 0,
  missingTicks: 0,
  cars: [],
};

export function useReplay(data: ViewerData | undefined, enabled: boolean): ReplayState {
  const [range, setRange] = useState<ReplayRange>({
    kind: 'relative',
    durationMs: 30 * 60_000,
  });
  const [speed, setSpeed] = useState<number>(10);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<ReplayView>(INITIAL_VIEW);

  const frames = useRef(new Map<number, Frame>());
  const inflight = useRef(new Set<number>());
  const missing = useRef(new Set<number>());
  const rangeRef = useRef(range);
  const engine = useRef({
    raf: 0,
    transport: undefined as LiveTransportConfig | undefined,
    resolved: undefined as ResolvedWindow | undefined,
    playhead: 0,
    playing: false,
    speed: 10,
    lastFrameAt: 0,
    lastEmitAt: 0,
    lastHeadTick: -1,
    viewKey: '',
    retryAt: new Map<number, number>(),
  });
  const bootRef = useRef<() => void>(() => {});
  const rangeControlRef = useRef<(next: ReplayRange) => void>(() => {});

  useEffect(() => {
    rangeRef.current = range;
    rangeControlRef.current(range); // Resolve a range change mid-session.
  }, [range]);

  useEffect(() => {
    engine.current.speed = speed;
  }, [speed]);

  useEffect(() => {
    if (!enabled || !data) return;
    const e = engine.current;
    const controller = new AbortController();
    let disposed = false;
    frames.current.clear();
    inflight.current.clear();
    missing.current.clear();
    e.retryAt.clear();
    e.transport = undefined;
    e.resolved = undefined;
    e.playing = false;
    e.playhead = 0;
    e.lastHeadTick = -1;
    e.viewKey = '';
    setView(INITIAL_VIEW);
    setPlaying(false);

    const tickMs = () => (e.transport?.updateSeconds ?? 30) * 1000;

    const boot = () => {
      void liveTransport().then(
        (transport) => {
          if (disposed) return;
          e.transport = transport;
          resolveWindow();
        },
        () => {
          if (disposed) return;
          e.transport = undefined;
          e.resolved = undefined;
          setView((current) => ({ ...current, failed: true }));
        },
      );
    };
    bootRef.current = () => {
      if (!disposed) boot();
    };

    const resolveWindow = () => {
      const transport = e.transport;
      if (!transport) return;
      const grid = transport.updateSeconds * 1000;
      const resolved = resolveReplayWindow(rangeRef.current, Date.now(), grid);
      if (!resolved) {
        e.resolved = undefined;
        e.playing = false;
        setPlaying(false);
        setView((current) => ({ ...current, window: undefined, noData: true }));
        return;
      }
      e.resolved = { ...resolved, tickMs: grid };
      e.playhead = tickStartMs(resolved.startTick, grid);
      e.playing = true;
      e.lastHeadTick = -1;
      e.viewKey = '';
      setPlaying(true);
      setView({
        window: {
          startMs: tickStartMs(resolved.startTick, grid),
          endMs: tickStartMs(resolved.endTick, grid),
          windowTicks: resolved.endTick - resolved.startTick + 1,
          tickMs: grid,
        },
        playheadMs: e.playhead,
        frameMs: undefined,
        buffering: true,
        ended: false,
        noData: false,
        failed: false,
        loadedTicks: 0,
        missingTicks: 0,
        cars: [],
      });
    };
    rangeControlRef.current = (next) => {
      if (disposed || !e.transport) return;
      rangeRef.current = next;
      resolveWindow();
    };

    const load = (tickId: number, transport: LiveTransportConfig) => {
      if (
        frames.current.has(tickId) ||
        inflight.current.has(tickId) ||
        missing.current.has(tickId)
      )
        return;
      if (Date.now() < (e.retryAt.get(tickId) ?? 0)) return;
      inflight.current.add(tickId);
      void fetchHistoricalTick(transport, tickId, fetch, controller.signal)
        .then((snapshot) => {
          inflight.current.delete(tickId);
          if (disposed) return;
          if (!snapshot) {
            // Retention expired, an outage hole, or the unpublished tail:
            // a permanent gap for this window resolution.
            missing.current.add(tickId);
            return;
          }
          const timeMs = tickStartMs(tickId, tickMs());
          // Continuity from the previous tick when it survived eviction.
          const previous = frames.current.get(tickId - 1)?.cars;
          const cars = projectSnapshot(data, snapshot, timeMs, previous ?? []);
          frames.current.set(tickId, { tickId, timeMs, cars });
          evict();
        })
        .catch(() => {
          inflight.current.delete(tickId);
          if (disposed) return;
          e.retryAt.set(tickId, Date.now() + FETCH_RETRY_MS);
        });
    };

    const lookahead = () =>
      Math.max(6, Math.min(120, Math.ceil((e.speed * 8) / (tickMs() / 1000))));

    const prefetch = (headTick: number, resolved: ResolvedWindow) => {
      const transport = e.transport;
      if (!transport) return;
      // An empty cache probes deep once — the first frames decide whether
      // this window has data at all.
      const horizon =
        frames.current.size === 0
          ? Math.min(resolved.endTick, headTick + PROBE_LIMIT)
          : Math.min(resolved.endTick, headTick + lookahead());
      for (
        let tickId = headTick;
        tickId <= horizon && inflight.current.size < MAX_INFLIGHT;
        tickId++
      )
        load(tickId, transport);
    };

    const evict = () => {
      const resolved = e.resolved;
      if (!resolved) return;
      const headTick = Math.floor(e.playhead / resolved.tickMs);
      const floorTick = headTick - FRAMES_KEPT_BEHIND;
      let overflow = frames.current.size - MAX_FRAMES;
      // Map iterates insertion order — ascending with the prefetch — so
      // oldest frames drop first.
      for (const tickId of [...frames.current.keys()]) {
        if (overflow <= 0 && tickId >= floorTick) break;
        frames.current.delete(tickId);
        overflow--;
      }
    };

    const probe = (from: number, to: number, predicate: (tickId: number) => boolean) => {
      const limit = Math.min(to, from + PROBE_LIMIT);
      for (let tickId = from; tickId <= limit; tickId++)
        if (predicate(tickId)) return tickId;
      return undefined;
    };

    const loop = () => {
      if (disposed) return;
      e.raf = requestAnimationFrame(loop);
      const resolved = e.resolved;
      if (!resolved) return;
      const nowMs = performance.now();
      const dt = Math.min(1000, nowMs - e.lastFrameAt); // A hidden tab never fast-forwards.
      e.lastFrameAt = nowMs;
      const startMs = tickStartMs(resolved.startTick, resolved.tickMs);
      const endMs = tickStartMs(resolved.endTick, resolved.tickMs);
      if (e.playing) {
        e.playhead = Math.min(e.playhead + dt * e.speed, endMs);
        if (e.playhead >= endMs) {
          e.playing = false;
          setPlaying(false);
        }
      }
      const headTick = Math.floor(e.playhead / resolved.tickMs);
      prefetch(headTick, resolved);

      // The frames bracketing the playhead: the newest at or behind it,
      // and the next one ahead (possibly across an outage gap).
      let sourceId = frames.current.has(headTick)
        ? headTick
        : probe(
            Math.max(resolved.startTick, headTick - PROBE_LIMIT),
            headTick,
            (tickId) => frames.current.has(tickId),
          );
      if (sourceId === undefined && !e.playing) {
        // A paused scrub into unknown territory shows the first frame
        // ahead instead of an empty map.
        const ahead = probe(headTick + 1, resolved.endTick, (tickId) =>
          frames.current.has(tickId),
        );
        if (ahead !== undefined) sourceId = ahead;
      }
      const source = sourceId !== undefined ? frames.current.get(sourceId) : undefined;
      const destId = probe(headTick + 1, resolved.endTick, (tickId) =>
        frames.current.has(tickId),
      );
      const dest = destId !== undefined ? frames.current.get(destId) : undefined;

      // Anything ahead that can still arrive? (loaded, in flight, or not
      // yet known-missing.)
      const horizon = Math.min(resolved.endTick, headTick + lookahead());
      let arrivals = false;
      for (let tickId = headTick; tickId <= horizon && !arrivals; tickId++)
        arrivals =
          frames.current.has(tickId) ||
          inflight.current.has(tickId) ||
          !missing.current.has(tickId);

      const windowTicks = resolved.endTick - resolved.startTick + 1;
      const noData =
        frames.current.size === 0 &&
        inflight.current.size === 0 &&
        missing.current.size >= Math.min(windowTicks, PROBE_LIMIT);
      if (noData && e.playing) {
        e.playing = false;
        setPlaying(false);
      }

      // Emission throttle: boundary crossings land immediately; between
      // boundaries the glide repaints at 12 fps; an idle paused engine
      // (unchanged key) emits nothing.
      if (e.playing && nowMs - e.lastEmitAt < EMISSION_MS && headTick === e.lastHeadTick)
        return;
      const glideable =
        source !== undefined &&
        dest !== undefined &&
        dest.timeMs - source.timeMs <= GLIDE_MAX_TICKS * resolved.tickMs;
      const fraction =
        glideable && source && dest
          ? Math.max(
              0,
              Math.min(
                1,
                (e.playhead - source.timeMs) / (dest.timeMs - source.timeMs || 1),
              ),
            )
          : 0;
      const shown = source ?? dest;
      const key = `${shown?.tickId ?? -1}|${Math.round(e.playhead)}|${e.playing ? 1 : 0}|${frames.current.size}|${inflight.current.size}|${missing.current.size}`;
      if (key === e.viewKey) return;
      e.viewKey = key;
      e.lastEmitAt = nowMs;
      e.lastHeadTick = headTick;
      const cars =
        glideable && source && dest
          ? glideFleet(source.cars, dest.cars, fraction, edgeIndexById(data.edges))
          : (shown?.cars ?? []);
      setView({
        window: {
          startMs,
          endMs,
          windowTicks,
          tickMs: resolved.tickMs,
        },
        playheadMs: e.playhead,
        frameMs: source?.timeMs ?? dest?.timeMs,
        buffering: e.playing && !dest && arrivals,
        ended: !e.playing && e.playhead >= endMs && windowTicks > 1,
        noData,
        failed: false,
        loadedTicks: frames.current.size,
        missingTicks: missing.current.size,
        cars,
      });
    };

    e.lastFrameAt = performance.now();
    e.raf = requestAnimationFrame(loop);
    boot();
    return () => {
      disposed = true;
      cancelAnimationFrame(e.raf);
      controller.abort();
      bootRef.current = () => {};
      rangeControlRef.current = () => {};
    };
  }, [enabled, data]);

  const play = () => {
    const e = engine.current;
    if (!e.transport || !e.resolved) {
      bootRef.current();
      return;
    }
    const endMs = tickStartMs(e.resolved.endTick, e.resolved.tickMs);
    if (e.playhead >= endMs)
      e.playhead = tickStartMs(e.resolved.startTick, e.resolved.tickMs);
    e.playing = true;
    e.lastFrameAt = performance.now();
    setPlaying(true);
  };

  return {
    range,
    playing,
    speed,
    window: view.window,
    playheadMs: view.playheadMs,
    frameMs: view.frameMs,
    buffering: view.buffering,
    ended: view.ended,
    noData: view.noData,
    failed: view.failed,
    loadedTicks: view.loadedTicks,
    missingTicks: view.missingTicks,
    cars: view.cars,
    dwellStopsOf: (vehicleId) => {
      const resolved = engine.current.resolved;
      if (!resolved) return [];
      // Oldest → newest over the cached frames; a vehicle missing from a
      // frame simply leaves a gap the dwell grouping refuses to bridge.
      const ticks = [...frames.current.keys()].sort((a, b) => a - b);
      const samples: ReplayVehicleSample[] = [];
      for (const tickId of ticks) {
        const frame = frames.current.get(tickId);
        const vehicle = frame?.cars.find((car) => car.vehicle.id === vehicleId)?.vehicle;
        if (!vehicle) continue;
        samples.push({
          timeMs: frame.timeMs,
          latitude: vehicle.latitude,
          longitude: vehicle.longitude,
          ...(vehicle.speedMetresPerSecond !== undefined
            ? { speedMetresPerSecond: vehicle.speedMetresPerSecond }
            : {}),
          ...(vehicle.nextStopName ? { nextStopName: vehicle.nextStopName } : {}),
        });
      }
      return dwellStops(samples, resolved.tickMs);
    },
    setRange: (next) => setRange(next),
    setSpeed: (next) => setSpeed(next),
    play,
    pause: () => {
      engine.current.playing = false;
      setPlaying(false);
    },
    toggle: () => {
      if (engine.current.playing) {
        engine.current.playing = false;
        setPlaying(false);
      } else play();
    },
    seek: (ms) => {
      const e = engine.current;
      const resolved = e.resolved;
      if (!resolved) return;
      const startMs = tickStartMs(resolved.startTick, resolved.tickMs);
      const endMs = tickStartMs(resolved.endTick, resolved.tickMs);
      e.playhead = Math.max(startMs, Math.min(endMs, ms));
      e.lastHeadTick = -1; // Re-emit at the seeked position on the next frame.
      setView((current) => ({ ...current, playheadMs: e.playhead, ended: false }));
    },
  };
}
