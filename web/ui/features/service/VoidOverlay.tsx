import { memo } from 'react';
import type { Feature, Point } from '../../../../shared/map/model';
import type { GeographicTransform } from '../../../../shared/map/projection';
import { gpsToMap } from '../../../../shared/map/projection';
import type { StopServiceState } from '../../../../shared/service/contracts';

export interface VoidOverlayProps {
  scale: number;
  features: Feature[];
  statesByStop: Map<string, StopServiceState>;
  /** Dev-only fallback positions (the preview corpus); live data joins on
   * the map's own stop features instead. */
  fallbackPositions: Map<string, { latitude: number; longitude: number }>;
  transform: GeographicTransform;
}

/** The debug overlay v0 (sla.md story 5.2): ugly on purpose, per-user gated
 * upstream. Split directional markers per stop, absolute-minutes labels,
 * back-to-back badges, and hatched *unmonitored* styling distinct from void.
 * Markers counter-scale (`scale(1/scale)`) so they stay constant on screen —
 * the comparison-marker idiom from TransitMap. */
export const VoidOverlay = memo(function VoidOverlay({
  scale,
  features,
  statesByStop,
  fallbackPositions,
  transform,
}: VoidOverlayProps) {
  if (statesByStop.size === 0) return null;
  const pointFor = (state: StopServiceState): Point | null => {
    const feature = features.find((entry) => entry.stopIds?.includes(state.stopId));
    if (feature) return feature.point;
    const fallback = fallbackPositions.get(state.stopId);
    if (!fallback) return null;
    try {
      const [x, y] = gpsToMap(fallback.latitude, fallback.longitude, transform);
      return [x, y];
    } catch {
      return null;
    }
  };
  return (
    <g className="void-overlay" aria-label="Delivered service overlay">
      <defs>
        <pattern
          id="void-unmonitored-hatch"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
        >
          <rect width="6" height="6" fill="transparent" />
          <path d="M0 6L6 0" stroke="#8a8f98" strokeWidth="2" />
        </pattern>
      </defs>
      {[...statesByStop.values()].map((state) => {
        const point = pointFor(state);
        if (!point) return null;
        // Split markers: the two directions sit side by side, so a one-way
        // void is visible as exactly that (sla.md §3.8).
        const directionOffset = state.directionId === 0 ? -7 : 7;
        const minutes =
          state.minutesSince !== null ? Math.round(state.minutesSince * 10) / 10 : null;
        return (
          <g
            key={`${state.stopId}`}
            className={`void-marker void-marker--${state.state}`}
            data-stop-id={state.stopId}
            data-state={state.state}
            data-direction={state.directionId}
            transform={`translate(${point[0] + directionOffset / scale} ${point[1]}) scale(${1 / scale})`}
            role="img"
            aria-label={`${state.stopId}: ${state.state}${minutes !== null ? `, ${minutes} min` : ''}`}
          >
            {state.state === 'unmonitored' ? (
              <rect
                x="-7"
                y="-7"
                width="14"
                height="14"
                fill="url(#void-unmonitored-hatch)"
                stroke="#8a8f98"
                strokeWidth="1.5"
              />
            ) : state.state === 'void' ? (
              <circle r="9" fill="#c0392b" stroke="#2a2d34" strokeWidth="1.5" />
            ) : state.state === 'due' ? (
              <circle r="6.5" fill="none" stroke="#e0a63c" strokeWidth="3" />
            ) : state.state === 'fresh' ? (
              <circle r="4" fill="#4f9d69" />
            ) : (
              <circle
                r="4"
                fill="none"
                stroke="#9aa0aa"
                strokeWidth="1.5"
                strokeDasharray="2 2"
              />
            )}
            {state.state === 'void' && minutes !== null && (
              <text
                y={-13}
                textAnchor="middle"
                fontSize={11}
                fontWeight={700}
                fill="#c0392b"
                stroke="var(--surface)"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {minutes}m
              </text>
            )}
            {state.backToBack > 0 && (
              <text
                y={16}
                textAnchor="middle"
                fontSize={9}
                fontWeight={700}
                fill="#7b4bb7"
                stroke="var(--surface)"
                strokeWidth={3}
                paintOrder="stroke"
              >
                b2b×{state.backToBack}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
});
