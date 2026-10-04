import { localToMap, pointAlongEdge } from '../../../workers/shared/map-projection';
import type { PlottedVehicle } from '../../map/live-status';
import type { Edge, EdgeRef, Feature, Point, ViewerData } from '../../map/model';

export type Mode = 'arcade' | 'purist';
export type Turn = 'left' | 'straight' | 'right';
export interface Position extends EdgeRef { distance: number }
export interface Pose { point: Point; source: Point; angle: number; tangent: Point }
export interface TrailSample extends Pose { travelled: number }
export interface Mission { id: string; routeId: string; label: string; headsign: string; refs: EdgeRef[] }
export interface SwitchChoice extends EdgeRef { turn: Turn; angle: number; label: string }
const CAR_LENGTH = 30.2, SPACING = 34, LANE_OFFSET = 3;
const deltaAngle = (angle: number) => ((angle + 540) % 360) - 180;
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Collision geometry uses source metres, independent of the schematic warp. */
function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return distance(p, [a[0] + dx * t, a[1] + dy * t]);
}
function vehicleContact(player: Pose, other: Pose) {
  // Sample the lead car's body, not just its GPS-sized centre point. Swept
  // movement is stepped at <=3 m, including at fictional arcade speeds.
  const half = CAR_LENGTH / 2;
  const a: Point = [other.source[0] - other.tangent[0] * half, other.source[1] - other.tangent[1] * half];
  const b: Point = [other.source[0] + other.tangent[0] * half, other.source[1] + other.tangent[1] * half];
  for (let offset = -half; offset <= half; offset += 2) {
    if (segmentDistance([player.source[0] + player.tangent[0] * offset, player.source[1] + player.tangent[1] * offset], a, b) < 2.8) return true;
  }
  return false;
}

export function gameMissions(data: ViewerData): Mission[] {
  const paths = new Map((data.paths ?? []).map(path => [path.id, path]));
  const edges = new Map(data.edges.map(edge => [edge.id, edge]));
  const seen = new Set<string>();
  return (data.patterns ?? []).flatMap(pattern => {
    const route = data.routes.find(route => route.id === pattern.routeId && route.scheduled && !route.overnight);
    const path = pattern.pathId && paths.get(pattern.pathId);
    if (!route || !path || !path.edgeRefs?.length || path.edgeRefs.some(ref => !edges.has(ref.edgeId))) return [];
    // Reject broken sequences instead of teleporting between components.
    for (let i = 1; i < path.edgeRefs.length; i++) {
      const prev = path.edgeRefs[i - 1], next = path.edgeRefs[i];
      const a = edges.get(prev.edgeId)!, b = edges.get(next.edgeId)!;
      if ((prev.direction === 1 ? a.b : a.a) !== (next.direction === 1 ? b.a : b.b)) return [];
    }
    const key = `${route.id}:${pattern.headsign}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ id: `${route.id}:${path.id}:${pattern.headsign}`, routeId: route.id, label: `${route.number} · ${pattern.headsign}`, headsign: pattern.headsign, refs: path.edgeRefs }];
  }).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

export class SnakeEngine {
  readonly edges: Map<string, Edge>;
  readonly adjacent = new Map<string, Edge[]>();
  readonly stopsByEdge = new Map<string, Feature[]>();
  readonly sourceLengths = new Map<string, number[]>();
  status: 'ready' | 'running' | 'paused' | 'over' = 'ready';
  position: Position;
  mode: Mode = 'arcade';
  speed = 180;
  count = 1;
  travelled = 0;
  trips = 0;
  trail: TrailSample[] = [];
  collected = new Set<string>();
  queued?: Turn | string;
  message = 'Choose a mode and depart.';
  mission?: Mission;
  missionRefs: EdgeRef[] = [];
  missionIndex = -1;
  private turnGraceUntil = 0;
  private lastRecorded = -Infinity;

  constructor(readonly data: ViewerData) {
    this.edges = new Map(data.edges.filter(edge => edge.lengthMetres > .1 && edge.points.length > 1 && edge.sourcePoints.length > 1).map(edge => [edge.id, edge]));
    if (!this.edges.size) throw new Error('No playable tracks in this map.');
    for (const edge of this.edges.values()) {
      for (const node of new Set([edge.a, edge.b])) this.adjacent.set(node, [...(this.adjacent.get(node) ?? []), edge]);
      const lengths = [0];
      for (let i = 1; i < edge.sourcePoints.length; i++) lengths.push(lengths[i - 1] + distance(edge.sourcePoints[i - 1], edge.sourcePoints[i]));
      this.sourceLengths.set(edge.id, lengths);
    }
    for (const stop of data.features) if (stop.edgeId) this.stopsByEdge.set(stop.edgeId, [...(this.stopsByEdge.get(stop.edgeId) ?? []), stop]);
    const edge = [...this.edges.values()][0];
    this.position = { edgeId: edge.id, direction: 1, distance: edge.lengthMetres / 2 };
  }

  pose(position = this.position): Pose {
    const edge = this.edges.get(position.edgeId)!;
    const lengths = this.sourceLengths.get(edge.id)!;
    const d = Math.max(0, Math.min(edge.lengthMetres, position.distance)) * lengths.at(-1)! / edge.lengthMetres;
    let i = 1;
    while (i < lengths.length - 1 && lengths[i] < d) i++;
    const a = edge.sourcePoints[i - 1], b = edge.sourcePoints[i];
    const length = lengths[i] - lengths[i - 1], t = length ? (d - lengths[i - 1]) / length : 0;
    const tangent: Point = [(b[0] - a[0]) / (length || 1) * position.direction, (b[1] - a[1]) / (length || 1) * position.direction];
    const source: Point = [a[0] + (b[0] - a[0]) * t + tangent[1] * LANE_OFFSET, a[1] + (b[1] - a[1]) * t - tangent[0] * LANE_OFFSET];
    const plotted = pointAlongEdge(edge, position.distance);
    return { point: localToMap(source, this.data.geographicTransform), source, tangent, angle: plotted.angle + (position.direction === -1 ? 180 : 0) };
  }

  private livePoses(cars: PlottedVehicle[]) {
    return cars.flatMap(car => !car.stale && car.match && this.edges.has(car.match.edgeId) && !this.collected.has(car.vehicle.id)
      ? [{ car, pose: this.pose({ edgeId: car.match.edgeId, distance: car.match.distanceAlongMetres, direction: car.match.direction }) }] : []);
  }

  start(mode: Mode, cars: PlottedVehicle[], mission?: Mission, random = Math.random) {
    this.mode = mode; this.speed = mode === 'purist' ? 50 : 180;
    this.count = 1; this.travelled = 0; this.trips = 0; this.trail = []; this.collected.clear(); this.queued = undefined;
    this.mission = mission; this.missionRefs = mission?.refs.slice() ?? []; this.missionIndex = -1;
    this.turnGraceUntil = 0; this.lastRecorded = -Infinity;
    const refs = mission?.refs ?? [...this.edges.values()].filter(edge => edge.routeIds.length).map(edge => ({ edgeId: edge.id, direction: (random() < .5 ? -1 : 1) as 1 | -1 }));
    const pool = refs.length ? refs : [...this.edges.values()].map(edge => ({ edgeId: edge.id, direction: 1 as const }));
    const totalLength = pool.reduce((sum, ref) => sum + this.edges.get(ref.edgeId)!.lengthMetres, 0);
    const traffic = this.livePoses(cars);
    for (let attempt = 0; attempt < 40; attempt++) {
      let pick = random() * totalLength, index = 0;
      while (index < pool.length - 1 && pick > this.edges.get(pool[index].edgeId)!.lengthMetres) pick -= this.edges.get(pool[index++].edgeId)!.lengthMetres;
      const ref = pool[index], edge = this.edges.get(ref.edgeId)!;
      this.position = { ...ref, distance: edge.lengthMetres * (.2 + random() * .6) };
      this.missionIndex = mission ? index : -1;
      if (traffic.every(other => distance(other.pose.source, this.pose().source) > 75)) break;
    }
    this.status = 'running'; this.message = mission ? `Destination: ${mission.headsign}` : 'Follow the rails. Throw switches to explore.';
    this.record();
  }

  pause() { if (this.status === 'running') this.status = 'paused'; else if (this.status === 'paused') this.status = 'running'; }
  queue(turn: Turn | string) { this.queued = turn; }
  get remaining() {
    const edge = this.edges.get(this.position.edgeId)!;
    return this.position.direction === 1 ? edge.lengthMetres - this.position.distance : this.position.distance;
  }
  get warningDistance() { return Math.max(180, this.speed / 3.6 * 5); }

  choices(position = this.position): SwitchChoice[] {
    const current = this.edges.get(position.edgeId)!;
    const node = position.direction === 1 ? current.b : current.a;
    const arrival = this.pose({ ...position, distance: position.direction === 1 ? current.lengthMetres : 0 }).angle;
    return (this.adjacent.get(node) ?? []).filter(edge => edge.id !== current.id).map(edge => {
      const direction: 1 | -1 = edge.a === node ? 1 : -1;
      const angle = deltaAngle(this.pose({ edgeId: edge.id, direction, distance: direction === 1 ? 0 : edge.lengthMetres }).angle - arrival);
      const routes = edge.routeIds.map(id => this.data.routes.find(route => route.id === id)?.number).filter(Boolean).join('/');
      const name = edge.infrastructureIds.map(id => this.data.infrastructure.find(item => item.id === id)?.name).filter(Boolean).join(', ');
      const turn: Turn = angle < -25 ? 'left' : angle > 25 ? 'right' : 'straight';
      return { edgeId: edge.id, direction, angle, turn, label: `${turn === 'left' ? '←' : turn === 'right' ? '→' : '↑'} ${routes || name || 'Track'}` };
    }).sort((a, b) => a.angle - b.angle);
  }

  upcoming(): { choices: SwitchChoice[]; distance: number; point: Point } | undefined {
    let position = this.position, metres = this.remaining, index = this.missionIndex;
    const visited = new Set<string>();
    for (let guard = 0; guard < 250 && metres <= this.warningDistance; guard++) {
      const choices = this.choices(position), edge = this.edges.get(position.edgeId)!;
      const end = { ...position, distance: position.direction === 1 ? edge.lengthMetres : 0 };
      if (choices.length > 1) return { choices, distance: metres, point: this.pose(end).point };
      const planned = this.missionRefs[index + 1];
      const next = planned && choices.some(choice => choice.edgeId === planned.edgeId && choice.direction === planned.direction) ? planned : choices[0];
      if (!next || visited.has(`${next.edgeId}:${next.direction}`)) return;
      visited.add(`${next.edgeId}:${next.direction}`);
      index = planned?.edgeId === next.edgeId && planned.direction === next.direction ? index + 1 : -1;
      const following = this.edges.get(next.edgeId)!;
      position = { ...next, distance: next.direction === 1 ? 0 : following.lengthMetres };
      metres += following.lengthMetres;
    }
  }

  private nextRef(choices: SwitchChoice[], position = this.position, index = this.missionIndex, queued: string | null | undefined = this.queued): EdgeRef | undefined {
    if (queued) {
      const exact = choices.find(choice => choice.edgeId === queued);
      if (exact) return exact;
      const turning = choices.filter(choice => choice.turn === queued).sort((a, b) => Math.abs(a.angle) - Math.abs(b.angle));
      if (turning[0]) return turning[0];
    }
    const planned = this.missionRefs[index + 1];
    if (planned && choices.some(choice => choice.edgeId === planned.edgeId && choice.direction === planned.direction)) return planned;
    // A scheduled same-edge reversal is a turnback, not a fabricated connector.
    if (planned?.edgeId === position.edgeId && planned.direction !== position.direction) return planned;
    const current = this.edges.get(position.edgeId)!;
    return choices.slice().sort((a, b) => {
      const score = (choice: SwitchChoice) => Math.abs(choice.angle) + (this.edges.get(choice.edgeId)!.routeIds.some(id => current.routeIds.includes(id)) ? 0 : 55);
      return score(a) - score(b);
    })[0];
  }

  private crossJunction() {
    const choices = this.choices();
    const finishing = this.mission && this.missionIndex === this.missionRefs.length - 1;
    if (finishing) {
      this.trips++;
      if (this.mode === 'arcade') this.count++;
      // Reverse the SAME ordered path for the return mission. This is a game
      // turnback; it does not claim a scheduled permission to turn every edge.
      this.missionRefs = this.missionRefs.slice().reverse().map(ref => ({ ...ref, direction: ref.direction === 1 ? -1 : 1 }));
      this.missionIndex = -1;
      this.message = `Terminal reached · ${this.trips} trips · Return journey`;
    }
    const next = this.nextRef(choices) ?? { edgeId: this.position.edgeId, direction: (this.position.direction === 1 ? -1 : 1) as 1 | -1 };
    if (next.edgeId === this.position.edgeId && next.direction !== this.position.direction) this.turnGraceUntil = this.travelled + CAR_LENGTH * 2;
    const expected = this.missionRefs[this.missionIndex + 1];
    if (expected?.edgeId === next.edgeId && expected.direction === next.direction) this.missionIndex++;
    else this.missionIndex = this.missionRefs.findIndex(ref => ref.edgeId === next.edgeId && ref.direction === next.direction);
    const edge = this.edges.get(next.edgeId)!;
    this.position = { ...next, distance: next.direction === 1 ? 0 : edge.lengthMetres };
    // Hold a command through ordinary geometry nodes until an actual switch.
    if (choices.length > 1 || finishing) this.queued = undefined;
  }

  private record() {
    if (this.travelled - this.lastRecorded < 1.5) return;
    this.trail.push({ ...this.pose(), travelled: this.travelled });
    this.lastRecorded = this.travelled;
    const oldest = this.travelled - this.count * SPACING - CAR_LENGTH;
    // Do not create phantom tail cars before the head has travelled far enough.
    let remove = 0;
    while (remove < this.trail.length - 1 && this.trail[remove].travelled < oldest) remove++;
    if (remove) this.trail.splice(0, remove);
  }

  body(): TrailSample[] {
    return this.trail.filter(sample => sample.travelled >= this.travelled - (this.count - 1) * SPACING - CAR_LENGTH / 2);
  }

  carCentres(): Pose[] {
    const centres: Pose[] = [this.pose()];
    let index = this.trail.length - 1;
    for (let car = 1; car < this.count && index >= 0; car++) {
      const target = this.travelled - car * SPACING;
      while (index > 0 && this.trail[index].travelled > target) index--;
      if (this.trail[index].travelled <= target) centres.push(this.trail[index]);
    }
    return centres;
  }

  nextStop(): { name: string; metres: number } | undefined {
    let position = this.position, index = this.missionIndex, metres = 0;
    let queued: string | null | undefined = this.queued;
    const visited = new Set<string>();
    for (let guard = 0; guard < 250 && metres < 5000; guard++) {
      const stops = (this.stopsByEdge.get(position.edgeId) ?? []).flatMap(stop => {
        if (stop.edgeId !== position.edgeId || stop.distanceAlongMetres === undefined) return [];
        const ahead = (stop.distanceAlongMetres - position.distance) * position.direction;
        return ahead > 2 ? [{ name: stop.name, metres: metres + ahead }] : [];
      }).sort((a, b) => a.metres - b.metres);
      if (stops[0]) return stops[0];
      const edge = this.edges.get(position.edgeId)!, choices = this.choices(position);
      metres += position.direction === 1 ? edge.lengthMetres - position.distance : position.distance;
      const next = this.nextRef(choices, position, index, queued);
      if (!next || visited.has(`${next.edgeId}:${next.direction}`)) return;
      visited.add(`${next.edgeId}:${next.direction}`);
      if (choices.length > 1) queued = null;
      const planned = this.missionRefs[index + 1];
      index = planned?.edgeId === next.edgeId && planned.direction === next.direction ? index + 1 : -1;
      const following = this.edges.get(next.edgeId)!;
      position = { ...next, distance: next.direction === 1 ? 0 : following.lengthMetres };
    }
  }

  tick(seconds: number, cars: PlottedVehicle[], pedal = 0) {
    if (this.status !== 'running') return;
    const dt = Math.max(0, Math.min(.1, seconds));
    this.speed = Math.max(0, Math.min(this.mode === 'purist' ? 50 : 2000, this.speed + pedal * (pedal < 0 ? 300 : this.mode === 'purist' ? 20 : 180) * dt));
    let left = this.speed / 3.6 * dt;
    const traffic = this.livePoses(cars);
    for (let guard = 0; left > .00001 && guard < 250 && this.status === 'running'; guard++) {
      if (this.remaining < .00001) { this.crossJunction(); continue; }
      const step = Math.min(3, left, this.remaining);
      this.position.distance += this.position.direction * step;
      this.travelled += step; left -= step; this.record();
      const player = this.pose();
      for (const other of traffic) {
        if (this.collected.has(other.car.vehicle.id) || !vehicleContact(player, other.pose)) continue;
        if (this.mode === 'purist') { this.status = 'over'; this.message = `Collision with streetcar ${other.car.vehicle.label}. Game over.`; return; }
        this.collected.add(other.car.vehicle.id); this.count++; this.message = `Coupled streetcar ${other.car.vehicle.label} · ${this.count} cars`;
      }
      if (this.mode === 'arcade' && this.travelled > this.turnGraceUntil && this.count > 1) {
        for (const sample of this.trail) {
          const behind = this.travelled - sample.travelled;
          if (behind < CAR_LENGTH * 1.7 || behind > (this.count - 1) * SPACING + CAR_LENGTH / 2) continue;
          const front: Point = [player.source[0] + player.tangent[0] * CAR_LENGTH / 2, player.source[1] + player.tangent[1] * CAR_LENGTH / 2];
          const back: Point = [player.source[0] - player.tangent[0] * CAR_LENGTH / 2, player.source[1] - player.tangent[1] * CAR_LENGTH / 2];
          if (segmentDistance(sample.source, back, front) < 2.8) { this.status = 'over'; this.message = 'You hit your own train. Game over.'; return; }
        }
      }
    }
  }
}
