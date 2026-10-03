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
  graph?: { nodes: { id: string; x: number; y: number; edgeIds: string[] }[]; edges: { id: string; routeIds: string[]; infrastructureIds: string[]; points: RenderPoint[] }[] };
  context?: { labels: { text: string; kind: string; angle: number; point: RenderPoint }[]; shoreline: RenderPoint[]; north: { angle: number } };
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

// Schematic route colours deliberately differ from GTFS's all-red day routes.
const PALETTE: Record<string, string> = {
  "501": "#cf3f48", "503": "#a65839", "504": "#de762c", "505": "#815aa6",
  "506": "#4c8662", "507": "#ae8135", "508": "#737d87", "509": "#278f91",
  "510": "#b14f85", "511": "#477cb1", "512": "#ac882a",
};

function layoutLabels(bundle: DebugMapBundle): string {
  const occupied: { x: number; y: number; w: number; h: number }[] = [];
  const labels = [...(bundle.context?.labels ?? [])].sort((a, b) => Number(b.kind === "terminal") - Number(a.kind === "terminal"));
  return labels.map(label => {
    let [x, y] = label.point;
    const terminal = label.kind === "terminal";
    // Prefer actual feed stop positions over approximate context anchors.
    const stops = terminal ? (bundle.stops ?? []).filter(s => (s.name ?? "").toLowerCase().includes(label.text.toLowerCase()) && /loop|station/i.test(s.name ?? "")) : [];
    const nearest = stops.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    if (nearest) { x = nearest.x; y = nearest.y; }
    const marker = terminal ? `<circle cx="${x}" cy="${y}" r="5" fill="#fffdf7" stroke="#25343c" stroke-width="2"/>` : "";
    const w = label.text.length * (terminal ? 7.7 : 7) + 12, h = terminal ? 22 : 20;
    const vertical = Math.abs(label.angle) === 90;
    const bw = vertical ? h : w, bh = vertical ? w : h;
    const offsets = terminal ? [[9,-29],[9,9],[-w-9,-29],[-w-9,9],[9,-52],[9,32]] : vertical ? [[10,-bh/2],[-bw-10,-bh/2],[28,-bh/2],[-bw-28,-bh/2]] : [[-bw/2,-bh-10],[-bw/2,10],[-bw/2,-bh-28],[-bw/2,28],[10,-bh/2],[-bw-10,-bh/2]];
    for (const [dx, dy] of offsets) {
      const box = { x: x + dx, y: y + dy, w: bw, h: bh };
      if (box.x < 15 || box.y < 100 || box.x + bw > bundle.display.width - 15 || box.y + bh > bundle.display.height - 145) continue;
      if (occupied.some(p => box.x < p.x + p.w + 5 && box.x + bw + 5 > p.x && box.y < p.y + p.h + 5 && box.y + bh + 5 > p.y)) continue;
      occupied.push(box);
      const cx = box.x + bw/2, cy = box.y + bh/2;
      const leader = terminal ? `<line x1="${x}" y1="${y}" x2="${Math.max(box.x, Math.min(x, box.x+bw))}" y2="${Math.max(box.y, Math.min(y, box.y+bh))}" stroke="#7e8c91" stroke-width="0.9"/>` : "";
      return `${leader}${marker}<g transform="translate(${cx} ${cy}) rotate(${label.angle})"><rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" rx="4" fill="#fffdf7" opacity="0.94"/><text text-anchor="middle" dominant-baseline="central" font-size="${terminal ? 14 : 13}" font-weight="${terminal ? 650 : 500}" fill="${terminal ? "#25343c" : "#5b6870"}">${escapeXml(label.text)}</text></g>`;
    }
    return marker;
  }).join("");
}

/** Render display-space geometry as a standalone dependency-free SVG. */
export function renderDebugMapSvg(bundle: DebugMapBundle): string {
  const width = Number(bundle.display?.width);
  const height = Number(bundle.display?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("map display dimensions must be positive numbers");
  }

  const routes = Array.isArray(bundle.routes) ? bundle.routes : [];
  const routeColors = new Map(routes.map((route) => [route.id, PALETTE[route.shortName ?? route.id] ?? safeColor(route.color, DEFAULT_ROUTE_COLOR)]));
  const daytime = routes.filter(r => !/^3\d\d$/.test(r.shortName ?? r.id));
  const routeLegend = daytime.map((route, index) => {
    const columns = Math.max(1, Math.floor((width - 60) / 235));
    const x = 30 + (index % columns) * 235;
    const y = height - 100 + Math.floor(index / columns) * 28;
    return `<g transform="translate(${x} ${y})"><line x1="0" y1="-5" x2="20" y2="-5" stroke="${routeColors.get(route.id) ?? DEFAULT_ROUTE_COLOR}" stroke-width="5" stroke-linecap="round"/><text x="29" y="0">${escapeXml(routeLabel(route))} ${escapeXml(route.longName ?? "")}</text></g>`;
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
    `<circle cx="${stop.x}" cy="${stop.y}" r="1.8" fill="#fffdf7" stroke="#43535e" stroke-width="0.7"><title>${escapeXml(stop.name || stop.id)}</title></circle>`
  ).join("");

  const tracks = bundle.graph?.edges.map(edge => {
    const members = [...edge.routeIds].sort((a, b) => Number(/^3/.test(a)) - Number(/^3/.test(b)) || a.localeCompare(b));
    const color = routeColors.get(members[0]) ?? INFRASTRUCTURE_COLOR;
    const title = members.map(id => routeLabel(routes.find(r => r.id === id) ?? { id })).join(" / ");
    const dashed = !members.length;
    return `<polyline points="${polyline(edge.points)}" fill="none" stroke="${color}" stroke-width="${dashed ? 4 : 6}" ${dashed ? 'stroke-dasharray="7 5"' : ""} stroke-linecap="round" stroke-linejoin="round"><title>${escapeXml(title || edge.infrastructureIds.join(" / "))}</title></polyline>`;
  }).join("");
  const junctions = (bundle.graph?.nodes ?? []).filter(n => n.edgeIds.length > 2).map(n =>
    `<circle cx="${n.x}" cy="${n.y}" r="3.2" fill="#fffdf7" stroke="#43535e" stroke-width="1.2"/>`).join("");
  const shore = bundle.context?.shoreline ?? [];
  const water = shore.length ? `<polygon points="${polyline(shore)} ${width+200},${height+200} -200,${height+200}" fill="#d8e8e9"/><polyline points="${polyline(shore)}" fill="none" stroke="#bdd7da" stroke-width="2"/><text x="${width * 0.65}" y="${height-230}" font-size="24" letter-spacing="5" fill="#7b9fa9">LAKE ONTARIO</text>` : "";
  const northAngle = bundle.context?.north.angle ?? -90;
  const north = `<g transform="translate(${width-60} 58)"><g transform="rotate(${northAngle})"><path d="M -17 0 L 18 0 M 8 -5 L 18 0 L 8 5" fill="none" stroke="#43535e" stroke-width="2"/></g><text x="0" y="-27" text-anchor="middle" font-size="13">N</text></g>`;

  const title = "Toronto streetcars";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(title)}</title>
  <desc id="description">Schematic Toronto streetcar map with shared corridors, stops, junctions, and approximate geographic context. Shared tracks show the first daytime route colour; hover for all routes. Grey dashed track is infrastructure without scheduled service.</desc>
  <rect width="100%" height="100%" fill="#f7f5ed"/>
  <g font-family="system-ui, sans-serif">${water}${tracks ?? infrastructure + paths}${stops}${junctions}${layoutLabels(bundle)}${north}</g>
  <rect x="0" y="${height-135}" width="${width}" height="135" fill="#fffdf7"/>
  <g font-family="system-ui, sans-serif" font-size="14" fill="#20252b">${routeLegend}</g>
  <g font-family="system-ui, sans-serif" fill="#25343c"><text x="30" y="48" font-size="30" font-weight="750">${escapeXml(title)}</text><text x="30" y="76" font-size="14" fill="#64737a">A shared world for TTCstatus and Streetcar Snake · ${escapeXml(bundle.generatorVersion)}</text><text x="30" y="${height-22}" font-size="12" fill="#64737a">Shared tracks show one route colour; hover for all routes. Overnight service shares the same corridors. Dashed grey: physical-only track. Geography is schematic.</text></g>
</svg>
`;
}
