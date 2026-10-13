import type { Route } from '../map/model';
import type { MapFilterValues } from './types';

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

export function validFilters(value: unknown): value is MapFilterValues {
  return (
    typeof value === 'object' &&
    value !== null &&
    ['live', 'labels', 'overnight', 'streetcar', 'subway'].every(
      (key) => typeof (value as Record<string, unknown>)[key] === 'boolean',
    ) &&
    (typeof (value as Record<string, unknown>).serviceOverlay === 'boolean' ||
      (value as Record<string, unknown>).serviceOverlay === undefined)
  );
}
