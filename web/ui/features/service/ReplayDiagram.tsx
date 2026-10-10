import { useMemo, useState } from 'react';
import type { ServiceWaveResponse } from '../../../../shared/service/contracts';

export interface ReplayDiagramProps {
  wave: ServiceWaveResponse;
  reducedMotion: boolean;
}

/** The space-time replay (sla.md story 5.3): the wave of void as pure
 * geometry. Touches are dots on (pattern stop × time); the scrubber walks
 * the 30-minute window. Back-to-back clusters and the empty wedge they drag
 * behind them emerge from the data — no detection step, no animation required
 * (the scrubber is manual; reduced-motion users lose nothing). */
export function ReplayDiagram({ wave, reducedMotion }: ReplayDiagramProps) {
  const routes = wave.routes;
  const [routeIndex, setRouteIndex] = useState(0);
  const [scrubMs, setScrubMs] = useState(0);
  const route = routes[Math.min(routeIndex, routes.length - 1)];
  const span = Math.max(1, wave.windowEnd - wave.windowStart);
  const geometry = useMemo(() => {
    if (!route) return null;
    const width = Math.max(route.patternStopIds.length * 26, 120);
    const height = 240;
    const x = (stopIndex: number) => stopIndex * 26 + 13;
    const y = (dt: number) => (dt / span) * (height - 24) + 12;
    return { width, height, x, y };
  }, [route, span]);
  if (!route || !geometry) return null;
  const scrubY = geometry.y(scrubMs);
  return (
    <div className="service-replay">
      {routes.length > 1 && (
        <div
          className="service-replay__routes"
          role="radiogroup"
          aria-label="Replay direction"
        >
          {routes.map((entry, index) => (
            <button
              key={`${entry.routeId}-${entry.directionId}`}
              role="radio"
              aria-checked={index === routeIndex}
              className={index === routeIndex ? 'chip chip--active' : 'chip'}
              onClick={() => setRouteIndex(index)}
            >
              {entry.routeId} {entry.directionId === 0 ? 'east' : 'west'}
            </button>
          ))}
        </div>
      )}
      <svg
        className="service-replay__plot"
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        role="img"
        aria-label={`Space-time diagram for route ${route.routeId}`}
      >
        {route.patternStopIds.map((stopId, index) =>
          index % Math.max(1, Math.ceil(route.patternStopIds.length / 8)) === 0 ? (
            <text
              key={stopId}
              x={geometry.x(index)}
              y={geometry.height - 4}
              fontSize={8}
              textAnchor="middle"
              fill="#9aa0aa"
            >
              {index + 1}
            </text>
          ) : null,
        )}
        <line
          className="service-replay__scrub"
          x1={0}
          x2={geometry.width}
          y1={scrubY}
          y2={scrubY}
          stroke="#e0a63c"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
        {route.touches.map((touch, index) => (
          <circle
            key={index}
            cx={geometry.x(touch.stopIndex)}
            cy={geometry.y(touch.dt)}
            r={touch.mode === 'subway' ? 2.5 : 3}
            fill={touch.mode === 'subway' ? '#2f6f9f' : '#4f9d69'}
          />
        ))}
      </svg>
      <label className="service-replay__scrubber">
        <span aria-hidden="true">⏱</span>
        <input
          type="range"
          min={0}
          max={span}
          value={scrubMs}
          onChange={(event) => setScrubMs(Number(event.target.value))}
          aria-label="Scrub the 30-minute window"
        />
      </label>
      {reducedMotion && (
        <p className="service-replay__note">
          Manual scrub only — reduced motion respected.
        </p>
      )}
    </div>
  );
}
