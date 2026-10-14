import type { Bounds, Point } from './model';

export function fitCamera(bounds: Bounds, aspect: number): Bounds {
  const width = Math.max(bounds.width, bounds.height * aspect),
    height = width / aspect;
  return {
    x: bounds.x + (bounds.width - width) / 2,
    y: bounds.y + (bounds.height - height) / 2,
    width,
    height,
  };
}
function percentile(sorted: number[], q: number): number {
  return sorted[Math.round(q * (sorted.length - 1))] ?? 0;
}
/** The first camera a visitor lands on. A plain fit shows everything, but on
 * portrait screens it strands a wide network as a thin band across the middle:
 * covering the full east–west extent leaves the north–south detail unreadable.
 * When the fit would leave the network occupying under ~40% of the screen
 * height, zoom in until it fills ~65% instead, centred on where stops actually
 * cluster (the median point, which is density-weighted). The plain fit stays
 * available as the zoom-out cap and the reset view. */
export function landingCamera(bounds: Bounds, points: Point[], aspect: number): Bounds {
  const fitted = fitCamera(bounds, aspect);
  const occupied = bounds.height / fitted.height;
  if (!points.length || occupied >= 0.42) return fitted;
  const xs = points.map((p) => p[0]).sort((a, b) => a - b);
  const ys = points.map((p) => p[1]).sort((a, b) => a - b);
  const center: Point = [percentile(xs, 0.5), percentile(ys, 0.5)];
  const level = Math.min(4, 0.65 / occupied);
  const width = fitted.width / level;
  return {
    x: center[0] - width / 2,
    y: center[1] - width / aspect / 2,
    width,
    height: width / aspect,
  };
}
export function zoomCamera(
  camera: Bounds,
  factor: number,
  anchor: Point,
  minimumWidth: number,
  maximumWidth: number,
): Bounds {
  const width = Math.max(minimumWidth, Math.min(maximumWidth, camera.width * factor)),
    ratio = width / camera.width;
  return {
    x: anchor[0] - (anchor[0] - camera.x) * ratio,
    y: anchor[1] - (anchor[1] - camera.y) * ratio,
    width,
    height: camera.height * ratio,
  };
}
export function moveCamera(camera: Bounds, dx: number, dy: number): Bounds {
  return { ...camera, x: camera.x + dx, y: camera.y + dy };
}

/** A persisted camera, reduced to what survives a viewport change: the zoom
 * (view width in map units) and the view centre — the screen's aspect decides
 * the height at read time. */
export interface SavedView {
  cx: number;
  cy: number;
  width: number;
}
const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/** Validate a camera for persistence. Saved views ride device storage, so
 * anything can arrive in one — a stale or hand-edited value must never strand
 * the camera. A view that does not overlap the network at all is not a view
 * of this map. */
export function saveableView(camera: Bounds, bounds: Bounds): SavedView | undefined {
  const { x, y, width, height } = camera;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0)
    return undefined;
  const overlapX = Math.min(x + width, bounds.x + bounds.width) - Math.max(x, bounds.x);
  const overlapY = Math.min(y + height, bounds.y + bounds.height) - Math.max(y, bounds.y);
  if (overlapX <= 0 || overlapY <= 0) return undefined;
  return { cx: x + width / 2, cy: y + height / 2, width };
}

/** Reconstitute a saved view at the current viewport aspect: the saved zoom
 * and centre hold, the height follows the screen. Slightly out-of-range
 * values clamp instead of rejecting — the network data may have shifted a
 * little since the view was saved — but nonsense never yields a camera. */
export function defaultViewCamera(
  saved: SavedView,
  bounds: Bounds,
  aspect: number,
): Bounds | undefined {
  if (!Number.isFinite(aspect) || aspect <= 0) return undefined;
  if (![saved.cx, saved.cy, saved.width].every(Number.isFinite)) return undefined;
  const fit = fitCamera(bounds, aspect);
  const width = clamp(saved.width, fit.width / 40, fit.width);
  const height = width / aspect;
  const cx = clamp(
    saved.cx,
    bounds.x - bounds.width * 0.2,
    bounds.x + bounds.width * 1.2,
  );
  const cy = clamp(
    saved.cy,
    bounds.y - bounds.height * 0.2,
    bounds.y + bounds.height * 1.2,
  );
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}
