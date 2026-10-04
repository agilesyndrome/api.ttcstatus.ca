import { layoutLabels } from './labels';
import { escapeXml, safeColor, polyline, routeLabel } from './svg';
import { PALETTE } from '../../../../shared/map/palette';
/** Pure debug renderer for inspecting a generated map bundle without D1/GTFS. */

import type { DebugMapBundle, RenderPoint } from './debug-types';
import { validateDebugMapBundle } from './validate-debug-map';
export type { DebugMapBundle } from './debug-types';

const DEFAULT_ROUTE_COLOR = '#2d6cdf';
const INFRASTRUCTURE_COLOR = '#7b8794';

/** Render display-space geometry as a standalone dependency-free SVG. */
export function renderDebugMapSvg(bundle: DebugMapBundle): string {
  validateDebugMapBundle(bundle);
  const width = Number(bundle.display?.width);
  const height = Number(bundle.display?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('map display dimensions must be positive numbers');
  }

  const routes = Array.isArray(bundle.routes) ? bundle.routes : [];
  const byRouteId = new Map(routes.map((route) => [route.id, route]));
  const byRouteNumber = new Map(
    routes.map((route) => [route.shortName ?? route.id, route]),
  );
  const routeNumber = (id: string) => byRouteId.get(id)?.shortName ?? id;
  const displayNumber = (id: string) =>
    /^3\d\d$/.test(routeNumber(id))
      ? String(Number(routeNumber(id)) + 200)
      : routeNumber(id);
  const visibleRoute = (ids: string[]) => {
    const first = [...ids].sort(
      (a, b) =>
        Number(/^3\d\d$/.test(routeNumber(a))) - Number(/^3\d\d$/.test(routeNumber(b))) ||
        a.localeCompare(b),
    )[0];
    return first ? (byRouteNumber.get(displayNumber(first))?.id ?? first) : undefined;
  };
  // Overnight variants use their corresponding daytime corridor colour.
  const routeColors = new Map(
    routes.map((route) => [
      route.id,
      PALETTE[displayNumber(route.id)] ?? safeColor(route.color, DEFAULT_ROUTE_COLOR),
    ]),
  );
  const daytime = routes.filter((r) => !/^3\d\d$/.test(r.shortName ?? r.id));
  const scheduledRoutes = new Set(
    bundle.graph?.edges.flatMap((edge) => edge.routeIds) ??
      (bundle.paths ?? []).flatMap((path) => path.routeIds ?? []),
  );
  const routeLegend = daytime
    .map((route, index) => {
      const columns = Math.max(1, Math.floor((width - 60) / 235));
      const x = 30 + (index % columns) * 235;
      const y = height - 100 + Math.floor(index / columns) * 28;
      const active = scheduledRoutes.has(route.id);
      return `<g transform="translate(${x} ${y})"><line x1="0" y1="-5" x2="20" y2="-5" stroke="${active ? (routeColors.get(route.id) ?? DEFAULT_ROUTE_COLOR) : INFRASTRUCTURE_COLOR}" stroke-width="5" ${active ? '' : 'stroke-dasharray="5 4"'} stroke-linecap="round"/><text x="29" y="0">${escapeXml(routeLabel(route))} ${escapeXml(route.longName ?? '')}${active ? '' : ' · rail only'}</text></g>`;
    })
    .join('');

  const paths = (bundle.paths ?? [])
    .map((path) => {
      const points = polyline(path.points ?? []);
      if (!points) return '';
      const color = routeColors.get(path.routeIds?.[0] ?? '') ?? DEFAULT_ROUTE_COLOR;
      return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="${path.kind === 'scheduled' ? 7 : 5}" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`;
    })
    .join('');

  const infrastructure = (bundle.infrastructure ?? [])
    .map((overlay) => {
      const points = polyline(overlay.points ?? []);
      if (!points) return '';
      return `<polyline points="${points}" fill="none" stroke="${INFRASTRUCTURE_COLOR}" stroke-width="4" stroke-dasharray="10 8" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join('');

  const stops = (bundle.stops ?? [])
    .filter((stop) => Number.isFinite(stop.x) && Number.isFinite(stop.y))
    .map(
      (stop) =>
        `<circle cx="${stop.x}" cy="${stop.y}" r="1.8" fill="#fffdf7" stroke="#43535e" stroke-width="0.7"><title>${escapeXml(stop.name || stop.id)}</title></circle>`,
    )
    .join('');

  const tracks = bundle.graph?.edges
    .map((edge) => {
      const members = edge.routeIds;
      const color = routeColors.get(visibleRoute(members) ?? '') ?? INFRASTRUCTURE_COLOR;
      const title = members
        .map((id) => routeLabel(routes.find((r) => r.id === id) ?? { id }))
        .join(' / ');
      const dashed = !members.length;
      return `<polyline points="${polyline(edge.points)}" fill="none" stroke="${color}" stroke-width="${dashed ? 4 : 6}" ${dashed ? 'stroke-dasharray="7 5"' : ''} stroke-linecap="round" stroke-linejoin="round"><title>${escapeXml(title || edge.infrastructureIds.join(' / '))}</title></polyline>`;
    })
    .join('');
  const junctions = (bundle.graph?.nodes ?? [])
    .filter((n) => n.edgeIds.length > 2)
    .map(
      (n) =>
        `<circle cx="${n.x}" cy="${n.y}" r="4.2" fill="#fffdf7" stroke="#25343c" stroke-width="1.8"><title>Track junction · ${n.edgeIds.length} branches</title></circle>`,
    )
    .join('');
  const routeBadges = daytime
    .flatMap((route) => {
      // Identify the services along their visible colour, rather than require a
      // reader to infer every route from the legend or a hover tooltip.
      const span = (edge: { points: RenderPoint[] }) => {
        const a = edge.points[0],
          b = edge.points.at(-1)!;
        return Math.hypot(b[0] - a[0], b[1] - a[1]);
      };
      const edge = bundle.graph?.edges
        .filter((e) => {
          return visibleRoute(e.routeIds) === route.id;
        })
        .sort((a, b) => span(b) - span(a))[0];
      if (!edge) return [];
      const a = edge.points[0],
        b = edge.points.at(-1)!;
      const x = (a[0] + b[0]) / 2,
        y = (a[1] + b[1]) / 2;
      const color = routeColors.get(route.id) ?? DEFAULT_ROUTE_COLOR;
      return [
        `<g transform="translate(${x} ${y})"><rect x="-18" y="-10" width="36" height="20" rx="5" fill="#fffdf7" stroke="${color}" stroke-width="2"/><text text-anchor="middle" dominant-baseline="central" font-size="12" font-weight="700" fill="${color}">${escapeXml(routeLabel(route))}</text></g>`,
      ];
    })
    .join('');
  const shore = bundle.context?.shoreline ?? [];
  const water = shore.length
    ? `<polygon points="${polyline(shore)} ${width + 200},${shore.at(-1)![1]} ${width + 200},${height + 200} -200,${height + 200} -200,${shore[0][1]}" fill="#d8e8e9"/><polyline points="${polyline(shore)}" fill="none" stroke="#bdd7da" stroke-width="1.5"/><text x="${width * 0.57}" y="${height - 230}" font-size="24" letter-spacing="5" fill="#7b9fa9">LAKE ONTARIO</text>`
    : '';
  const northAngle = bundle.context?.north.angle ?? -90;
  const north = `<g transform="translate(${width - 60} 58)"><g transform="rotate(${northAngle})"><path d="M -17 0 L 18 0 M 8 -5 L 18 0 L 8 5" fill="none" stroke="#43535e" stroke-width="2"/></g><text x="0" y="-27" text-anchor="middle" font-size="13">N</text></g>`;

  const title = 'Toronto streetcars';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(title)}</title>
  <desc id="description">Schematic Toronto streetcar map with shared corridors, stops, junctions, and approximate geographic context. Shared tracks show the first daytime route colour; hover for all routes. Grey dashed track is infrastructure without scheduled service.</desc>
  <rect width="100%" height="100%" fill="#f7f5ed"/>
  <g font-family="system-ui, sans-serif">${water}${tracks ?? infrastructure + paths}${stops}${junctions}${routeBadges}${layoutLabels(bundle)}${north}</g>
  <rect x="0" y="${height - 135}" width="${width}" height="135" fill="#fffdf7"/>
  <g font-family="system-ui, sans-serif" font-size="14" fill="#20252b">${routeLegend}</g>
  <g font-family="system-ui, sans-serif" fill="#25343c"><text x="30" y="48" font-size="30" font-weight="750">${escapeXml(title)}</text><text x="30" y="76" font-size="14" fill="#64737a">A shared world for TTCstatus and Streetcar Snake · ${escapeXml(bundle.generatorVersion)}</text><text x="30" y="${height - 40}" font-size="12" fill="#64737a">Shared tracks show one route colour; hover for all routes. Dashed grey: physical track without scheduled streetcar service. Geography is schematic.</text><text x="30" y="${height - 18}" font-size="11" fill="#64737a"><a href="https://gis.toronto.ca/arcgis/rest/services/cot_geospatial/FeatureServer/14">Shoreline and street geometry: City of Toronto · Open Government Licence – Toronto</a> · <a href="https://www.openstreetmap.org/copyright">Physical rail geometry: © OpenStreetMap contributors · ODbL</a></text></g>
</svg>
`;
}
