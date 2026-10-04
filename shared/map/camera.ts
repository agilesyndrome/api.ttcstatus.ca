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
