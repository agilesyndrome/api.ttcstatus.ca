import { mapToGps } from '../../../../shared/map/projection';
import type { ViewerData } from '../../../../shared/map/model';
import { distanceMetres, type Location } from '../../commute';
export interface StopFilters {
  query: string;
  route: string;
  kind: 'all' | 'boarding' | 'terminal';
  accessible: boolean;
  saved: boolean;
  sort: 'name' | 'distance';
}
export const DEFAULT_STOP_FILTERS: StopFilters = {
  query: '',
  route: '',
  kind: 'boarding',
  accessible: false,
  saved: false,
  sort: 'name',
};
export function filterStops(
  data: ViewerData,
  filters: StopFilters,
  saved: string[],
  location?: Location,
) {
  const needle = filters.query.trim().toLocaleLowerCase();
  const routes = new Map(data.routes.map((route) => [route.id, route]));
  const bookmarks = new Set(saved);
  return data.features
    .filter((stop) => {
      const text = [
        stop.name,
        ...stop.routeIds.flatMap((id) => {
          const route = routes.get(id);
          return route ? [route.number, route.name] : [id];
        }),
      ]
        .join(' ')
        .toLocaleLowerCase();
      return (
        (!needle || text.includes(needle)) &&
        (!filters.route || stop.routeIds.includes(filters.route)) &&
        (filters.kind === 'all' ||
          (filters.kind === 'boarding'
            ? stop.boardingPoints > 0
            : stop.kind === 'terminal')) &&
        (!filters.accessible || stop.accessible === true) &&
        (!filters.saved || bookmarks.has(stop.id))
      );
    })
    .map((stop) => ({
      stop,
      metres: location
        ? distanceMetres(location, mapToGps(stop.point, data.geographicTransform))
        : undefined,
    }))
    .sort(
      (a, b) =>
        (filters.sort === 'distance' && location ? a.metres! - b.metres! : 0) ||
        a.stop.name.localeCompare(b.stop.name) ||
        a.stop.id.localeCompare(b.stop.id),
    );
}
