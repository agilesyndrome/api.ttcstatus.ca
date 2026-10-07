import { memo } from 'react';
import type { ViewerData } from '../../../../shared/map/model';

/**
 * A closed or obstructed stretch of track. Shared by the Snake game's
 * Transit Control disruptions and, later, the explorer's real TTC closure
 * reports — both render through this one component so the visual language
 * stays identical.
 */
export interface TrackClosure {
  /** The graph edges that make up the closed segment. */
  edgeIds: string[];
  /** 'closed' marks a DO-NOT-ENTER; 'stalled' an obstruction to creep past. */
  kind: 'closed' | 'stalled';
}

export const TrackClosures = memo(function TrackClosures({
  data,
  closures,
}: {
  data: ViewerData;
  closures: TrackClosure[];
}) {
  if (!closures.length) return null;
  return (
    <g className="track-closures" pointerEvents="none" aria-hidden="true">
      {closures.flatMap((closure) =>
        closure.edgeIds.flatMap((edgeId) => {
          const edge = data.edges.find((candidate) => candidate.id === edgeId);
          if (!edge || edge.points.length < 2) return [];
          return [
            <polyline
              key={`${closure.kind}:${edgeId}`}
              points={edge.points.map((point) => point.join(',')).join(' ')}
              fill="none"
              data-closure={closure.kind}
              stroke={closure.kind === 'closed' ? '#d71920' : '#f4a300'}
              strokeWidth={10}
              strokeDasharray="16 12"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />,
          ];
        }),
      )}
    </g>
  );
});
