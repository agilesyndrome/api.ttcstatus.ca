import type { StopServiceState } from '../../../../shared/service/contracts';
import { useServiceHistory } from './useServiceHistory';
import { Sparkline } from './Sparkline';
import { StopCard } from './StopCard';
import { STATE_COLORS } from './wave-field';

/** The whole UI surface when a stop is selected (E7S4): its story in plain
 * words, its day view, and one line of legend so the track colours need no
 * manual. Nothing else — the map carries the field. */
export function SelectedStopCard({
  stop,
  name,
  onClear,
}: {
  stop: StopServiceState;
  name?: string;
  onClear: () => void;
}) {
  const { history } = useServiceHistory(true, stop.stopId);
  return (
    <div
      className="service-popover"
      role="dialog"
      aria-label={`Delivered service for ${name ?? stop.stopId}`}
    >
      <StopCard stop={stop} name={name} onClear={onClear} />
      {history && <Sparkline history={history} />}
      <p className="service-popover__legend">
        {(
          [
            ['fresh', 'on time'],
            ['due', 'getting due'],
            ['void', 'dry'],
            ['unmonitored', 'we can’t see'],
          ] as const
        ).map(([state, text]) => (
          <span key={state}>
            <span
              className="void-swatch void-swatch--x"
              style={{ background: STATE_COLORS[state] }}
            />
            {text}
          </span>
        ))}
      </p>
    </div>
  );
}
