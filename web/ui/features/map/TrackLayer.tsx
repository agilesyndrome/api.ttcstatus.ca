import { memo } from 'react';
import type { Point } from '../../../../shared/map/model';
import type { TransitMapProps } from './types';

export const points = (values: Point[]) =>
  values.map((point) => point.join(',')).join(' ');
export const Tracks = memo(function Tracks({
  data,
  selectedRoute,
  includeOvernight,
}: Pick<TransitMapProps, 'data' | 'selectedRoute' | 'includeOvernight'>) {
  return (
    <g aria-hidden="true">
      {data.edges.map((edge) => {
        const activeRoutes = data.routes.filter(
          (route) =>
            (includeOvernight || !route.overnight) && edge.routeIds.includes(route.id),
        );
        const route =
          activeRoutes.find(
            (route) => route.id === selectedRoute && edge.routeIds.includes(route.id),
          ) ??
          activeRoutes.find((route) => !route.overnight) ??
          activeRoutes[0];
        return (
          <polyline
            key={edge.id}
            className="track"
            points={points(edge.points)}
            fill="none"
            stroke={route?.color ?? '#7b8794'}
            strokeWidth={activeRoutes.length ? 4.5 : 3}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={activeRoutes.length ? undefined : '6 5'}
            opacity={selectedRoute && !edge.routeIds.includes(selectedRoute) ? 0.18 : 1}
          />
        );
      })}
    </g>
  );
});
