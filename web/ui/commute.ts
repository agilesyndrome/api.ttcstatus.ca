import { getLocale } from './i18n';
import { mapToGps } from '../../shared/map/projection';
import type { PlottedVehicle } from '../../shared/map/live-status';
import type { Feature, Route, ViewerData } from '../../shared/map/model';
import type { MapFilterValues } from './features/map/MapFilters';

export interface Location {
  latitude: number;
  longitude: number;
  accuracy?: number;
}
export type Selection = { kind: 'stop' | 'route' | 'car'; id: string };
export type SidebarPanel = 'explore' | 'fleet' | 'compare' | 'stops' | 'journal';
export interface MapTools {
  panel?: SidebarPanel;
  fromId?: string;
  toId?: string;
}
export interface MapLink extends MapTools {
  selection?: Selection;
  contextRoute?: string;
  filters: Partial<MapFilterValues>;
}
export const DEFAULT_FILTERS: MapFilterValues = {
  live: true,
  labels: false,
  overnight: false,
  streetcar: true,
  subway: true,
};

/** A deliberate stop/route selection should be visible even after hiding its layer. */
export function revealRoutes(
  filters: MapFilterValues,
  routes: Route[],
  ids: string[],
): MapFilterValues {
  const selected = routes.filter((route) => ids.includes(route.id));
  const next = {
    ...filters,
    streetcar:
      filters.streetcar || selected.some((route) => !/^(1|2|4|5|6)$/.test(route.number)),
    subway:
      filters.subway || selected.some((route) => /^(1|2|4|5|6)$/.test(route.number)),
    overnight:
      filters.overnight ||
      (selected.length > 0 && selected.every((route) => route.overnight)),
  };
  return next.streetcar === filters.streetcar &&
    next.subway === filters.subway &&
    next.overnight === filters.overnight
    ? filters
    : next;
}

/** Measure geography, never distances on the compressed schematic. */
export function distanceMetres(a: Location, b: Location): number {
  const radians = Math.PI / 180;
  const latitude = (b.latitude - a.latitude) * radians;
  const longitude = (b.longitude - a.longitude) * radians;
  const h =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(a.latitude * radians) *
      Math.cos(b.latitude * radians) *
      Math.sin(longitude / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}
export function formatDistance(metres: number): string {
  return metres < 1000
    ? `${Math.round(metres / 10) * 10} m`
    : `${new Intl.NumberFormat(getLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(metres / 1000)} km`;
}
export function nearbyStops(
  data: ViewerData,
  location: Location,
  accessibleOnly = false,
) {
  return data.features
    .filter(
      (feature) =>
        feature.boardingPoints > 0 && (!accessibleOnly || feature.accessible === true),
    )
    .map((feature) => ({
      feature,
      metres: distanceMetres(location, mapToGps(feature.point, data.geographicTransform)),
    }))
    .filter((stop) => stop.metres <= 2500)
    .sort((a, b) => a.metres - b.metres || a.feature.id.localeCompare(b.feature.id))
    .slice(0, 5);
}
/** Nearby is proximity only: route, direction and trip stop sequence cannot
 * establish arrival predictions from the vehicle-position feed. */
export function nearbyCars(data: ViewerData, feature: Feature, cars: PlottedVehicle[]) {
  const location = mapToGps(feature.point, data.geographicTransform);
  const rapidRoutes = new Set(
    data.routes
      .filter((route) => /^(1|2|4|5|6)$/.test(route.number))
      .map((route) => route.id),
  );
  return cars
    .filter(
      (car) =>
        !car.stale &&
        car.vehicle.mode !== 'subway' &&
        car.vehicle.positionKind !== 'next-station' &&
        !rapidRoutes.has(car.vehicle.routeId ?? '') &&
        car.vehicle.routeId &&
        feature.routeIds.includes(car.vehicle.routeId),
    )
    .map((car) => ({ car, metres: distanceMetres(location, car.vehicle) }))
    .filter((car) => car.metres <= 2000)
    .sort(
      (a, b) => a.metres - b.metres || a.car.vehicle.id.localeCompare(b.car.vehicle.id),
    )
    .slice(0, 3);
}
export function routeActivity(route: Route, cars: PlottedVehicle[]) {
  const assigned = cars.filter((car) => car.vehicle.routeId === route.id);
  const fresh = assigned.filter((car) => !car.stale);
  const speeds = fresh
    .flatMap((car) =>
      car.vehicle.speedMetresPerSecond === undefined
        ? []
        : [car.vehicle.speedMetresPerSecond * 3.6],
    )
    .sort((a, b) => a - b);
  const middle = Math.floor(speeds.length / 2);
  const medianSpeed = speeds.length
    ? speeds.length % 2
      ? speeds[middle]
      : (speeds[middle - 1] + speeds[middle]) / 2
    : undefined;
  return {
    reported: assigned.length,
    fresh: fresh.length,
    stale: assigned.length - fresh.length,
    medianSpeed,
  };
}
export function readMapLink(hash: string): MapLink {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const filters: Partial<MapFilterValues> = {};
  const tools: MapTools = {};
  const panel = params.get('view');
  if (
    panel === 'fleet' ||
    panel === 'compare' ||
    panel === 'stops' ||
    panel === 'journal'
  )
    tools.panel = panel;
  for (const [param, key] of [
    ['from', 'fromId'],
    ['to', 'toId'],
  ] as const) {
    const id = params.get(param);
    if (id && id.length <= 200) tools[key] = id;
  }
  for (const key of ['live', 'labels', 'overnight', 'streetcar', 'subway'] as const) {
    if (params.get(key) === '1' || params.get(key) === '0')
      filters[key] = params.get(key) === '1';
  }
  const route = params.get('route');
  for (const kind of ['stop', 'car', 'route'] as const) {
    const id = params.get(kind);
    if (id && id.length <= 200)
      return {
        selection: { kind, id },
        filters,
        ...tools,
        ...(kind !== 'route' && route && route.length <= 200
          ? { contextRoute: route }
          : {}),
      };
  }
  return { filters, ...tools };
}
export function mapLinkHash(
  selection: Selection | undefined,
  filters: MapFilterValues,
  contextRoute?: string,
  tools?: MapTools,
): string {
  const params = new URLSearchParams();
  if (selection) params.set(selection.kind, selection.id);
  if (contextRoute && selection?.kind !== 'route') params.set('route', contextRoute);
  if (tools?.panel && tools.panel !== 'explore') params.set('view', tools.panel);
  if (tools?.fromId) params.set('from', tools.fromId);
  if (tools?.toId) params.set('to', tools.toId);
  for (const key of ['live', 'labels', 'overnight', 'streetcar', 'subway'] as const)
    if (filters[key] !== DEFAULT_FILTERS[key]) params.set(key, filters[key] ? '1' : '0');
  return params.size ? `#${params}` : '';
}
export function validFilters(value: unknown): value is MapFilterValues {
  return (
    typeof value === 'object' &&
    value !== null &&
    ['live', 'labels', 'overnight', 'streetcar', 'subway'].every(
      (key) => typeof (value as Record<string, unknown>)[key] === 'boolean',
    )
  );
}
export function validSavedStops(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    new Set(value).size === value.length &&
    value.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 200)
  );
}
