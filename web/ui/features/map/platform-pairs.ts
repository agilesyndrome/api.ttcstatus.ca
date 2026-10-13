/** Stop-dot pairing (the street test): an east/west platform pair renders
 * as ONE dot until the camera is close enough to tell the two boarding
 * points apart, and a tap on a merged dot must never assume a direction —
 * the rider picks E or W from the rose. Pure geometry and names only: the
 * same truth feeds the renderer (one dot per pair) and the selection
 * semantics (merged → directionless), so the dot you see is the truth you
 * get. All distances are screen pixels — world points times camera scale.
 *
 * Names carry the pairing: nearside twins differ only by their trailing
 * platform side ("King St West at John St West Side" vs "… East Side"),
 * so the side-stripped, case-folded name is the pair key. Two stops that
 * merely share a name (a duplicated platform, 20 world units away) are
 * NOT a pair — the distance rule keeps them apart. */

import type { Feature, Point } from '../../../../shared/map/model';
import type { StopServiceState } from '../../../../shared/service/contracts';

/** Below this many screen pixels between platform dots, the pair reads as
 * one stop. Tuned for gloved taps: two dots closer than this are one blob. */
export const PLATFORM_SPLIT_PX = 12;

const SIDE_WORD = /\s+(east|west|north|south)\s+side$/i;
const norm = (name: string) => name.replace(/\s+/g, ' ').trim();

/** The pair key a stop feature names ("… at John St West Side" →
 * "… at john st"). Null never happens for real names, but empty keys
 * never pair (defensive: no two empties are twins). */
export function pairBase(name: string): string {
  return norm(name).replace(SIDE_WORD, '').toLowerCase();
}

/** A merged pair's title: the stop's own name without its platform side —
 * the intersection ("King St West at John St West Side" → "King St West at
 * John St"). */
export function intersectionTitle(name: string): string {
  return norm(name).replace(SIDE_WORD, '');
}

/** Screen-space distance between two map points at a camera scale. */
export function screenDistance(a: Point, b: Point, scale: number): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) * scale;
}

/** Whether two same-name stops read as separate dots at this scale. */
export function pairDistinguishable(a: Feature, b: Feature, scale: number): boolean {
  return screenDistance(a.point, b.point, scale) >= PLATFORM_SPLIT_PX;
}

/** The nearest same-intersection stop feature (the other side of the
 * platform pair), any distance — callers apply the zoom rule. Nearest wins
 * so a name duplicated in the source data can not widen a pair. */
export function twinFeature(
  feature: Feature,
  features: readonly Feature[],
): Feature | null {
  if (feature.kind !== 'stop') return null;
  const key = pairBase(feature.name);
  let best: Feature | null = null;
  let bestDistance = Infinity;
  for (const other of features) {
    if (other === feature || other.kind !== 'stop') continue;
    if (pairBase(other.name) !== key) continue;
    const distance = Math.hypot(
      other.point[0] - feature.point[0],
      other.point[1] - feature.point[1],
    );
    if (distance < bestDistance) {
      best = other;
      bestDistance = distance;
    }
  }
  return best;
}

export interface StopDot {
  /** The rendered (leader) feature — the pair's tap target. */
  feature: Feature;
  /** The merged-away twin at this scale, null when the dot is solo. */
  twin: Feature | null;
  /** The title/aria text: the intersection for a pair, the name solo. */
  title: string;
}

/** The dots to render at this scale: solo features pass through; a stop
 * feature pairs with its nearest same-intersection twin when their dots
 * would sit closer than PLATFORM_SPLIT_PX on screen. A feature carrying
 * both boarding points (two stopIds on one dot) never splits — it is its
 * own pair. Terminals and other kinds never pair. Order follows the input
 * (stable), so React keys and hit-testing stay deterministic. */
export function stopDots(features: readonly Feature[], scale: number): StopDot[] {
  const dots: StopDot[] = [];
  const merged = new Set<string>();
  for (const feature of features) {
    if (merged.has(feature.id)) continue;
    let twin: Feature | null = null;
    // Both boarding points on one feature: one dot, always.
    if (feature.kind === 'stop' && (feature.stopIds?.length ?? 0) < 2) {
      const candidate = twinFeature(feature, features);
      if (
        candidate &&
        !merged.has(candidate.id) &&
        !pairDistinguishable(feature, candidate, scale)
      ) {
        twin = candidate;
        merged.add(candidate.id);
      }
    }
    merged.add(feature.id);
    dots.push({
      feature,
      twin,
      title: twin ? intersectionTitle(feature.name) : feature.name,
    });
  }
  return dots;
}

/** The monitored platforms at a tapped feature's intersection: its own
 * boarding points plus the twin feature's — the candidates for the
 * direction rose, in stable stop order. */
export function intersectionPlatforms(
  feature: Feature,
  features: readonly Feature[],
  statesByStop: ReadonlyMap<string, StopServiceState>,
): StopServiceState[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (stopIds?: readonly string[]) => {
    for (const id of stopIds ?? [])
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
  };
  add(feature.stopIds);
  if (feature.kind === 'stop') {
    const key = pairBase(feature.name);
    for (const other of features)
      if (other !== feature && other.kind === 'stop' && pairBase(other.name) === key)
        add(other.stopIds);
  }
  return ids
    .map((id) => statesByStop.get(id))
    .filter((state): state is StopServiceState => state !== undefined);
}
