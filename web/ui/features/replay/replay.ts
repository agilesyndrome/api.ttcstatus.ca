import { pointAlongEdge } from '../../../../shared/map/projection';
import type { Edge } from '../../../../shared/map/model';
import type { PlottedVehicle } from '../../../../shared/map/live-status';

/** Replay — the TV-like re-experience of the recorder's 7-day tick archive
 * (docs/replay.md). This module is the pure presentation math: range
 * selection, tick-window resolution, Toronto day bounds, frame-clock
 * formatting and the between-frames vehicle glide. The playback engine
 * lives in useReplay.ts; the panels render it. Everything here is
 * transport-free so it tests headlessly. */

/** The R2 lifecycle expires `live/t/` objects after 7 days — replay can
 * never look further back. */
export const REPLAY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const REPLAY_SPEEDS = [1, 2, 4, 10, 30, 120, 600] as const;

/** No replay view spans more than a day: the quick ranges stop at 24 hours
 * and a picked day is one Toronto-local calendar day. Anything longer is
 * clamped here, so the engine never tries to load beyond 24 hours. */
export const REPLAY_MAX_WINDOW_MS = 24 * 3_600_000;

export type ReplayRange =
  /** The last `durationMs` of recorded time, ending at the freshest tick. */
  | { kind: 'relative'; durationMs: number }
  /** One Toronto-local calendar day, from its first tick to its last (or
   * to now when the day is today). */
  | { kind: 'day'; day: string };

/** The replay screen's focus, from a tap: solo one car (with the camera
 * following it through time) or focus one route (its cars only, the other
 * rails dimmed). */
export type ReplayFocus = { kind: 'car'; id: string } | { kind: 'route'; id: string };

export interface ReplayQuickRange {
  key: 'last30m' | 'last2h' | 'last6h' | 'last24h';
  durationMs: number;
}

export const REPLAY_QUICK_RANGES: readonly ReplayQuickRange[] = [
  { key: 'last30m', durationMs: 30 * 60_000 },
  { key: 'last2h', durationMs: 2 * 3_600_000 },
  { key: 'last6h', durationMs: 6 * 3_600_000 },
  { key: 'last24h', durationMs: REPLAY_MAX_WINDOW_MS },
];

/** Which quick range (if any) the current range matches — drives the
 * segmented control's pressed state. */
export function quickRangeKeyOf(range: ReplayRange): ReplayQuickRange['key'] | '' {
  if (range.kind !== 'relative') return '';
  const match = REPLAY_QUICK_RANGES.find(
    (quick) => quick.durationMs === range.durationMs,
  );
  return match ? match.key : '';
}

export interface ReplayWindow {
  startTick: number;
  endTick: number;
}

/** Resolve a range into a tick window on the recorder's grid: quantized so
 * the window's first and last ticks cover the range, clamped to the 7-day
 * retention horizon and to now, and never wider than one day (24 hours).
 * Returns null for a range that contains no tick at all (a day in the
 * future, or now before the grid's first tick). */
export function resolveReplayWindow(
  range: ReplayRange,
  now: number,
  tickMs: number,
): ReplayWindow | null {
  const oldestTick = Math.floor((now - REPLAY_RETENTION_MS) / tickMs);
  const currentTick = Math.floor(now / tickMs);
  let startMs: number;
  let endMs: number;
  if (range.kind === 'relative') {
    // The quick ranges stop at 24 hours; anything wider clamps here.
    startMs = now - Math.min(range.durationMs, REPLAY_MAX_WINDOW_MS);
    endMs = now;
  } else {
    const bounds = torontoDayBounds(range.day);
    startMs = bounds.startMs;
    endMs = Math.min(bounds.endMs, now);
  }
  if (endMs <= startMs) return null;
  const startTick = Math.max(oldestTick, Math.floor(startMs / tickMs));
  const endTick = Math.min(currentTick, Math.floor(endMs / tickMs));
  if (endTick < startTick) return null;
  return { startTick, endTick };
}

/** The tick's start on the wall clock — both the fetch key's meaning and
 * the "frame taken at" time the replay displays. */
export function tickStartMs(tickId: number, tickMs: number): number {
  return tickId * tickMs;
}

/** The wall-clock offset of a zone at an instant (ms east of UTC), read
 * through Intl so DST changes come from the real rules, never a table. */
function zoneOffsetMs(epochMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(epochMs);
  const field = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return (
    Date.UTC(
      field('year'),
      field('month') - 1,
      field('day'),
      field('hour'),
      field('minute'),
      field('second'),
    ) -
    Math.floor(epochMs / 1000) * 1000
  );
}

/** Epoch ms for a wall-clock time in Toronto. The guess is re-measured in
 * the zone until the correction stops moving; DST-transition instants
 * (which do not exist on the wall) settle within three passes to one of
 * their two possible epoch readings. */
function torontoWallToEpochMs(day: string, hours: number): number {
  const [year, month, date] = day.split('-').map(Number);
  const wall = Date.UTC(year, month - 1, date, hours);
  let epoch = wall;
  for (let pass = 0; pass < 3; pass++) {
    const corrected = wall - zoneOffsetMs(epoch, 'America/Toronto');
    if (corrected === epoch) break;
    epoch = corrected;
  }
  return epoch;
}

/** A Toronto-local day's [midnight, next midnight) bounds in epoch ms. */
export function torontoDayBounds(day: string): { startMs: number; endMs: number } {
  const [year, month, date] = day.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, date + 1));
  const nextDay = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  return {
    startMs: torontoWallToEpochMs(day, 0),
    endMs: torontoWallToEpochMs(nextDay, 0),
  };
}

/** The Toronto-local day string ('YYYY-MM-DD') for an instant — the date
 * input's value, min and max. */
export function torontoDayString(epochMs: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(epochMs);
}

/** The frame clock: the moment a replayed frame was taken, in Toronto time
 * — the readout every other live surface in the app uses. */
export function formatFrameClock(epochMs: number, locale = 'en-CA'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'America/Toronto',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(epochMs);
}

/** The scrubber's window-end clocks — short, Toronto time. */
export function formatScrubClock(epochMs: number, locale = 'en-CA'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'America/Toronto',
    hour: 'numeric',
    minute: '2-digit',
  }).format(epochMs);
}

/** The dwell list's clock — hour, minute, second, Toronto time. */
export function formatDwellClock(epochMs: number, locale = 'en-CA'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'America/Toronto',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(epochMs);
}

/** Shortest-arc angle interpolation — a bearing glides 350° → 10° the
 * short way round; the result stays in [0, 360). */
export function lerpAngle(from: number, to: number, fraction: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  return (((from + delta * fraction) % 360) + 360) % 360;
}

/** Map edges by id once per glide emission — the same-edge interpolation
 * samples the edge instead of searching for it per car. */
export function edgeIndexById(edges: Edge[]): Map<string, Edge> {
  return new Map(edges.map((edge) => [edge.id, edge]));
}

/** The replay car card's material: one fix per tick for a followed car. */
export interface ReplayVehicleSample {
  /** The frame's tick start — when the fix was recorded. */
  timeMs: number;
  latitude: number;
  longitude: number;
  speedMetresPerSecond?: number;
  nextStopName?: string;
}

/** One recorded stop: the span of consecutive ticks the car sat still, and
 * where. Times are the frames' tick starts — exactly what the recorder
 * wrote down. */
export interface ReplayDwellStop {
  startMs: number;
  endMs: number;
  latitude: number;
  longitude: number;
  nextStopName?: string;
}

/** Equirectangular distance between two fixes — good to a few metres at
 * city scale, which is all dwell detection needs. */
function metresBetweenFixes(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const midLatitude = ((a.latitude + b.latitude) / 2) * (Math.PI / 180);
  const north = (b.latitude - a.latitude) * 111_320;
  const east = (b.longitude - a.longitude) * 111_320 * Math.cos(midLatitude);
  return Math.hypot(north, east);
}

/** Group a followed car's tick fixes into recorded stops: consecutive
 * samples with a ~0 reported speed (or, when speeds are absent, fixes
 * within ~20 m) merge into one dwell spanning its first and last tick.
 * Runs break across frame gaps — the recorder said nothing about those
 * spans, so the card never invents a stop through an outage. */
export function dwellStops(
  samples: readonly ReplayVehicleSample[],
  tickMs: number,
): ReplayDwellStop[] {
  const STOP_SPEED = 0.5;
  const STOP_DRIFT_METRES = 20;
  const MIN_STOP_SAMPLES = 2;
  const stops: ReplayDwellStop[] = [];
  let run: ReplayVehicleSample[] = [];
  const flush = () => {
    if (run.length >= MIN_STOP_SAMPLES) {
      const first = run[0];
      const last = run[run.length - 1];
      const named = [...run]
        .reverse()
        .find((sample) => sample.nextStopName)?.nextStopName;
      stops.push({
        startMs: first.timeMs,
        endMs: last.timeMs,
        latitude: first.latitude,
        longitude: first.longitude,
        ...(named ? { nextStopName: named } : {}),
      });
    }
    run = [];
  };
  let previous: ReplayVehicleSample | undefined;
  for (const sample of samples) {
    // A gap wider than one missing tick breaks any open run — the recorder
    // said nothing about that span, so it never joins two dwells together.
    if (previous && sample.timeMs - previous.timeMs > 2 * tickMs) flush();
    const stationary =
      sample.speedMetresPerSecond !== undefined
        ? sample.speedMetresPerSecond < STOP_SPEED
        : previous !== undefined &&
          metresBetweenFixes(previous, sample) < STOP_DRIFT_METRES;
    if (stationary) {
      // When stationarity is inferred from the drift between fixes, the
      // previous fix is the arrival: the car was already at the stop when
      // the recorder saw it, so the dwell starts one tick earlier. With a
      // reported speed, the dwell starts at the first stopped tick.
      if (!run.length && previous && sample.speedMetresPerSecond === undefined)
        run.push(previous);
      run.push(sample);
    } else flush();
    previous = sample;
  }
  flush();
  return stops;
}

/** Glide the fleet between two projected tick frames at `fraction` (0 =
 * the source frame, 1 = the destination frame).
 *
 * - Same-edge track matches lerp along their shared edge (via
 *   pointAlongEdge's source-distance interpolation), so articulated bodies
 *   stay on the rail.
 * - A changed or absent match glides straight between the two projected
 *   points with the match dropped — the car body re-derives from the
 *   point, reading honestly as "between fixes" for one interval.
 * - Cars that left the feed between frames hold their position, dimmed
 *   (stale), until the boundary.
 * - Cars that joined appear from the halfway point of the glide.
 *
 * Returns new car objects — both frames stay pristine. */
export function glideFleet(
  source: readonly PlottedVehicle[],
  dest: readonly PlottedVehicle[],
  fraction: number,
  edgeById: Map<string, Edge>,
): PlottedVehicle[] {
  const destById = new Map(dest.map((car) => [car.vehicle.id, car]));
  const sourceIds = new Set(source.map((car) => car.vehicle.id));
  const glide: PlottedVehicle[] = [];
  for (const car of source) {
    const next = destById.get(car.vehicle.id);
    if (!next) {
      // Left the feed between these frames: hold, gently dimmed, until the
      // boundary removes it.
      glide.push({ ...car, stale: true });
      continue;
    }
    const match = car.match;
    const nextMatch = next.match;
    if (match && nextMatch && match.edgeId === nextMatch.edgeId) {
      const edge = edgeById.get(match.edgeId);
      if (edge) {
        const along =
          match.distanceAlongMetres +
          (nextMatch.distanceAlongMetres - match.distanceAlongMetres) * fraction;
        const sample = pointAlongEdge(edge, along);
        glide.push({
          ...car,
          point: sample.point,
          angle: sample.angle,
          match: {
            ...match,
            distanceAlongMetres: along,
            point: sample.point,
            angle: sample.angle,
          },
        });
        continue;
      }
    }
    if (match && nextMatch) {
      // The track match changed edges (an intersection or loop): glide
      // straight, match dropped — the body follows the point.
      glide.push({
        ...car,
        point: [
          car.point[0] + (next.point[0] - car.point[0]) * fraction,
          car.point[1] + (next.point[1] - car.point[1]) * fraction,
        ],
        angle: lerpAngle(car.angle, next.angle, fraction),
        match: undefined,
      });
      continue;
    }
    if (!match && !nextMatch) {
      // Off-track both sides: a plain straight-line glide.
      glide.push({
        ...car,
        point: [
          car.point[0] + (next.point[0] - car.point[0]) * fraction,
          car.point[1] + (next.point[1] - car.point[1]) * fraction,
        ],
        angle: lerpAngle(car.angle, next.angle, fraction),
      });
      continue;
    }
    // Match presence changed (a fix was found or lost between frames):
    // hold the matched placement until halfway, then hand over.
    glide.push(fraction < 0.5 ? car : { ...next });
  }
  if (fraction >= 0.5) {
    for (const car of dest) {
      if (!sourceIds.has(car.vehicle.id)) glide.push(car);
    }
  }
  return glide;
}
