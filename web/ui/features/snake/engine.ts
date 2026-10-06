import { english } from '../../../../shared/i18n/messages';
import { t } from '../../i18n';
import { localToMap, mapToGps, pointAlongEdge } from '../../../../shared/map/projection';
import type { PlottedVehicle } from '../../../../shared/map/live-status';
import type {
  Edge,
  EdgeRef,
  Feature,
  Point,
  ViewerData,
} from '../../../../shared/map/model';

export type Mode = 'arcade' | 'purist';
export type Turn = 'left' | 'straight' | 'right';
export interface Position extends EdgeRef {
  distance: number;
}
export interface Pose {
  position: Position;
  point: Point;
  source: Point;
  angle: number;
  tangent: Point;
  turnbackId?: string;
}
export interface TrailSample extends Pose {
  travelled: number;
}
export interface Mission {
  id: string;
  routeId: string;
  label: string;
  headsign: string;
  refs: EdgeRef[];
}
export interface SwitchChoice extends EdgeRef {
  turn: Turn;
  angle: number;
  label: string;
}
export interface Pedals {
  accelerator: boolean;
  brake: boolean;
}
interface Turnback {
  id: string;
  samples: { source: Point; distance: number; tangent: Point }[];
  length: number;
  distance: number;
}
export interface UpcomingSwitch {
  choices: SwitchChoice[];
  selected: SwitchChoice;
  manual: boolean;
  distance: number;
  point: Point;
  position: Position;
  missionIndex: number;
  nodeId: string;
}
const CAR_LENGTH = 30.2,
  SPACING = CAR_LENGTH + 1.5,
  LANE_OFFSET = 3.2,
  GAME_TRAFFIC_COUNT = 8,
  GAME_TARGET_SECONDS = 6.5,
  GAME_TARGET_MIN_DISTANCE = 85,
  GAME_TARGET_MAX_DISTANCE = 210,
  GAME_TRAFFIC_COVERAGE_SECONDS = 7,
  GAME_TRAFFIC_RESPAWN_DELAY = 3.5,
  GAME_RANDOM_MIN_AHEAD = 260,
  GAME_RANDOM_MIN_SPACING = 250,
  GAME_CAR_PREFIX = 'snake-v2-';
const deltaAngle = (angle: number) => ((angle + 540) % 360) - 180;
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

interface RailSpan extends EdgeRef {
  from: number;
  to: number;
}
// Each graph edge represents TWO directional rails. Compare occupancy in
// source metres on the same rail, rather than extending tangents across bends
// and accidentally hitting the parallel return track or unrelated crossings.
const sameRail = (a: EdgeRef, b: EdgeRef) =>
  a.edgeId === b.edgeId && a.direction === b.direction;
const spansOverlap = (a: RailSpan, b: RailSpan) =>
  sameRail(a, b) && a.from <= b.to && b.from <= a.to;

export function gameMissions(data: ViewerData): Mission[] {
  const paths = new Map((data.paths ?? []).map((path) => [path.id, path]));
  const edges = new Map(data.edges.map((edge) => [edge.id, edge]));
  const seen = new Set<string>();
  return (data.patterns ?? [])
    .flatMap((pattern) => {
      const route = data.routes.find(
        (route) => route.id === pattern.routeId && route.scheduled && !route.overnight,
      );
      const path = pattern.pathId && paths.get(pattern.pathId);
      if (
        !route ||
        !path ||
        !path.edgeRefs?.length ||
        path.edgeRefs.some((ref) => !edges.has(ref.edgeId))
      )
        return [];
      // Reject broken sequences instead of teleporting between components.
      for (let i = 1; i < path.edgeRefs.length; i++) {
        const prev = path.edgeRefs[i - 1],
          next = path.edgeRefs[i];
        const a = edges.get(prev.edgeId)!,
          b = edges.get(next.edgeId)!;
        if ((prev.direction === 1 ? a.b : a.a) !== (next.direction === 1 ? b.a : b.b))
          return [];
      }
      const key = `${route.id}:${pattern.headsign}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        {
          id: `${route.id}:${path.id}:${pattern.headsign}`,
          routeId: route.id,
          label: `${route.number} · ${pattern.headsign}`,
          headsign: pattern.headsign,
          refs: path.edgeRefs,
        },
      ];
    })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

export class SnakeEngine {
  readonly edges: Map<string, Edge>;
  readonly adjacent = new Map<string, Edge[]>();
  readonly stopsByEdge = new Map<string, Feature[]>();
  readonly sourceLengths = new Map<string, number[]>();
  readonly terminals = new Map<string, { name: string; radius: number }>();
  readonly routeNumbers: Map<string, string>;
  readonly infrastructureNames: Map<string, string>;
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
  message = english('snake.chooseAModeAndDepart');
  mission?: Mission;
  missionRefs: EdgeRef[] = [];
  missionIndex = -1;
  gameCars: PlottedVehicle[] = [];
  private turnGraceUntil = 0;
  private lastRecorded = -Infinity;
  private turnback?: Turnback;
  private random = Math.random;
  private gameCarSerial = 0;
  private guaranteedGameCarId?: string;
  private gameTrafficCooldown = 0;
  private trafficRevision = 0;
  private trafficInput?: {
    source: PlottedVehicle[];
    revision: number;
    cars: PlottedVehicle[];
  };
  private trafficCache?: {
    cars: PlottedVehicle[];
    poses: { car: PlottedVehicle; pose: Pose; spans: RailSpan[] }[];
  };

  constructor(
    readonly data: ViewerData,
    readonly options: { easySwitches?: boolean; gameTraffic?: boolean } = {},
  ) {
    this.routeNumbers = new Map(data.routes.map((route) => [route.id, route.number]));
    this.infrastructureNames = new Map(
      data.infrastructure.map((item) => [item.id, item.name]),
    );
    this.edges = new Map(
      data.edges
        .filter(
          (edge) =>
            edge.lengthMetres > 0.1 &&
            edge.points.length > 1 &&
            edge.sourcePoints.length > 1,
        )
        .map((edge) => [edge.id, edge]),
    );
    if (!this.edges.size) throw new Error(english('snake.noPlayableTracksInThisMap'));
    for (const edge of this.edges.values()) {
      for (const node of new Set([edge.a, edge.b]))
        this.adjacent.set(node, [...(this.adjacent.get(node) ?? []), edge]);
      const lengths = [0];
      for (let i = 1; i < edge.sourcePoints.length; i++)
        lengths.push(
          lengths[i - 1] + distance(edge.sourcePoints[i - 1], edge.sourcePoints[i]),
        );
      this.sourceLengths.set(edge.id, lengths);
    }
    for (const stop of data.features)
      if (stop.edgeId)
        this.stopsByEdge.set(stop.edgeId, [
          ...(this.stopsByEdge.get(stop.edgeId) ?? []),
          stop,
        ]);
    const nodes = [...this.adjacent.keys()].map((id) => {
      const edge = this.adjacent.get(id)![0];
      return {
        id,
        source: edge.a === id ? edge.sourcePoints[0] : edge.sourcePoints.at(-1)!,
      };
    });
    for (const terminal of data.features.filter(
      (feature) => feature.kind === 'terminal',
    )) {
      const gps = mapToGps(terminal.point, data.geographicTransform),
        projection = data.geographicTransform.projection;
      const source: Point = [
        (gps.longitude - projection.longitude) * projection.metresPerLongitudeDegree,
        (gps.latitude - projection.latitude) * projection.metresPerLatitudeDegree,
      ];
      const nearest = nodes
        .slice()
        .sort((a, b) => distance(a.source, source) - distance(b.source, source))[0];
      if (nearest && distance(nearest.source, source) <= 100)
        this.terminals.set(nearest.id, {
          name: terminal.name,
          radius: /union/i.test(terminal.name)
            ? 18
            : /spadina|main street|broadview|st clair/i.test(terminal.name)
              ? 15
              : /station/i.test(terminal.name)
                ? 14
                : /carhouse|yard/i.test(terminal.name)
                  ? 10
                  : 12,
        });
    }
    const edge = [...this.edges.values()][0];
    this.position = { edgeId: edge.id, direction: 1, distance: edge.lengthMetres / 2 };
  }

  pose(position = this.position): Pose {
    if (this.turnback && position === this.position)
      return this.turnbackPose(this.turnback, this.turnback.distance, position);
    const edge = this.edges.get(position.edgeId)!;
    const lengths = this.sourceLengths.get(edge.id)!;
    const d =
      (Math.max(0, Math.min(edge.lengthMetres, position.distance)) * lengths.at(-1)!) /
      edge.lengthMetres;
    let i = 1;
    while (i < lengths.length - 1 && lengths[i] < d) i++;
    const a = edge.sourcePoints[i - 1],
      b = edge.sourcePoints[i];
    const length = lengths[i] - lengths[i - 1],
      t = length ? (d - lengths[i - 1]) / length : 0;
    const tangent: Point = [
      ((b[0] - a[0]) / (length || 1)) * position.direction,
      ((b[1] - a[1]) / (length || 1)) * position.direction,
    ];
    const source: Point = [
      a[0] + (b[0] - a[0]) * t + tangent[1] * LANE_OFFSET,
      a[1] + (b[1] - a[1]) * t - tangent[0] * LANE_OFFSET,
    ];
    const plotted = pointAlongEdge(edge, position.distance);
    return {
      position: { ...position },
      point: localToMap(source, this.data.geographicTransform),
      source,
      tangent,
      angle: plotted.angle + (position.direction === -1 ? 180 : 0),
    };
  }

  private trafficCars(cars: PlottedVehicle[]) {
    if (
      !this.trafficInput ||
      this.trafficInput.source !== cars ||
      this.trafficInput.revision !== this.trafficRevision
    ) {
      this.trafficInput = {
        source: cars,
        revision: this.trafficRevision,
        cars: [...cars, ...this.gameCars],
      };
    }
    return this.trafficInput.cars;
  }

  private invalidateTraffic() {
    this.trafficRevision++;
    this.trafficInput = undefined;
  }

  private livePoses(cars: PlottedVehicle[]) {
    const input = this.trafficCars(cars);
    if (this.trafficCache?.cars !== input) {
      this.trafficCache = {
        cars: input,
        poses: input.flatMap((car) =>
          !car.stale && car.match && this.edges.has(car.match.edgeId)
            ? [
                {
                  car,
                  pose: this.pose({
                    edgeId: car.match.edgeId,
                    distance: car.match.distanceAlongMetres,
                    direction: car.match.direction,
                  }),
                  spans: this.vehicleSpans(
                    {
                      edgeId: car.match.edgeId,
                      distance: car.match.distanceAlongMetres,
                      direction: car.match.direction,
                    },
                    car.vehicle.routeId,
                  ),
                },
              ]
            : [],
        ),
      };
    }
    return this.trafficCache.poses.filter(
      (other) => !this.collected.has(other.car.vehicle.id),
    );
  }

  private targetDistance() {
    return Math.max(
      GAME_TARGET_MIN_DISTANCE,
      Math.min(GAME_TARGET_MAX_DISTANCE, (this.speed / 3.6) * GAME_TARGET_SECONDS),
    );
  }

  private coverageDistance() {
    return Math.max(
      GAME_TARGET_MAX_DISTANCE,
      (this.speed / 3.6) * GAME_TRAFFIC_COVERAGE_SECONDS,
    );
  }

  private trafficAhead(car: PlottedVehicle): number | undefined {
    if (car.stale || !car.match || !this.edges.has(car.match.edgeId)) return;
    return this.distanceAhead({
      edgeId: car.match.edgeId,
      direction: car.match.direction,
      distance: car.match.distanceAlongMetres,
    });
  }

  private gameCarAhead(maxDistance: number) {
    return this.gameCars.find((car) => {
      const ahead = this.trafficAhead(car);
      return ahead !== undefined && ahead >= -0.00001 && ahead <= maxDistance;
    });
  }

  private hasTrafficAhead(cars: PlottedVehicle[], maxDistance: number) {
    return [...cars, ...this.gameCars].some((car) => {
      const ahead = this.trafficAhead(car);
      return ahead !== undefined && ahead >= -0.00001 && ahead <= maxDistance;
    });
  }

  private positionAhead(metres: number, strict = false): Position | undefined {
    let position = { ...this.position },
      index = this.missionIndex,
      remaining = Math.max(0, metres + this.turnbackRemaining),
      refs = this.missionRefs;
    let queued: string | null | undefined = this.queued;
    const visited = new Set<string>();
    for (let guard = 0; guard < 2500; guard++) {
      const edge = this.edges.get(position.edgeId)!,
        available =
          position.direction === 1
            ? edge.lengthMetres - position.distance
            : position.distance;
      if (remaining <= available + 0.00001)
        return {
          ...position,
          distance: position.distance + position.direction * remaining,
        };
      remaining -= available;
      if (this.mission && index === refs.length - 1) {
        refs = refs
          .slice()
          .reverse()
          .map((ref) => ({ ...ref, direction: ref.direction === 1 ? -1 : 1 }));
        index = -1;
        queued = null;
      }
      const choices = this.choices(position),
        next = this.nextRef(choices, position, index, queued, refs);
      if (!next || visited.has(`${next.edgeId}:${next.direction}`)) {
        if (strict) return;
        return {
          ...position,
          distance:
            position.direction === 1
              ? Math.max(0, edge.lengthMetres - 8)
              : Math.min(edge.lengthMetres, 8),
        };
      }
      visited.add(`${next.edgeId}:${next.direction}`);
      index = this.indexAfter(next, index, refs);
      if (choices.length > 1) queued = null;
      const following = this.edges.get(next.edgeId)!;
      position = {
        ...next,
        distance: next.direction === 1 ? 0 : following.lengthMetres,
      };
    }
  }

  private distanceAhead(target: Position): number | undefined {
    let position = { ...this.position },
      index = this.missionIndex,
      metres = this.turnbackRemaining,
      refs = this.missionRefs;
    let queued: string | null | undefined = this.queued;
    const visited = new Set<string>();
    for (let guard = 0; guard < 2500; guard++) {
      const edge = this.edges.get(position.edgeId)!;
      if (sameRail(position, target)) {
        const ahead = (target.distance - position.distance) * position.direction;
        if (ahead >= -0.00001) return metres + ahead;
        return;
      }
      metres +=
        position.direction === 1
          ? edge.lengthMetres - position.distance
          : position.distance;
      if (this.mission && index === refs.length - 1) {
        refs = refs
          .slice()
          .reverse()
          .map((ref) => ({ ...ref, direction: ref.direction === 1 ? -1 : 1 }));
        index = -1;
        queued = null;
      }
      const choices = this.choices(position),
        next = this.nextRef(choices, position, index, queued, refs);
      if (!next || visited.has(`${next.edgeId}:${next.direction}`)) return;
      visited.add(`${next.edgeId}:${next.direction}`);
      index = this.indexAfter(next, index, refs);
      if (choices.length > 1) queued = null;
      const following = this.edges.get(next.edgeId)!;
      position = {
        ...next,
        distance: next.direction === 1 ? 0 : following.lengthMetres,
      };
    }
  }

  private makeGameCar(position: Position): PlottedVehicle {
    const pose = this.pose(position),
      gps = mapToGps(pose.point, this.data.geographicTransform),
      edge = this.edges.get(position.edgeId)!,
      number = edge.routeIds.map((id) => this.routeNumbers.get(id) ?? id)[0] ?? 'TTC',
      id = `${GAME_CAR_PREFIX}${++this.gameCarSerial}`;
    return {
      vehicle: {
        id,
        label: `${number} · ${this.gameCarSerial}`,
        mode: 'streetcar',
        positionKind: 'gps',
        latitude: gps.latitude,
        longitude: gps.longitude,
        routeId: edge.routeIds[0],
        observedAt: new Date().toISOString(),
      },
      point: pose.point,
      angle: pose.angle,
      match: {
        edgeId: position.edgeId,
        distanceAlongMetres: position.distance,
        distanceFromTrackMetres: 0,
        direction: position.direction,
        point: pose.point,
        angle: pose.angle,
      },
      stale: false,
    };
  }

  private addGameCar(position: Position, guaranteed = false) {
    const car = this.makeGameCar(position);
    this.gameCars = [...this.gameCars, car];
    if (guaranteed) this.guaranteedGameCarId = car.vehicle.id;
    this.invalidateTraffic();
  }

  private removeGameCar(id: string) {
    const next = this.gameCars.filter((car) => car.vehicle.id !== id);
    if (next.length === this.gameCars.length) return;
    this.gameCars = next;
    if (this.guaranteedGameCarId === id) this.guaranteedGameCarId = undefined;
    this.invalidateTraffic();
  }

  private gamePositionSafe(position: Position): boolean {
    const samePlayerRail = sameRail(position, this.position),
      ahead = this.distanceAhead(position);
    // Keep the near-term route clear.  The pace car is the one deliberate
    // exception: it is placed by positionAhead() and is meant to be caught.
    if (samePlayerRail && (ahead === undefined || ahead < GAME_RANDOM_MIN_AHEAD))
      return false;
    if (
      this.gameCars.some((car) => {
        if (!car.match) return false;
        const other: Position = {
          edgeId: car.match.edgeId,
          direction: car.match.direction,
          distance: car.match.distanceAlongMetres,
        };
        return (
          sameRail(other, position) &&
          Math.abs(other.distance - position.distance) < GAME_RANDOM_MIN_SPACING
        );
      })
    )
      return false;
    // Different graph edges are not collision-compatible, so their map-space
    // proximity is harmless.  This also lets the small fixture and tight
    // downtown track pairs carry a useful background fleet.
    return true;
  }

  private randomGamePosition(): Position | undefined {
    const candidates = [...this.edges.values()].filter(
      (edge) =>
        edge.lengthMetres >= 60 &&
        (edge.routeIds.length || edge.infrastructureIds.length),
    );
    const pool = candidates.length ? candidates : [...this.edges.values()],
      player = this.pose();
    for (let attempt = 0; attempt < 80; attempt++) {
      const edge = pool[Math.floor(this.random() * pool.length)],
        position: Position = {
          edgeId: edge.id,
          direction: this.random() < 0.5 ? -1 : 1,
          distance: edge.lengthMetres * (0.1 + this.random() * 0.8),
        },
        pose = this.pose(position);
      if (distance(player.source, pose.source) < 180 && sameRail(position, this.position))
        continue;
      if (this.gamePositionSafe(position)) return position;
    }
    // Never fall back to the first edge: doing so used to spawn eight cars on
    // top of one another, then replace all eight every simulation tick.
    for (const edge of pool)
      for (const direction of [1, -1] as const)
        for (const fraction of [0.15, 0.35, 0.55, 0.75, 0.9]) {
          const position: Position = {
            edgeId: edge.id,
            direction,
            distance: edge.lengthMetres * fraction,
          };
          if (this.gamePositionSafe(position)) return position;
        }
    return undefined;
  }

  private maintainGameTraffic(cars: PlottedVehicle[] = [], seed = false) {
    if (!this.options.gameTraffic || this.status !== 'running') return;
    const target = this.guaranteedGameCarId
      ? this.gameCars.find((car) => car.vehicle.id === this.guaranteedGameCarId)
      : undefined;
    const targetAhead = target ? this.trafficAhead(target) : undefined;
    if (target && targetAhead === undefined) {
      this.removeGameCar(target.vehicle.id);
    }
    if (!this.guaranteedGameCarId) {
      const existing = this.gameCarAhead(this.coverageDistance());
      if (existing) this.guaranteedGameCarId = existing.vehicle.id;
      else if (
        !this.hasTrafficAhead(cars, this.coverageDistance()) &&
        (seed || this.gameTrafficCooldown <= 0)
      ) {
        const position = this.positionAhead(this.targetDistance(), true);
        if (position) {
          this.addGameCar(position, true);
          if (!seed) this.gameTrafficCooldown = GAME_TRAFFIC_RESPAWN_DELAY;
        }
      }
    }
    if (
      this.gameCars.length >= GAME_TRAFFIC_COUNT ||
      (!seed && this.gameTrafficCooldown > 0)
    )
      return;
    if (seed) {
      while (this.gameCars.length < GAME_TRAFFIC_COUNT) {
        const position = this.randomGamePosition();
        if (!position) break;
        this.addGameCar(position);
      }
      return;
    }
    const position = this.randomGamePosition();
    if (position) {
      this.addGameCar(position);
      this.gameTrafficCooldown = GAME_TRAFFIC_RESPAWN_DELAY;
    }
  }

  start(mode: Mode, cars: PlottedVehicle[], mission?: Mission, random = Math.random) {
    this.mode = mode;
    this.speed = mode === 'purist' ? 50 : 180;
    this.count = 1;
    this.travelled = 0;
    this.trips = 0;
    this.trail = [];
    this.collected.clear();
    this.queued = undefined;
    this.mission = mission;
    this.missionRefs = mission?.refs.slice() ?? [];
    this.missionIndex = -1;
    this.turnGraceUntil = 0;
    this.lastRecorded = -Infinity;
    this.turnback = undefined;
    this.random = random;
    this.gameCars = [];
    this.guaranteedGameCarId = undefined;
    this.gameCarSerial = 0;
    this.gameTrafficCooldown = 0;
    this.invalidateTraffic();
    const refs =
      mission?.refs ??
      [...this.edges.values()]
        .filter((edge) => edge.routeIds.length)
        .map((edge) => ({
          edgeId: edge.id,
          direction: (random() < 0.5 ? -1 : 1) as 1 | -1,
        }));
    const pool = refs.length
      ? refs
      : [...this.edges.values()].map((edge) => ({
          edgeId: edge.id,
          direction: 1 as const,
        }));
    const totalLength = pool.reduce(
      (sum, ref) => sum + this.edges.get(ref.edgeId)!.lengthMetres,
      0,
    );
    const traffic = this.livePoses(cars);
    for (let attempt = 0; attempt < 40; attempt++) {
      let pick = random() * totalLength,
        index = 0;
      while (
        index < pool.length - 1 &&
        pick > this.edges.get(pool[index].edgeId)!.lengthMetres
      )
        pick -= this.edges.get(pool[index++].edgeId)!.lengthMetres;
      const ref = pool[index],
        edge = this.edges.get(ref.edgeId)!;
      this.position = { ...ref, distance: edge.lengthMetres * (0.2 + random() * 0.6) };
      this.missionIndex = mission ? index : -1;
      if (traffic.every((other) => distance(other.pose.source, this.pose().source) > 75))
        break;
    }
    this.status = 'running';
    this.message = mission
      ? t('snake.destinationValue', { value1: mission.headsign })
      : t('snake.followTheRailsThrowSwitchesToExplore');
    this.maintainGameTraffic(cars, true);
    this.gameTrafficCooldown = GAME_TRAFFIC_RESPAWN_DELAY;
    this.record();
  }

  pause() {
    if (this.status === 'running') this.status = 'paused';
    else if (this.status === 'paused') this.status = 'running';
  }
  queue(turn: Turn | string) {
    const upcoming = this.upcoming();
    this.queued =
      upcoming && ['left', 'right', 'straight'].includes(turn)
        ? this.intentChoice(upcoming.choices, turn as Turn).edgeId
        : turn;
  }
  get turningAround() {
    return Boolean(this.turnback);
  }
  get turnbackRemaining() {
    return this.turnback ? this.turnback.length - this.turnback.distance : 0;
  }
  get destination() {
    if (!this.mission) return '';
    const ref = this.missionRefs.at(-1)!,
      edge = this.edges.get(ref.edgeId)!;
    const node = ref.direction === 1 ? edge.b : edge.a;
    if (this.terminals.has(node)) return this.terminals.get(node)!.name;
    const point = ref.direction === 1 ? edge.points.at(-1)! : edge.points[0];
    return (
      this.data.features
        .slice()
        .sort((a, b) => distance(a.point, point) - distance(b.point, point))[0]?.name ??
      this.mission.headsign
    );
  }
  get remaining() {
    const edge = this.edges.get(this.position.edgeId)!;
    return this.position.direction === 1
      ? edge.lengthMetres - this.position.distance
      : this.position.distance;
  }
  get warningDistance() {
    return this.options.easySwitches
      ? Math.max(400, Math.min(4000, (this.speed / 3.6) * 6))
      : Math.max(230, Math.min(1400, (this.speed / 3.6) * 4.5));
  }

  choices(position = this.position): SwitchChoice[] {
    const current = this.edges.get(position.edgeId)!;
    const node = position.direction === 1 ? current.b : current.a;
    const arrival = this.pose({
      ...position,
      distance: position.direction === 1 ? current.lengthMetres : 0,
    }).angle;
    return (this.adjacent.get(node) ?? [])
      .filter((edge) => edge.id !== current.id || edge.a === edge.b)
      .map((edge) => {
        // A closed edge returns to its own node on the same rail. Continuing it
        // is a lap, not a same-edge reversal onto the opposite rail.
        const direction: 1 | -1 =
          edge.id === current.id ? position.direction : edge.a === node ? 1 : -1;
        const angle = deltaAngle(
          this.pose({
            edgeId: edge.id,
            direction,
            distance: direction === 1 ? 0 : edge.lengthMetres,
          }).angle - arrival,
        );
        const routes = edge.routeIds
          .map((id) => this.routeNumbers.get(id))
          .filter(Boolean)
          .join('/');
        const name = edge.infrastructureIds
          .map((id) => this.infrastructureNames.get(id))
          .filter(Boolean)
          .join(', ');
        const turn: Turn = angle < -24.1 ? 'left' : angle > 24.1 ? 'right' : 'straight';
        return {
          edgeId: edge.id,
          direction,
          angle,
          turn,
          label: `${turn === 'left' ? t('snake.left') : turn === 'right' ? t('snake.right') : t('snake.straight')} · ${routes || name || t('snake.track')}`,
        };
      })
      .sort((a, b) => a.angle - b.angle);
  }

  upcoming(): UpcomingSwitch | undefined {
    if (this.turnback) return;
    let position = this.position,
      metres = this.remaining,
      index = this.missionIndex;
    const visited = new Set<string>();
    for (let guard = 0; guard < 250 && metres <= this.warningDistance; guard++) {
      const choices = this.choices(position),
        edge = this.edges.get(position.edgeId)!;
      const end = {
        ...position,
        distance: position.direction === 1 ? edge.lengthMetres : 0,
      };
      if (this.mission && index === this.missionRefs.length - 1) return;
      const selected = this.nextRef(choices, position, index);
      if (
        choices.length > 1 &&
        selected &&
        choices.some((choice) => sameRail(choice, selected))
      )
        return {
          choices,
          selected: choices.find((choice) => sameRail(choice, selected))!,
          manual: Boolean(
            this.queued &&
            (['left', 'right', 'straight'].includes(this.queued) ||
              choices.some((choice) => choice.edgeId === this.queued)),
          ),
          distance: metres,
          point: this.pose(end).point,
          position: end,
          missionIndex: index,
          nodeId: position.direction === 1 ? edge.b : edge.a,
        };
      const next = selected;
      if (!next || visited.has(`${next.edgeId}:${next.direction}`)) return;
      visited.add(`${next.edgeId}:${next.direction}`);
      index = this.indexAfter(next, index);
      const following = this.edges.get(next.edgeId)!;
      position = { ...next, distance: next.direction === 1 ? 0 : following.lengthMetres };
      metres += following.lengthMetres;
    }
  }

  private intentChoice(choices: SwitchChoice[], turn: Turn): SwitchChoice {
    // Like the original: left/right pick the outermost available branch;
    // straight picks the smallest turn, even when every branch curves.
    return choices
      .slice()
      .sort((a, b) =>
        turn === 'left'
          ? a.angle - b.angle
          : turn === 'right'
            ? b.angle - a.angle
            : Math.abs(a.angle) - Math.abs(b.angle),
      )[0];
  }

  private indexAfter(next: EdgeRef, index: number, refs = this.missionRefs) {
    return refs[index + 1] && sameRail(next, refs[index + 1])
      ? index + 1
      : refs.findIndex((ref) => sameRail(next, ref));
  }

  private nextRef(
    choices: SwitchChoice[],
    position = this.position,
    index = this.missionIndex,
    queued: string | null | undefined = this.queued,
    refs = this.missionRefs,
  ): EdgeRef | undefined {
    if (this.mission && index === refs.length - 1)
      return { edgeId: position.edgeId, direction: position.direction === 1 ? -1 : 1 };
    if (queued && choices.length > 1) {
      const exact = choices.find((choice) => choice.edgeId === queued);
      if (exact) return exact;
      if (['left', 'right', 'straight'].includes(queued))
        return this.intentChoice(choices, queued as Turn);
    }
    const planned = refs[index + 1];
    if (
      planned &&
      choices.some(
        (choice) =>
          choice.edgeId === planned.edgeId && choice.direction === planned.direction,
      )
    )
      return planned;
    // A scheduled same-edge reversal is a turnback, not a fabricated connector.
    if (planned?.edgeId === position.edgeId && planned.direction !== position.direction)
      return planned;
    const current = this.edges.get(position.edgeId)!;
    const routeKeys = (edge: Edge) =>
      new Set(
        edge.routeIds.flatMap((id) => {
          const number = this.routeNumbers.get(id) ?? id;
          return [
            number,
            number.replace(/[A-Z]$/, ''),
            /^3\d\d$/.test(number) ? String(Number(number) + 200) : number,
          ];
        }),
      );
    const keys = routeKeys(current),
      missionKeys = this.mission
        ? routeKeys({ ...current, routeIds: [this.mission.routeId] })
        : new Set<string>();
    const score = (choice: SwitchChoice) => {
      const next = this.edges.get(choice.edgeId)!;
      const nextKeys = routeKeys(next),
        shared = [...nextKeys].filter((key) => keys.has(key)).length;
      const infrastructure = next.infrastructureIds
        .map((id) => this.infrastructureNames.get(id) ?? id)
        .join(' ');
      const yard = /yard|carhouse|barns|hillcrest|shop/i.test(infrastructure);
      const diversion = !next.routeIds.length && current.routeIds.length > 0;
      const missionBonus = [...nextKeys].some((key) => missionKeys.has(key)) ? 1.4 : 0;
      return (
        -Math.cos((choice.angle * Math.PI) / 180) -
        Math.min(5.5, shared * 2.4) -
        missionBonus +
        (yard ? 3.5 : diversion ? 1.2 : 0)
      );
    };
    return choices.slice().sort((a, b) => score(a) - score(b))[0];
  }

  private railSpans(
    position: Position,
    forward: boolean,
    routeId?: string,
    player = false,
  ): RailSpan[] {
    let cursor = {
      ...position,
      direction: (forward ? position.direction : -position.direction) as 1 | -1,
    };
    let remaining = CAR_LENGTH / 2,
      index = this.missionIndex;
    let queued: string | null | undefined = this.queued;
    const spans: RailSpan[] = [];
    for (let guard = 0; remaining > 0.00001 && guard < 250; guard++) {
      const edge = this.edges.get(cursor.edgeId)!;
      const available =
        cursor.direction === 1 ? edge.lengthMetres - cursor.distance : cursor.distance;
      const step = Math.min(remaining, available),
        end = cursor.distance + cursor.direction * step;
      spans.push({
        edgeId: edge.id,
        direction: forward ? cursor.direction : cursor.direction === 1 ? -1 : 1,
        from: Math.min(cursor.distance, end),
        to: Math.max(cursor.distance, end),
      });
      remaining -= step;
      if (remaining <= 0.00001) break;
      const choices = this.choices(cursor);
      let next: EdgeRef | undefined;
      if (player && forward) {
        // At a mission terminal the front follows the same turnback as the
        // simulation, instead of forecasting a different branch at the node.
        next =
          this.mission && index === this.missionRefs.length - 1
            ? { edgeId: cursor.edgeId, direction: cursor.direction === 1 ? -1 : 1 }
            : (this.nextRef(choices, cursor, index, queued) ?? {
                edgeId: cursor.edgeId,
                direction: cursor.direction === 1 ? -1 : 1,
              });
      } else if (player) {
        // The rear must follow the switch actually taken, not today's queued
        // choice or the straightest branch behind the car.
        const boundary = this.travelled - (CAR_LENGTH / 2 - remaining);
        for (let i = this.trail.length - 1; i >= 0; i--) {
          const sample = this.trail[i];
          if (sample.travelled < this.travelled - CAR_LENGTH / 2) break;
          if (sample.travelled <= boundary && sample.turnbackId) return spans;
          if (
            sample.travelled <= boundary &&
            sample.position.edgeId !== cursor.edgeId &&
            choices.some(
              (choice) =>
                choice.edgeId === sample.position.edgeId &&
                choice.direction === -sample.position.direction,
            )
          ) {
            next = {
              edgeId: sample.position.edgeId,
              direction: sample.position.direction === 1 ? -1 : 1,
            };
            break;
          }
        }
      }
      if (!next && (!player || !forward)) {
        next = choices.slice().sort((a, b) => {
          const score = (choice: SwitchChoice) =>
            Math.abs(choice.angle) +
            (this.edges
              .get(choice.edgeId)!
              .routeIds.some((id) =>
                routeId ? id === routeId : edge.routeIds.includes(id),
              )
              ? 0
              : 55);
          return score(a) - score(b);
        })[0];
      }
      if (!next) break;
      // A car entering the synthetic loop has no body on its opposite rail
      // until it has actually travelled through the connector.
      if (next.edgeId === cursor.edgeId && next.direction !== cursor.direction) break;
      index = this.indexAfter(next, index);
      if (choices.length > 1) queued = null;
      const following = this.edges.get(next.edgeId)!;
      cursor = { ...next, distance: next.direction === 1 ? 0 : following.lengthMetres };
    }
    return spans;
  }

  private vehicleSpans(position: Position, routeId?: string, player = false): RailSpan[] {
    if (player && this.turnback) return [];
    return [
      ...this.railSpans(position, true, routeId, player),
      ...this.railSpans(position, false, routeId, player),
    ];
  }

  private buildTurnback(incoming: Position, outgoing: Position): Turnback {
    const start = this.pose({ ...incoming }),
      end = this.pose({ ...outgoing });
    const edge = this.edges.get(incoming.edgeId)!,
      node = incoming.direction === 1 ? edge.b : edge.a;
    const radius = this.terminals.get(node)?.radius ?? 10;
    const p0 = start.source,
      p3 = end.source;
    const p1: Point = [
      p0[0] + start.tangent[0] * radius * 2,
      p0[1] + start.tangent[1] * radius * 2,
    ];
    const p2: Point = [
      p3[0] + start.tangent[0] * radius * 2,
      p3[1] + start.tangent[1] * radius * 2,
    ];
    const samples: Turnback['samples'] = [];
    for (let i = 0; i <= 48; i++) {
      const t = i / 48,
        u = 1 - t;
      const source: Point = [0, 1].map(
        (axis) =>
          u ** 3 * p0[axis] +
          3 * u * u * t * p1[axis] +
          3 * u * t * t * p2[axis] +
          t ** 3 * p3[axis],
      ) as Point;
      const derivative: Point = [0, 1].map(
        (axis) =>
          3 * u * u * (p1[axis] - p0[axis]) +
          6 * u * t * (p2[axis] - p1[axis]) +
          3 * t * t * (p3[axis] - p2[axis]),
      ) as Point;
      const length = Math.hypot(...derivative) || 1;
      samples.push({
        source,
        tangent: [derivative[0] / length, derivative[1] / length],
        distance: samples.length
          ? samples.at(-1)!.distance + distance(source, samples.at(-1)!.source)
          : 0,
      });
    }
    return {
      id: `${node}:${edge.id}:${incoming.direction}`,
      samples,
      length: samples.at(-1)!.distance,
      distance: 0,
    };
  }

  private turnbackPose(turnback: Turnback, metres: number, position: Position): Pose {
    let index = 1;
    while (
      index < turnback.samples.length - 1 &&
      turnback.samples[index].distance < metres
    )
      index++;
    const a = turnback.samples[index - 1],
      b = turnback.samples[index];
    const t = Math.max(
      0,
      Math.min(1, (metres - a.distance) / (b.distance - a.distance || 1)),
    );
    const source: Point = [
      a.source[0] + (b.source[0] - a.source[0]) * t,
      a.source[1] + (b.source[1] - a.source[1]) * t,
    ];
    const direction: Point = [
      a.tangent[0] + (b.tangent[0] - a.tangent[0]) * t,
      a.tangent[1] + (b.tangent[1] - a.tangent[1]) * t,
    ];
    const length = Math.hypot(...direction) || 1,
      tangent: Point = [direction[0] / length, direction[1] / length];
    const point = localToMap(source, this.data.geographicTransform),
      ahead = localToMap(
        [source[0] + tangent[0], source[1] + tangent[1]],
        this.data.geographicTransform,
      );
    return {
      position: { ...position },
      source,
      point,
      tangent,
      angle: (Math.atan2(ahead[1] - point[1], ahead[0] - point[0]) * 180) / Math.PI,
      turnbackId: turnback.id,
    };
  }

  routePreview(metres = 85): Point[] {
    const points: Point[] = [this.pose().point];
    if (this.turnback)
      for (const sample of this.turnback.samples)
        if (sample.distance > this.turnback.distance)
          points.push(localToMap(sample.source, this.data.geographicTransform));
    let position = { ...this.position },
      index = this.missionIndex,
      remaining = Math.max(0, metres - this.turnbackRemaining),
      refs = this.missionRefs;
    let queued: string | null | undefined = this.queued;
    const visited = new Set<string>();
    for (let guard = 0; remaining > 0.00001 && guard < 2500; guard++) {
      const edge = this.edges.get(position.edgeId)!;
      const available =
        position.direction === 1
          ? edge.lengthMetres - position.distance
          : position.distance;
      if (available > 0.00001) {
        const step = Math.min(3, available, remaining);
        position.distance += position.direction * step;
        remaining -= step;
        points.push(this.pose(position).point);
        continue;
      }
      if (this.mission && index === refs.length - 1) {
        refs = refs
          .slice()
          .reverse()
          .map((ref) => ({ ...ref, direction: ref.direction === 1 ? -1 : 1 }));
        index = -1;
        queued = null;
      }
      const choices = this.choices(position),
        next = this.nextRef(choices, position, index, queued, refs) ?? {
          edgeId: position.edgeId,
          direction: position.direction === 1 ? (-1 as const) : (1 as const),
        };
      if (visited.has(`${next.edgeId}:${next.direction}`)) break;
      visited.add(`${next.edgeId}:${next.direction}`);
      const following = this.edges.get(next.edgeId)!,
        outbound = {
          ...next,
          distance: next.direction === 1 ? 0 : following.lengthMetres,
        };
      if (next.edgeId === position.edgeId && next.direction !== position.direction) {
        const turnback = this.buildTurnback(position, outbound);
        for (const sample of turnback.samples)
          if (sample.distance <= remaining)
            points.push(localToMap(sample.source, this.data.geographicTransform));
        if (remaining < turnback.length) {
          points.push(this.turnbackPose(turnback, remaining, outbound).point);
          break;
        }
        remaining -= turnback.length;
      }
      index = this.indexAfter(next, index, refs);
      if (choices.length > 1) queued = null;
      position = outbound;
      points.push(this.pose(position).point);
    }
    return points;
  }

  private crossJunction() {
    this.record(true);
    const choices = this.choices();
    const finishing = this.mission && this.missionIndex === this.missionRefs.length - 1;
    if (finishing) {
      this.trips++;
      if (this.mode === 'arcade') this.count++;
      // Reverse the SAME ordered path for the return mission. This is a game
      // turnback; it does not claim a scheduled permission to turn every edge.
      this.missionRefs = this.missionRefs
        .slice()
        .reverse()
        .map((ref) => ({ ...ref, direction: ref.direction === 1 ? -1 : 1 }));
      this.missionIndex = -1;
      this.queued = undefined; // Transit Control signs the return departure.
      this.message = t('snake.terminalReachedValueNowTowardsValue', {
        value1: this.mode === 'arcade' ? t('snake.bonusCarCoupled') : '',
        value2: this.destination,
      });
    }
    const next = this.nextRef(choices) ?? {
      edgeId: this.position.edgeId,
      direction: (this.position.direction === 1 ? -1 : 1) as 1 | -1,
    };
    this.missionIndex = this.indexAfter(next, this.missionIndex);
    const edge = this.edges.get(next.edgeId)!;
    const outgoing = { ...next, distance: next.direction === 1 ? 0 : edge.lengthMetres };
    if (
      next.edgeId === this.position.edgeId &&
      next.direction !== this.position.direction
    ) {
      this.turnback = this.buildTurnback(this.position, outgoing);
      this.turnGraceUntil = this.travelled + this.turnback.length + CAR_LENGTH * 3.5;
    }
    this.position = outgoing;
    this.record(true);
    // Hold a command through ordinary geometry nodes until an actual switch.
    if (choices.length > 1 || finishing) this.queued = undefined;
  }

  private record(force = false) {
    if (!force && this.travelled - this.lastRecorded < 1.5) return;
    this.trail.push({ ...this.pose(), travelled: this.travelled });
    this.lastRecorded = this.travelled;
    const oldest = this.travelled - this.count * SPACING - CAR_LENGTH;
    // Do not create phantom tail cars before the head has travelled far enough.
    let remove = 0;
    while (remove < this.trail.length - 1 && this.trail[remove].travelled < oldest)
      remove++;
    if (remove) this.trail.splice(0, remove);
  }

  body(): TrailSample[] {
    return this.trail.filter(
      (sample) =>
        sample.travelled >= this.travelled - (this.count - 1) * SPACING - CAR_LENGTH / 2,
    );
  }

  carCentres(): Pose[] {
    const centres: Pose[] = [this.pose()];
    let index = this.trail.length - 1;
    for (let car = 1; car < this.count && index >= 0; car++) {
      const target = this.travelled - car * SPACING;
      while (index > 0 && this.trail[index].travelled > target) index--;
      if (this.trail[index].travelled <= target) {
        const a = this.trail[index],
          b = this.trail[index + 1] ?? a;
        const t = (target - a.travelled) / (b.travelled - a.travelled || 1);
        const source: Point = [
          a.source[0] + (b.source[0] - a.source[0]) * t,
          a.source[1] + (b.source[1] - a.source[1]) * t,
        ];
        const tangent: Point = [
          a.tangent[0] + (b.tangent[0] - a.tangent[0]) * t,
          a.tangent[1] + (b.tangent[1] - a.tangent[1]) * t,
        ];
        const norm = Math.hypot(...tangent) || 1;
        tangent[0] /= norm;
        tangent[1] /= norm;
        const point = localToMap(source, this.data.geographicTransform),
          ahead = localToMap(
            [source[0] + tangent[0], source[1] + tangent[1]],
            this.data.geographicTransform,
          );
        centres.push({
          ...(t < 0.5 ? a : b),
          source,
          point,
          tangent,
          angle: (Math.atan2(ahead[1] - point[1], ahead[0] - point[0]) * 180) / Math.PI,
        });
      }
    }
    return centres;
  }

  nextStop(): { name: string; metres: number } | undefined {
    let position = this.position,
      index = this.missionIndex,
      metres = this.turnbackRemaining,
      refs = this.missionRefs;
    let queued: string | null | undefined = this.queued;
    const visited = new Set<string>();
    for (let guard = 0; guard < 250 && metres < 5000; guard++) {
      const stops = (this.stopsByEdge.get(position.edgeId) ?? [])
        .flatMap((stop) => {
          if (stop.edgeId !== position.edgeId || stop.distanceAlongMetres === undefined)
            return [];
          const ahead =
            (stop.distanceAlongMetres - position.distance) * position.direction;
          return ahead > 2 ? [{ name: stop.name, metres: metres + ahead }] : [];
        })
        .sort((a, b) => a.metres - b.metres);
      if (stops[0]) return stops[0];
      const edge = this.edges.get(position.edgeId)!,
        choices = this.choices(position);
      metres +=
        position.direction === 1
          ? edge.lengthMetres - position.distance
          : position.distance;
      if (this.mission && index === refs.length - 1) {
        refs = refs
          .slice()
          .reverse()
          .map((ref) => ({ ...ref, direction: ref.direction === 1 ? -1 : 1 }));
        index = -1;
        queued = null;
      }
      const next = this.nextRef(choices, position, index, queued, refs);
      if (!next || visited.has(`${next.edgeId}:${next.direction}`)) return;
      visited.add(`${next.edgeId}:${next.direction}`);
      if (choices.length > 1) queued = null;
      index = this.indexAfter(next, index, refs);
      const following = this.edges.get(next.edgeId)!;
      const outbound = {
        ...next,
        distance: next.direction === 1 ? 0 : following.lengthMetres,
      };
      if (next.edgeId === position.edgeId && next.direction !== position.direction)
        metres += this.buildTurnback(
          { ...position, distance: position.direction === 1 ? edge.lengthMetres : 0 },
          outbound,
        ).length;
      position = outbound;
    }
  }

  tick(seconds: number, cars: PlottedVehicle[], pedal: number | Pedals = 0) {
    if (this.status !== 'running') return;
    const dt = Math.max(0, Math.min(0.1, seconds));
    this.gameTrafficCooldown = Math.max(0, this.gameTrafficCooldown - dt);
    const input =
      typeof pedal === 'number' ? { accelerator: pedal > 0, brake: pedal < 0 } : pedal;
    const acceleration = this.mode === 'purist' ? 34 : 360,
      braking = this.mode === 'purist' ? 58 : 420;
    this.speed = Math.max(
      0,
      Math.min(
        this.mode === 'purist' ? 50 : 2000,
        this.speed +
          ((input.accelerator ? acceleration : 0) - (input.brake ? braking : 0)) * dt,
      ),
    );
    let left = (this.speed / 3.6) * dt;
    const traffic = this.livePoses(cars);
    for (
      let guard = 0;
      left > 0.00001 && guard < 250 && this.status === 'running';
      guard++
    ) {
      if (this.turnback) {
        const step = Math.min(3, left, this.turnbackRemaining);
        this.turnback.distance += step;
        this.travelled += step;
        left -= step;
        this.record();
        if (this.turnbackRemaining <= 0.00001) {
          this.turnback = undefined;
          this.record(true);
        }
        continue;
      }
      if (this.remaining < 0.00001) {
        this.crossJunction();
        continue;
      }
      const step = Math.min(3, left, this.remaining);
      this.position.distance += this.position.direction * step;
      this.travelled += step;
      left -= step;
      this.record();
      const player = this.vehicleSpans(this.position, this.mission?.routeId, true);
      for (const other of traffic) {
        if (
          this.collected.has(other.car.vehicle.id) ||
          !player.some((span) =>
            other.spans.some((otherSpan) => spansOverlap(span, otherSpan)),
          )
        )
          continue;
        if (this.mode === 'purist') {
          this.status = 'over';
          this.message = t('snake.collisionWithStreetcarValueGameOver', {
            value1: other.car.vehicle.label,
          });
          return;
        }
        this.collected.add(other.car.vehicle.id);
        if (other.car.vehicle.id.startsWith(GAME_CAR_PREFIX)) {
          this.removeGameCar(other.car.vehicle.id);
          this.gameTrafficCooldown = Math.max(
            this.gameTrafficCooldown,
            GAME_TRAFFIC_RESPAWN_DELAY,
          );
        }
        this.count++;
        this.message = t('snake.coupledStreetcarValueValueCars', {
          value1: other.car.vehicle.label,
          value2: this.count,
        });
      }
      if (
        this.mode === 'arcade' &&
        this.travelled > this.turnGraceUntil &&
        this.count > 1
      ) {
        for (const sample of this.trail) {
          const behind = this.travelled - sample.travelled;
          if (sample.turnbackId) continue;
          if (
            behind < CAR_LENGTH * 1.7 ||
            behind > (this.count - 1) * SPACING + CAR_LENGTH / 2
          )
            continue;
          if (
            player.some(
              (span) =>
                sameRail(span, sample.position) &&
                sample.position.distance >= span.from &&
                sample.position.distance <= span.to,
            )
          ) {
            this.status = 'over';
            this.message = t('snake.youHitYourOwnTrainGameOver');
            return;
          }
        }
      }
    }
    this.maintainGameTraffic(cars);
  }
}
