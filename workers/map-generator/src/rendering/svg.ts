import type { RenderPoint, RenderRoute } from './debug-types';
export function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function safeColor(value: unknown, fallback: string): string {
  const color = typeof value === 'string' ? value.trim() : '';
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : fallback;
}

function validPoint(point: RenderPoint): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

export function polyline(points: RenderPoint[]): string {
  return points
    .filter(validPoint)
    .map((point) => `${point[0]},${point[1]}`)
    .join(' ');
}

export function routeLabel(route: RenderRoute): string {
  return route.shortName || route.longName || route.id;
}
