import { memo } from 'react';
import type { CSSProperties } from 'react';
import type { Point } from '../../../../shared/map/model';
import type { TransitMapProps } from './types';
import { DASH_CYCLE } from '../service/wave-field';

export const points = (values: Point[]) =>
  values.map((point) => point.join(',')).join(' ');
type TrackProps = Pick<
  TransitMapProps,
  | 'data'
  | 'selectedRoute'
  | 'serviceMode'
  | 'includeOvernight'
  | 'showStreetcar'
  | 'showSubway'
> & {
  scale?: number;
  /** Clickable per-edge route targets (the replay screen's route focus).
   * Pointer-only — the layer stays aria-hidden like the tracks themselves. */
  onSelectRoute?: (routeId: string) => void;
};

export const Tracks = memo(function Tracks({
  data,
  selectedRoute,
  serviceMode = false,
  includeOvernight,
  showStreetcar = true,
  showSubway = true,
  scale = 0,
  onSelectRoute,
}: TrackProps) {
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
        const subway = activeRoutes.some((candidate) =>
          /^(1|2|4|5|6)$/.test(candidate.number),
        );
        return (
          <g key={edge.id}>
            <polyline
              className="track"
              points={points(edge.points)}
              fill="none"
              stroke={
                serviceMode && !subway && !dimmed ? 'var(--muted)' : 'var(--route-stroke)'
              }
              style={
                (serviceMode && !subway) || dimmed
                  ? undefined
                  : ({ '--route-color': route?.color ?? '#7b8794' } as CSSProperties)
              }
              strokeWidth={activeRoutes.length ? 4.5 : 3}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={activeRoutes.length ? undefined : '6 5'}
              opacity={dimmed ? 0.25 : serviceMode && !subway ? 0.55 : 1}
            />
            {!serviceMode && route && scale > 0 && (
              <g
                className="route-chevron-layer"
                style={{ '--route-color': route.color } as CSSProperties}
                aria-hidden="true"
              >
                {[1, -1].map((direction) => {
                  const midpoint = Math.floor((edge.points.length - 1) / 2);
                  const [x1, y1] = edge.points[midpoint]!;
                  const [x2, y2] = edge.points[midpoint + 1] ?? edge.points[midpoint]!;
                  const length = Math.hypot(x2 - x1, y2 - y1);
                  if (scale * length < DASH_CYCLE) return null;
                  const x = (x1 + x2) / 2;
                  const y = (y1 + y2) / 2;
                  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
                  return (
                    <text
                      key={direction}
                      x={x}
                      y={y}
                      transform={`rotate(${direction === 1 ? angle : angle + 180} ${x} ${y})`}
                      className="route-chevron"
                      fill="var(--route-color)"
                      fontSize={8 / Math.max(scale, 0.25)}
                    >
                      ›
                    </text>
                  );
                })}
              </g>
            )}
          </g>
        );
      })}
      {onSelectRoute &&
        data.edges.map((edge) => {
          const activeRoutes = data.routes
            .filter(
              (route) =>
                (includeOvernight || !route.overnight) &&
                edge.routeIds.includes(route.id),
            )
            .filter((route) =>
              /^(1|2|4|5|6)$/.test(route.number) ? showSubway : showStreetcar,
            );
          const route =
            activeRoutes.find((candidate) => candidate.id === selectedRoute) ??
            activeRoutes[0];
          if (!route) return null;
          return (
            // The camera's tap hit-testing owns this target (the same path
            // as stops and cars): a real click must not also fire here, or
            // one tap would toggle the route focus twice.
            <polyline
              key={`hit-${edge.id}`}
              className="track-hit"
              data-route-hit={route.id}
              points={points(edge.points)}
              fill="none"
              stroke="transparent"
              strokeWidth={16 / Math.max(scale, 0.25)}
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
            />
          );
        })}
    </g>
  );
});
