import type { Feature } from '../../../../shared/map/model';
import type { StopServiceState } from '../../../../shared/service/contracts';
import { serviceConfig } from '../../../../shared/service/config';
import { stopSentence } from './wave-field';
import { fieldColour } from '../../../../shared/map/field-palette';
import { useColourMode } from '../../hooks/useColourMode';
import { useTheme } from '../../hooks/useTheme';

export interface SelectedStopMarkerProps {
  stop: StopServiceState;
  features: Feature[];
  selectedStopId: string | null;
  reducedMotion: boolean;
}

const RING_RADIUS = 9;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** The one circle we keep (E7S4): the selected stop's marker — a wait-timer
 * ring that fills toward the void horizon (the dryness r, drawn) with its
 * story on hover. It renders ONLY for the selected stop; the whole-map field
 * lives on the tracks now. Tapping it again (or the card's ×) clears the
 * selection via the camera's `data-service-stop` hit-test. */
export function SelectedStopMarker({
  stop,
  features,
  selectedStopId,
  reducedMotion,
}: SelectedStopMarkerProps) {
  const { colourMode } = useColourMode();
  const { dark } = useTheme();
  if (selectedStopId === null || selectedStopId !== stop.stopId) return null;
  const feature = features.find((entry) => entry.stopIds?.includes(stop.stopId));
  if (!feature) return null;
  const voidThreshold = serviceConfig().voidDrynessRatio;
  const color = fieldColour(stop.state, dark ? 'dark' : 'light', colourMode);
  const fill = stop.dryness === null ? 0 : Math.min(1, stop.dryness / voidThreshold);
  const pulse = stop.state === 'void' && !reducedMotion;
  return (
    <g
      className={`void-marker void-marker--${stop.state}${pulse ? ' void-marker--pulse' : ''}`}
      data-stop-id={stop.stopId}
      data-service-stop={stop.stopId}
      data-state={stop.state}
      transform={`translate(${feature.point[0]} ${feature.point[1]})`}
      role="img"
      aria-label={stopSentence(stop, feature.name)}
    >
      <title>{stopSentence(stop, feature.name)}</title>
      <circle r={RING_RADIUS + 6} fill="transparent" />
      <circle
        className="void-marker__halo"
        r={RING_RADIUS + 5}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray="3 3"
      />
      {stop.state === 'unmonitored' ? (
        <rect
          x={-7}
          y={-7}
          width={14}
          height={14}
          rx={2}
          fill={fieldColour('unmonitored', dark ? 'dark' : 'light', colourMode)}
          opacity={0.3}
          stroke={fieldColour('unmonitored', dark ? 'dark' : 'light', colourMode)}
          strokeWidth={1.5}
        />
      ) : (
        <>
          <circle
            r={RING_RADIUS}
            fill="var(--surface)"
            opacity={0.95}
            stroke="#00000033"
            strokeWidth={1}
          />
          <circle
            r={RING_RADIUS}
            fill="none"
            stroke={color}
            strokeWidth={stop.state === 'void' ? 4 : 3}
            strokeLinecap="round"
            strokeDasharray={
              fill >= 1 ? undefined : `${RING_CIRCUMFERENCE * fill} ${RING_CIRCUMFERENCE}`
            }
            transform="rotate(-90)"
          />
          {stop.state === 'fresh' && <circle r={3} fill={color} />}
        </>
      )}
    </g>
  );
}
