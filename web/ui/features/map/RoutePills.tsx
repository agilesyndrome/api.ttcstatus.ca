import type { Feature, Route } from '../../../../shared/map/model';
import type { CSSProperties } from 'react';

export function RoutePills({
  features,
  routes,
  scale,
}: {
  features: Feature[];
  routes: Route[];
  scale: number;
}) {
  const routeById = new Map(routes.map((route) => [route.id, route]));
  const seen = new Set<string>();
  return (
    <g className="route-pills" aria-hidden="true">
      {features.flatMap((feature) => {
        const route = feature.routeIds
          .map((id) => routeById.get(id))
          .find((candidate) => candidate && !candidate.overnight);
        if (!route || seen.has(route.id)) return [];
        seen.add(route.id);
        const [x, y] = feature.point;
        return [
          <g
            key={route.id}
            className="route-pill"
            transform={`translate(${x + 8 / scale} ${y + 12 / scale}) scale(${1 / scale})`}
          >
            <rect
              x={-15}
              y={-9}
              width={30}
              height={18}
              rx={7}
              style={{ '--route-color': route.color } as CSSProperties}
            />
            <circle cx={-8} r={3} fill="var(--route-color)" />
            <text x={-2} y={4} fill="var(--route-color)">
              {route.number}
            </text>
          </g>,
        ];
      })}
    </g>
  );
}
