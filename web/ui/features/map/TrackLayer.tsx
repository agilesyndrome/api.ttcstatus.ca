import { memo } from 'react';
import type { Point } from '../../../../shared/map/model';
import type { TransitMapProps } from './types';

export const points = (values: Point[]) =>
  values.map((point) => point.join(',')).join(' ');
export const Tracks = memo(function Tracks({
  data,
  selectedRoute,
  serviceMode = false,
  includeOvernight,
  showStreetcar = true,
  showSubway = true,
}: Pick<
  TransitMapProps,
  | 'data'
  | 'selectedRoute'
  | 'serviceMode'
  | 'includeOvernight'
  | 'showStreetcar'
  | 'showSubway'
>) {
  return (
    <g aria-hidden="true">
      {data.edges.map((edge) => {
        const activeRoutes = data.routes
          .filter(
            (route) =>
              (includeOvernight || !route.overnight) && edge.routeIds.includes(route.id),
          )
          .filter((route) =>
            /^(1|2|4|5|6)$/.test(route.number) ? showSubway : showStreetcar,
          );
        const route =
          activeRoutes.find(
            (route) => route.id === selectedRoute && edge.routeIds.includes(route.id),
          ) ??
          activeRoutes.find((route) => !route.overnight) ??
          activeRoutes[0];
        const dimmed = Boolean(selectedRoute && !edge.routeIds.includes(selectedRoute));
        return (
          <polyline
            key={edge.id}
            className="track"
            points={points(edge.points)}
            fill="none"
            stroke={
              serviceMode
                ? 'var(--muted)'
                : dimmed
                  ? 'var(--muted)'
                  : (route?.color ?? '#7b8794')
            }
            strokeWidth={activeRoutes.length ? 4.5 : 3}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={activeRoutes.length ? undefined : '6 5'}
            opacity={dimmed ? 0.25 : serviceMode ? 0.55 : 1}
          />
        );
      })}
    </g>
  );
});
