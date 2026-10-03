import {
  DISPLAY_HEIGHT,
  DISPLAY_PADDING,
  DISPLAY_WIDTH,
  REFERENCE_LATITUDE,
  REFERENCE_LONGITUDE,
} from "./config";
import type { LatLon, XY } from "./types";

/**
 * Convert WGS84 coordinates into a lightweight local metre coordinate system.
 * This is intentionally local to Toronto; it is not a general GIS projection.
 * Doing geometry in metres keeps simplification and clustering tolerances sane.
 */
export function projectToLocalMetres([lat, lon]: LatLon): XY {
  const radians = Math.PI / 180;
  const metresPerLonDegree = 111_320 * Math.cos(REFERENCE_LATITUDE * radians);
  const metresPerLatDegree = 110_540;
  return [
    (lon - REFERENCE_LONGITUDE) * metresPerLonDegree,
    (lat - REFERENCE_LATITUDE) * metresPerLatDegree,
  ];
}

function squaredDistanceToSegment(point: XY, a: XY, b: XY): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const denom = vx * vx + vy * vy;
  if (denom === 0) {
    const dx = point[0] - a[0];
    const dy = point[1] - a[1];
    return dx * dx + dy * dy;
  }

  const t = Math.max(
    0,
    Math.min(1, ((point[0] - a[0]) * vx + (point[1] - a[1]) * vy) / denom),
  );
  const px = a[0] + t * vx;
  const py = a[1] + t * vy;
  const dx = point[0] - px;
  const dy = point[1] - py;
  return dx * dx + dy * dy;
}

/**
 * Ramer-Douglas-Peucker simplification for unprotected v1 shape vertices.
 * Endpoints are always retained. The future generator will add protected
 * topology anchors before this step, as documented in ARCHITECTURE.md.
 */
export function simplifyPolyline(points: XY[], toleranceMetres: number): XY[] {
  if (points.length <= 2) return points;
  const threshold = toleranceMetres * toleranceMetres;

  const keep = new Set<number>([0, points.length - 1]);
  const simplifyRange = (start: number, end: number): void => {
    let maxDistance = -1;
    let index = -1;

    for (let i = start + 1; i < end; i++) {
      const distance = squaredDistanceToSegment(points[i], points[start], points[end]);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }

    if (index > start && maxDistance > threshold) {
      keep.add(index);
      simplifyRange(start, index);
      simplifyRange(index, end);
    }
  };

  simplifyRange(0, points.length - 1);
  return [...keep].sort((a, b) => a - b).map((index) => points[index]);
}

export function metresBetween(a: XY, b: XY): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function nearestOnSegment(p: XY, a: XY, b: XY): { t: number; point: XY; distance: number } {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  const point: XY = [a[0] + t * dx, a[1] + t * dy];
  return { t, point, distance: metresBetween(p, point) };
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function calculateBounds(points: XY[]): Bounds {
  if (!points.length) throw new Error("Map generator has no geometry to bound");

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Fit local-metre geometry into our deterministic Snake display canvas.
 * Y is flipped because screen coordinates grow downward.
 */
export function createDisplayTransform(box: Bounds): (point: XY) => XY {
  const spanX = Math.max(1, box.maxX - box.minX);
  const spanY = Math.max(1, box.maxY - box.minY);
  const scale = Math.min(
    (DISPLAY_WIDTH - DISPLAY_PADDING * 2) / spanX,
    (DISPLAY_HEIGHT - DISPLAY_PADDING * 2) / spanY,
  );
  const usedWidth = spanX * scale;
  const usedHeight = spanY * scale;
  const xOffset = (DISPLAY_WIDTH - usedWidth) / 2;
  const yOffset = (DISPLAY_HEIGHT - usedHeight) / 2;

  return (point: XY): XY => [
    Math.round((xOffset + (point[0] - box.minX) * scale) * 10) / 10,
    Math.round((DISPLAY_HEIGHT - yOffset - (point[1] - box.minY) * scale) * 10) / 10,
  ];
}
