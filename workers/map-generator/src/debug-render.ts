/** Pure debug renderer for inspecting a generated map bundle without D1/GTFS. */

type RenderPoint = [number, number]
interface RenderRoute { id: string; shortName?: string; longName?: string; color?: string }
interface RenderPath { id: string; kind?: string; routeIds?: string[]; points: RenderPoint[] }
interface RenderInfrastructure { id: string; name?: string; kind?: string; points: RenderPoint[] }
interface RenderStop { id: string; name?: string; x: number; y: number }

export interface DebugMapBundle {
  schemaVersion?: number;
  mode?: string;
  style?: string;
  generatorVersion?: string;
  generatedAt?: string;
  display: { width: number; height: number };
  routes?: RenderRoute[];
  paths?: RenderPath[];
  infrastructure?: RenderInfrastructure[];
  stops?: RenderStop[];
}

const DEFAULT_ROUTE_COLOR = "#2d6cdf";
const INFRASTRUCTURE_COLOR = "#7b8794";

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function safeColor(value: unknown, fallback: string): string {
  const color = typeof value === "string" ? value.trim() : "";
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : fallback;
}

function validPoint(point: RenderPoint): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function polyline(points: RenderPoint[]): string {
  return points.filter(validPoint).map((point) => `${point[0]},${point[1]}`).join(" ");
}

function routeLabel(route: RenderRoute): string {
  return route.shortName || route.longName || route.id;
}

/** Render display-space geometry as a standalone dependency-free SVG. */
export function renderDebugMapSvg(bundle: DebugMapBundle): string {
  const width = Number(bundle.display?.width);
  const height = Number(bundle.display?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("map display dimensions must be positive numbers");
  }

  const routes = Array.isArray(bundle.routes) ? bundle.routes : [];
  const routeColors = new Map(routes.map((route) => [route.id, safeColor(route.color, DEFAULT_ROUTE_COLOR)]));
  const routeLegend = routes.map((route, index) => {
    const x = 24 + (index % 8) * 150;
    const y = height - 24 - Math.floor(index / 8) * 24;
    return `<g transform="translate(${x} ${y})"><line x1="0" y1="-5" x2="20" y2="-5" stroke="${routeColors.get(route.id) ?? DEFAULT_ROUTE_COLOR}" stroke-width="5" stroke-linecap="round"/><text x="27" y="0">${escapeXml(routeLabel(route))}</text></g>`;
  }).join("");

  const paths = (bundle.paths ?? []).map((path) => {
    const points = polyline(path.points ?? []);
    if (!points) return "";
    const color = routeColors.get(path.routeIds?.[0] ?? "") ?? DEFAULT_ROUTE_COLOR;
    return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="${path.kind === "scheduled" ? 7 : 5}" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`;
  }).join("");

  const infrastructure = (bundle.infrastructure ?? []).map((overlay) => {
    const points = polyline(overlay.points ?? []);
    if (!points) return "";
    return `<polyline points="${points}" fill="none" stroke="${INFRASTRUCTURE_COLOR}" stroke-width="4" stroke-dasharray="10 8" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join("");

  const stops = (bundle.stops ?? []).filter((stop) => Number.isFinite(stop.x) && Number.isFinite(stop.y)).map((stop) =>
    `<circle cx="${stop.x}" cy="${stop.y}" r="5" fill="#fff" stroke="#20252b" stroke-width="2"><title>${escapeXml(stop.name || stop.id)}</title></circle>`
  ).join("");

  const title = `${bundle.mode || "map"} ${bundle.style || "debug"}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(title)}</title>
  <desc id="description">Debug rendering of the generated streetcar map bundle.</desc>
  <rect width="100%" height="100%" fill="#f5f1e8"/>
  <g>${infrastructure}${paths}${stops}</g>
  <g font-family="system-ui, sans-serif" font-size="14" fill="#20252b">${routeLegend}</g>
  <text x="24" y="28" font-family="system-ui, sans-serif" font-size="18" font-weight="700" fill="#20252b">${escapeXml(title)}</text>
</svg>
`;
}
