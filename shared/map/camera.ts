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
