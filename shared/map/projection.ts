import {
  calculateBounds,
  metresBetween,
  nearestOnSegment,
  projectToLocalMetres,
} from './geometry';
import type { XY } from './types';
import { REFERENCE_LATITUDE, REFERENCE_LONGITUDE } from './config';

/** Serialized with the map: clients must use its transform, never fit their own. */
export interface GeographicTransform {
  version: 1;
  rotationDegrees: number;
  xAxis: { lower: number; upper: number; outerScale: number };
  yAxis: { lower: number; upper: number; outerScale: number };
  minX: number;
  maxY: number;
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
  projection: {
    latitude: number;
    longitude: number;
    metresPerLatitudeDegree: number;
    metresPerLongitudeDegree: number;
  };
}

function rotate([x, y]: XY, degrees: number): XY {
  const angle = (degrees * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  return [x * c + y * s, -x * s + y * c];
}
function axis(value: number, config: GeographicTransform['xAxis']) {
  const { lower, upper, outerScale } = config;
  return value < lower
    ? lower + (value - lower) * outerScale
    : value > upper
      ? upper + (value - upper) * outerScale
      : value;
}
function warp(point: XY, transform: GeographicTransform): XY {
  const [x, y] = rotate(point, transform.rotationDegrees);
  return [axis(x, transform.xAxis), axis(y, transform.yAxis)];
}

export function fitGeographicTransform(
  points: XY[],
  width: number,
  height: number,
  rotationDegrees: number,
): GeographicTransform {
  const transform: GeographicTransform = {
    version: 1,
    rotationDegrees,
    xAxis: { lower: -4200, upper: 4400, outerScale: 0.56 },
    yAxis: { lower: -1600, upper: 2400, outerScale: 0.62 },
    minX: 0,
    maxY: 0,
    scaleX: 1,
    scaleY: 1,
    offsetX: 90,
    offsetY: 150,
    projection: {
      latitude: REFERENCE_LATITUDE,
      longitude: REFERENCE_LONGITUDE,
      metresPerLatitudeDegree: 110540,
      metresPerLongitudeDegree: 111320 * Math.cos((REFERENCE_LATITUDE * Math.PI) / 180),
    },
  };
  const box = calculateBounds(points.map((point) => warp(point, transform)));
  return {
    ...transform,
    minX: box.minX,
    maxY: box.maxY,
    scaleX: (width - 180) / Math.max(1, box.maxX - box.minX),
    scaleY: (height - 320) / Math.max(1, box.maxY - box.minY),
  };
}

export function localToMap(point: XY, transform: GeographicTransform): XY {
  const [x, y] = warp(point, transform);
  return [
    +(transform.offsetX + (x - transform.minX) * transform.scaleX).toFixed(2),
    +(transform.offsetY + (transform.maxY - y) * transform.scaleY).toFixed(2),
  ];
}

/** Free geographic placement for a person's location or a car away from rail. */
export function gpsToMap(
  latitude: number,
  longitude: number,
  transform: GeographicTransform,
): XY {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    throw new Error('Invalid GPS coordinates');
  }
  return localToMap(gpsToLocal(latitude, longitude, transform), transform);
}

function gpsToLocal(
  latitude: number,
  longitude: number,
  transform?: GeographicTransform,
): XY {
  if (!transform) return projectToLocalMetres([latitude, longitude]);
  const p = transform.projection;
  return [
    (longitude - p.longitude) * p.metresPerLongitudeDegree,
    (latitude - p.latitude) * p.metresPerLatitudeDegree,
  ];
}

/** Inverse is useful for location picking and projection round-trip checks.
 * Display geometry is rounded to hundredths, so round trips have that precision. */
export function mapToGps(
  point: XY,
  transform: GeographicTransform,
): { latitude: number; longitude: number } {
  const unwarp = (value: number, config: GeographicTransform['xAxis']) =>
    value < config.lower
      ? config.lower + (value - config.lower) / config.outerScale
      : value > config.upper
        ? config.upper + (value - config.upper) / config.outerScale
        : value;
  const x = transform.minX + (point[0] - transform.offsetX) / transform.scaleX;
  const y = transform.maxY - (point[1] - transform.offsetY) / transform.scaleY;
  const source = rotate(
    [unwarp(x, transform.xAxis), unwarp(y, transform.yAxis)],
    -transform.rotationDegrees,
  );
  const p = transform.projection;
  return {
    latitude: p.latitude + source[1] / p.metresPerLatitudeDegree,
    longitude: p.longitude + source[0] / p.metresPerLongitudeDegree,
  };
}

/** Preserve warp boundaries so a display chord never cuts across a bent edge. */
export function transformSegment(a: XY, b: XY, transform: GeographicTransform) {
  const ra = rotate(a, transform.rotationDegrees),
    rb = rotate(b, transform.rotationDegrees),
    ts = [0, 1];
  for (const [dimension, config] of [
    [0, transform.xAxis],
    [1, transform.yAxis],
  ] as const) {
    for (const knot of [config.lower, config.upper]) {
      const t = (knot - ra[dimension]) / (rb[dimension] - ra[dimension]);
      if (t > 0 && t < 1) ts.push(t);
    }
  }
  const fractions = [...new Set(ts)].sort((a, b) => a - b);
  return {
    points: fractions.map((t) =>
      localToMap([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], transform),
    ),
    sourceDistances: fractions.map((t) => t * metresBetween(a, b)),
  };
}

export interface ProjectionEdge {
  id: string;
  a: string;
  b: string;
  routeIds: string[];
  sourcePoints: XY[];
  points: XY[];
  sourceDistances: number[];
  lengthMetres: number;
}
export interface TrackMatch {
  edgeId: string;
  distanceAlongMetres: number;
  distanceFromTrackMetres: number;
  direction: 1 | -1;
  point: XY;
  angle: number;
}

/** Interpolate by SOURCE distance; compressed display distances are not metres. */
export function pointAlongEdge(
  edge: ProjectionEdge,
  distance: number,
): { point: XY; angle: number } {
  const s = Math.max(0, Math.min(edge.lengthMetres, distance));
  let i = 1;
  while (i < edge.points.length - 1 && edge.sourceDistances[i] < s) i++;
  const a = edge.points[i - 1],
    b = edge.points[i];
  const span = edge.sourceDistances[i] - edge.sourceDistances[i - 1];
  const t = span ? (s - edge.sourceDistances[i - 1]) / span : 0;
  return {
    point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    angle: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI,
  };
}

/** Pure matcher shared by browser and future live Worker. Route/bearing are
 * hints, not restrictions: diversions and unscheduled cars may use any rail.
 * Previous-edge continuity can be supplied once successive fixes are available. */
export function matchGpsToTrack(
  edges: ProjectionEdge[],
  latitude: number,
  longitude: number,
  hints: {
    routeId?: string;
    bearing?: number;
    previousEdgeId?: string;
    maxDistanceMetres?: number;
    transform?: GeographicTransform;
  } = {},
): TrackMatch | undefined {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return;
  const source = gpsToLocal(latitude, longitude, hints.transform);
  const previous = edges.find((edge) => edge.id === hints.previousEdgeId);
  let best: { score: number; match: TrackMatch } | undefined;
  for (const edge of edges) {
    let travelled = 0;
    for (let i = 1; i < edge.sourcePoints.length; i++) {
      const a = edge.sourcePoints[i - 1],
        b = edge.sourcePoints[i];
      const length = metresBetween(a, b),
        hit = nearestOnSegment(source, a, b);
      if (hit.distance <= (hints.maxDistanceMetres ?? 100)) {
        const bearing =
          ((Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI + 360) % 360;
        const hasBearing = hints.bearing !== undefined && Number.isFinite(hints.bearing);
        const delta = hasBearing
          ? Math.abs(((hints.bearing! - bearing + 540) % 360) - 180)
          : 0;
        const direction = delta > 90 ? -1 : 1;
        const headingPenalty = hasBearing ? (Math.min(delta, 180 - delta) / 90) * 35 : 0;
        const routePenalty =
          hints.routeId && !edge.routeIds.includes(hints.routeId) ? 30 : 0;
        const continuityPenalty =
          previous && edge.id !== previous.id
            ? [edge.a, edge.b].some((id) => id === previous.a || id === previous.b)
              ? 5
              : 20
            : 0;
        const score = hit.distance + headingPenalty + routePenalty + continuityPenalty;
        if (
          !best ||
          score < best.score ||
          (score === best.score && edge.id < best.match.edgeId)
        ) {
          const distanceAlongMetres = travelled + hit.t * length;
          const display = pointAlongEdge(edge, distanceAlongMetres);
          best = {
            score,
            match: {
              edgeId: edge.id,
              distanceAlongMetres,
              distanceFromTrackMetres: hit.distance,
              direction,
              point: display.point,
              angle: display.angle + (direction === -1 ? 180 : 0),
            },
          };
        }
      }
      travelled += length;
    }
  }
  return best?.match;
}
