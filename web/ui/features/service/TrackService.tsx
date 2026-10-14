import { memo, useMemo, useRef } from 'react';
import type { Edge, Feature } from '../../../../shared/map/model';
import type { PlottedVehicle } from '../../../../shared/map/live-status';
import type { StopServiceState } from '../../../../shared/service/contracts';
import type { ColourMode, FieldTheme } from '../../../../shared/map/field-palette';
import {
  carTrailSegments,
  drynessColor,
  edgeBoundaryAnchors,
  edgeNeighboursByRoute,
  edgeServiceSegments,
  pointAtDisplayDistance,
  severityCrossings,
  streamWidth,
  streamOffset,
  trackFieldSignature,
} from './wave-field';
import type { TrackSegment } from './wave-field';
import { DASH_CYCLE } from './wave-field';

export interface TrackServiceProps {
  edges: Edge[];
  features: Feature[];
  statesByStop: Map<string, StopServiceState>;
  cars?: PlottedVehicle[];
  visibleEdges?: ReadonlySet<string> | null;
  /** Settled screen scale in pixels per map unit. */
  scale?: number;
  selectedRoute?: string;
  theme?: FieldTheme;
  colourMode?: ColourMode;
}

/** Chevrons are the sole direction/motion layer; they remain meaningful when static. */
function chevronPositions(segment: TrackSegment, scale: number) {
  const length = Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
  if (scale <= 0 || scale * length < DASH_CYCLE) return [];
  const totalPixels = scale * length;
  const count = Math.min(8, Math.max(1, Math.floor(totalPixels / DASH_CYCLE)));
  const angle =
    (Math.atan2(segment.y2 - segment.y1, segment.x2 - segment.x1) * 180) / Math.PI;
  const phasePixels = (((segment.phase * scale) % DASH_CYCLE) + DASH_CYCLE) % DASH_CYCLE;
  const positions = [];
  for (let index = -1; index <= count; index += 1) {
    const pixel = DASH_CYCLE / 2 - phasePixels + index * DASH_CYCLE;
    if (pixel < 0 || pixel > totalPixels) continue;
    const ratio = pixel / totalPixels;
    positions.push({
      x: segment.x1 + (segment.x2 - segment.x1) * ratio,
      y: segment.y1 + (segment.y2 - segment.y1) * ratio,
      angle: segment.flowsForward ? angle : angle + 180,
    });
  }
  return positions.slice(0, count);
}

function Chevrons({
  segment,
  scale,
  colour,
  trail = false,
}: {
  segment: TrackSegment;
  scale: number;
  colour: string;
  trail?: boolean;
}) {
  return chevronPositions(segment, scale).map((position, index) => (
    <g
      key={`${trail ? 'trail-' : ''}chevron-${index}`}
      transform={`rotate(${position.angle} ${position.x} ${position.y})`}
      aria-hidden="true"
    >
      <text
        className={`service-chevron service-chevron--${segment.flowsForward ? 'fwd' : 'rev'}${
          trail ? ' service-chevron--trail' : ''
        }`}
        x={position.x}
        y={position.y}
        fill={colour}
        fontSize={(scale < 1.5 ? 9 : 7) / Math.max(scale, 0.25)}
        data-city-zoom={scale < 1.5 ? 'true' : undefined}
        style={{ animationDuration: `${segment.flowSeconds}s` }}
      >
        ›
      </text>
    </g>
  ));
}

export const TrackService = memo(function TrackService({
  edges,
  features,
  statesByStop,
  cars,
  visibleEdges = null,
  scale = 0,
  selectedRoute,
  theme = 'light',
  colourMode = 'standard',
}: TrackServiceProps) {
  const signature = useMemo(
    () => trackFieldSignature(features, statesByStop),
    [features, statesByStop],
  );
  const statesRef = useRef(statesByStop);
  statesRef.current = statesByStop;
  const painted = useMemo(() => {
    const byEdge: Array<{ edgeId: string; context: boolean; segments: TrackSegment[] }> =
      [];
    const neighbours = edgeNeighboursByRoute(edges);
    const boundaries = new Map(
      edges.map((edge) => [
        edge.id,
        edgeBoundaryAnchors(edge, features, statesRef.current),
      ]),
    );
    const seamValuesFor = (edge: Edge) => {
      const values: Array<{ directionId: 0 | 1; at: 'start' | 'end'; dryness: number }> =
        [];
      for (const neighbourId of neighbours.get(edge.id) ?? []) {
        const neighbour = edges.find((candidate) => candidate.id === neighbourId);
        if (!neighbour) continue;
        const at =
          edge.a === neighbour.a || edge.a === neighbour.b
            ? 'start'
            : edge.b === neighbour.a || edge.b === neighbour.b
              ? 'end'
              : null;
        if (!at) continue;
        const neighbourAt =
          at === 'start'
            ? edge.a === neighbour.a
              ? 'start'
              : 'end'
            : edge.b === neighbour.a
              ? 'start'
              : 'end';
        for (const boundary of boundaries.get(neighbour.id) ?? [])
          if (boundary.at === neighbourAt)
            values.push({
              directionId: boundary.directionId,
              at,
              dryness: boundary.dryness,
            });
      }
      return values;
    };
    for (const edge of edges) {
      if (visibleEdges && !visibleEdges.has(edge.id)) continue;
      const segments = edgeServiceSegments(
        edge,
        features,
        statesRef.current,
        undefined,
        undefined,
        seamValuesFor(edge),
      );
      if (segments.length > 0)
        byEdge.push({
          edgeId: edge.id,
          context: Boolean(selectedRoute && !edge.routeIds.includes(selectedRoute)),
          segments,
        });
    }
    return byEdge;
  }, [edges, features, signature, visibleEdges, selectedRoute, theme, colourMode]);
  const trails = useMemo(() => {
    if (!cars?.length) return [];
    const edgesById = new Map(edges.map((edge) => [edge.id, edge]));
    const collected: TrackSegment[] = [];
    for (const car of cars) {
      const edge = car.match ? edgesById.get(car.match.edgeId) : undefined;
      if (!edge) continue;
      if (visibleEdges && !visibleEdges.has(edge.id)) continue;
      collected.push(...carTrailSegments(edge, car, features, statesRef.current));
    }
    return collected;
  }, [cars, edges, features, signature, visibleEdges, selectedRoute]);
  if (painted.length === 0 && trails.length === 0) return null;
  return (
    <g className="service-track" aria-hidden="true">
      {painted.map(({ edgeId, context, segments }, edgeIndex) => {
        const byDirection = new Map<0 | 1, TrackSegment[]>();
        for (const segment of segments) {
          const directed = byDirection.get(segment.directionId) ?? [];
          directed.push(segment);
          byDirection.set(segment.directionId, directed);
        }
        const gradients = segments.map((segment, segmentIndex) => {
          if (segment.state === 'unmonitored') return null;
          const directed = byDirection.get(segment.directionId)!;
          const next = directed[directed.indexOf(segment) + 1];
          const start = drynessColor(segment.dryness, segment.state, theme, colourMode);
          const end =
            next && next.state !== 'unmonitored'
              ? drynessColor(next.dryness, next.state, theme, colourMode)
              : start;
          const { dx, dy } = streamOffset(segment);
          return (
            <linearGradient
              key={segmentIndex}
              id={`service-gradient-${edgeIndex}-${segmentIndex}`}
              gradientUnits="userSpaceOnUse"
              x1={segment.x1 + dx}
              y1={segment.y1 + dy}
              x2={segment.x2 + dx}
              y2={segment.y2 + dy}
            >
              <stop offset="0%" stopColor={start} />
              <stop offset="72%" stopColor={start} />
              <stop offset="100%" stopColor={end} />
            </linearGradient>
          );
        });
        return (
          <g key={edgeId} data-context={context ? 'muted' : undefined}>
            <defs>{gradients}</defs>
            {segments.map((segment, index) => {
              const { dx, dy } = streamOffset(segment);
              const colour = drynessColor(
                segment.dryness,
                segment.state,
                theme,
                colourMode,
              );
              const width = streamWidth(scale);
              return (
                <g key={index}>
                  <line
                    className="service-track-casing"
                    x1={segment.x1 + dx}
                    y1={segment.y1 + dy}
                    x2={segment.x2 + dx}
                    y2={segment.y2 + dy}
                    stroke="var(--surface)"
                    strokeWidth={width + 2 / Math.max(scale, 0.25)}
                    strokeLinecap="round"
                  />
                  <line
                    className="service-track-seg"
                    data-state={segment.state}
                    data-direction={segment.directionId}
                    x1={segment.x1 + dx}
                    y1={segment.y1 + dy}
                    x2={segment.x2 + dx}
                    y2={segment.y2 + dy}
                    stroke={
                      segment.state === 'unmonitored'
                        ? colour
                        : `url(#service-gradient-${edgeIndex}-${index})`
                    }
                    strokeWidth={width}
                    strokeLinecap="round"
                    strokeDasharray={segment.state === 'unmonitored' ? '3 3' : undefined}
                  />
                  {segment.state !== 'unmonitored' && (
                    <g transform={`translate(${dx} ${dy})`}>
                      <Chevrons segment={segment} scale={scale} colour={colour} />
                    </g>
                  )}
                </g>
              );
            })}
            {severityCrossings(segments).map((front, index) => (
              <line
                key={`front-${index}`}
                className="service-severity-front"
                data-front={front.kind}
                x1={front.x - Math.sin((front.angle * Math.PI) / 180) * 2}
                y1={front.y + Math.cos((front.angle * Math.PI) / 180) * 2}
                x2={front.x + Math.sin((front.angle * Math.PI) / 180) * 2}
                y2={front.y - Math.cos((front.angle * Math.PI) / 180) * 2}
                stroke="currentColor"
                strokeWidth={1 / Math.max(scale, 0.25)}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {[0, 1].map((directionId) => {
              const directed = segments.filter(
                (segment) => segment.directionId === directionId,
              );
              if (!directed.length) return null;
              const first = directed[0]!;
              const last = directed.at(-1)!;
              return [first, last].map((segment, index) => {
                const length = Math.hypot(
                  segment.x2 - segment.x1,
                  segment.y2 - segment.y1,
                );
                const point = pointAtDisplayDistance(segment, index === 0 ? 0 : length);
                const offset = streamOffset(segment);
                return (
                  <text
                    key={`terminus-${directionId}-${index}`}
                    className="service-terminus-chevron"
                    x={point.x + offset.dx}
                    y={point.y + offset.dy}
                    fill={drynessColor(segment.dryness, segment.state, theme, colourMode)}
                    fontSize={8 / Math.max(scale, 0.25)}
                    transform={`rotate(${point.angle} ${point.x + offset.dx} ${point.y + offset.dy})`}
                    aria-hidden="true"
                  >
                    ›
                  </text>
                );
              });
            })}
          </g>
        );
      })}
      {trails.map((segment, index) => {
        const { dx, dy } = streamOffset(segment);
        const colour = drynessColor(0, 'fresh', theme, colourMode);
        return (
          <g key={`trail-${index}`} transform={`translate(${dx} ${dy})`}>
            <line
              className="service-trail-seg"
              x1={segment.x1}
              y1={segment.y1}
              x2={segment.x2}
              y2={segment.y2}
              stroke={colour}
              strokeWidth={streamWidth(scale) + 0.4}
              strokeLinecap="round"
            />
            <Chevrons segment={segment} scale={scale} colour={colour} trail />
          </g>
        );
      })}
    </g>
  );
});
