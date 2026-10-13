import { memo, useMemo, useRef } from 'react';
import type { Edge, Feature } from '../../../../shared/map/model';
import type { PlottedVehicle } from '../../../../shared/map/live-status';
import type { StopServiceState } from '../../../../shared/service/contracts';
import {
  carTrailSegments,
  drynessColor,
  edgeServiceSegments,
  STATE_COLORS,
  STREAM_WIDTH,
  streamOffset,
  trackFieldSignature,
} from './wave-field';
import type { TrackSegment } from './wave-field';
import { DASH_CYCLE } from './wave-field';

export interface TrackServiceProps {
  edges: Edge[];
  features: Feature[];
  statesByStop: Map<string, StopServiceState>;
  /** Live plotted cars — each matched, non-stale one drags its green snail
   * slime from its head back to the last stop it passed. */
  cars?: PlottedVehicle[];
  /** The cull set (docs/optimize-overlay.md E5S1): only edges near the
   * camera are painted — DOM count scales with the viewport, not the
   * network. Null paints everything (the pre-culling behaviour). */
  visibleEdges?: ReadonlySet<string> | null;
  /** The settled screen scale, px per world unit (E5S2): a flow dash line
   * renders only for segments long enough ON SCREEN to carry at least one
   * dash cycle — city-wide zoom keeps its static colour field (and its
   * battery); street zoom flows. 0 (default) disables all flows. */
  scale?: number;
  selectedRoute?: string;
}

const DASH_PATTERN = '3 11';

/** The field on the track (E7S4–E7S6): every direction paints its own thin
 * stream riding the track — side by side, never overriding each other. Each
 * stream is coloured by ITS direction's dryness field, flows in ITS travel
 * direction, and its speed is the service itself: brisk when cars come
 * quickly, a slow drift through the void. Long stretches subdivide so the
 * gradient bends, and every flow dash carries a phase so a whole route moves
 * as ONE continuous current. Cars that just passed a stretch drag a green
 * trail behind them — the clearing car visible, advancing into the red.
 * Sits UNDER cars and labels (the TransitMap underlay slot). Repaints only
 * when the field's quantised signature or the car positions move. */
export const TrackService = memo(function TrackService({
  edges,
  features,
  statesByStop,
  cars,
  visibleEdges = null,
  scale = 0,
  selectedRoute,
}: TrackServiceProps) {
  // The heartbeat produces a new states map every second; the signature only
  // changes when a quantised value actually moves — that's the repaint gate.
  const signature = useMemo(
    () => trackFieldSignature(features, statesByStop),
    [features, statesByStop],
  );
  const statesRef = useRef(statesByStop);
  statesRef.current = statesByStop;
  const painted = useMemo(() => {
    const byEdge: Array<{ edgeId: string; segments: TrackSegment[] }> = [];
    for (const edge of edges) {
      // E5S1: only edges near the camera paint — the whole network's DOM
      // never rides a route-level zoom.
      if (visibleEdges && !visibleEdges.has(edge.id)) continue;
      if (selectedRoute && !edge.routeIds.includes(selectedRoute)) continue;
      const segments = edgeServiceSegments(edge, features, statesRef.current);
      if (segments.length > 0) byEdge.push({ edgeId: edge.id, segments });
    }
    return byEdge;
    // Repaints gate on the field's quantised signature, not the 1 Hz map.
  }, [edges, features, signature, visibleEdges, selectedRoute]);
  const trails = useMemo(() => {
    if (!cars || cars.length === 0) return [];
    const edgesById = new Map(edges.map((edge) => [edge.id, edge]));
    const collected: TrackSegment[] = [];
    for (const car of cars) {
      const edge = car.match ? edgesById.get(car.match.edgeId) : undefined;
      if (!edge) continue;
      if (visibleEdges && !visibleEdges.has(edge.id)) continue;
      if (selectedRoute && !edge.routeIds.includes(selectedRoute)) continue;
      collected.push(...carTrailSegments(edge, car, features, statesRef.current));
    }
    return collected;
  }, [cars, edges, features, signature, visibleEdges, selectedRoute]);
  /** E5S2: a flow dash renders only when the segment is long enough on
   * screen to carry at least one dash cycle — the colour line always stays. */
  const flows = (segment: TrackSegment) =>
    scale > 0 &&
    scale * Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1) >= DASH_CYCLE;
  if (painted.length === 0 && trails.length === 0) return null;
  return (
    <g className="service-track" aria-hidden="true">
      {painted.map(({ edgeId, segments }) => (
        <g key={edgeId}>
          {segments.map((segment, index) => {
            const { dx, dy } = streamOffset(segment);
            return (
              <g key={index}>
                <line
                  className="service-track-seg"
                  data-state={segment.state}
                  data-direction={segment.directionId}
                  x1={segment.x1 + dx}
                  y1={segment.y1 + dy}
                  x2={segment.x2 + dx}
                  y2={segment.y2 + dy}
                  stroke={drynessColor(segment.dryness, segment.state)}
                  strokeWidth={STREAM_WIDTH}
                  strokeLinecap="round"
                  strokeDasharray={segment.state === 'unmonitored' ? '3 3' : undefined}
                  opacity={segment.state === 'unmonitored' ? 0.6 : 0.95}
                />
                {/* The flow: this direction's own stream, moving in its
                    travel direction, at the speed its service earns. Blind
                    stretches never flow; at city-wide zoom nothing flows
                    (E5S2 — the static colour carries the information, the
                    battery stays). The --dash-start phase keeps the
                    dashes continuous across the whole route. */}
                {segment.state !== 'unmonitored' && flows(segment) && (
                  <line
                    className={`service-track-flow service-flow--${
                      segment.flowsForward ? 'fwd' : 'rev'
                    }`}
                    data-state={segment.state}
                    x1={segment.x1 + dx}
                    y1={segment.y1 + dy}
                    x2={segment.x2 + dx}
                    y2={segment.y2 + dy}
                    stroke={drynessColor(segment.dryness, segment.state)}
                    strokeWidth={STREAM_WIDTH}
                    strokeLinecap="round"
                    strokeDasharray={DASH_PATTERN}
                    style={
                      {
                        '--dash-start': `${segment.phase}px`,
                        animationDuration: `${segment.flowSeconds}s`,
                      } as React.CSSProperties
                    }
                    opacity={0.55}
                  />
                )}
              </g>
            );
          })}
        </g>
      ))}
      {/* The snail slime: freshly serviced track behind each car, green and
          brisk — the delay being cleared, visible. */}
      {trails.map((segment, index) => {
        const { dx, dy } = streamOffset(segment);
        return (
          <g key={`trail-${index}`}>
            <line
              className="service-trail-seg"
              x1={segment.x1 + dx}
              y1={segment.y1 + dy}
              x2={segment.x2 + dx}
              y2={segment.y2 + dy}
              stroke={STATE_COLORS.fresh}
              strokeWidth={STREAM_WIDTH + 0.4}
              strokeLinecap="round"
              opacity={0.95}
            />
            {flows(segment) && (
              <line
                className={`service-trail-flow service-flow--${
                  segment.flowsForward ? 'fwd' : 'rev'
                }`}
                x1={segment.x1 + dx}
                y1={segment.y1 + dy}
                x2={segment.x2 + dx}
                y2={segment.y2 + dy}
                stroke={STATE_COLORS.fresh}
                strokeWidth={STREAM_WIDTH + 0.4}
                strokeLinecap="round"
                strokeDasharray={DASH_PATTERN}
                style={
                  {
                    '--dash-start': `${segment.phase}px`,
                    animationDuration: `${segment.flowSeconds}s`,
                  } as React.CSSProperties
                }
                opacity={0.5}
              />
            )}
          </g>
        );
      })}
    </g>
  );
});
