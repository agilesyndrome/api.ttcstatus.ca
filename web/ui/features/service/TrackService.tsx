import { memo, useMemo, useRef } from 'react';
import type { Edge, Feature } from '../../../../shared/map/model';
import type { StopServiceState } from '../../../../shared/service/contracts';
import {
  drynessColor,
  edgeServiceSegments,
  STREAM_WIDTH,
  streamOffset,
  trackFieldSignature,
} from './wave-field';
import type { TrackSegment } from './wave-field';

export interface TrackServiceProps {
  edges: Edge[];
  features: Feature[];
  statesByStop: Map<string, StopServiceState>;
}

const DASH_PATTERN = '3 11';

/** The field on the track (E7S4/E7S5): every direction gets its own thin
 * stream riding the track — side by side, never overriding each other. Each
 * stream is coloured by ITS direction's dryness field, flows in ITS travel
 * direction, and its speed is the service itself: brisk when cars come
 * quickly, a slow drift through the void. A direction without data paints
 * nothing; a blind stretch greys without flowing. Sits UNDER cars and labels
 * (the TransitMap underlay slot). Repaints only when the field's quantised
 * signature moves. */
export const TrackService = memo(function TrackService({
  edges,
  features,
  statesByStop,
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
      const segments = edgeServiceSegments(edge, features, statesRef.current);
      if (segments.length > 0) byEdge.push({ edgeId: edge.id, segments });
    }
    return byEdge;
    // Repaints gate on the field's quantised signature, not the 1 Hz map.
    // eslint-disable-next-line
  }, [edges, features, signature]);
  if (painted.length === 0) return null;
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
                    stretches never flow. */}
                {segment.state !== 'unmonitored' && (
                  <line
                    className={`service-track-flow${
                      segment.flowsForward
                        ? ' service-track-flow--fwd'
                        : ' service-track-flow--rev'
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
                    style={{ animationDuration: `${segment.flowSeconds}s` }}
                    opacity={0.55}
                  />
                )}
              </g>
            );
          })}
        </g>
      ))}
    </g>
  );
});
