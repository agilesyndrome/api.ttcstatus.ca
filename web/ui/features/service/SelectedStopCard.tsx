import { useState } from 'react';
import type { ReactNode } from 'react';
import type { StopServiceState } from '../../../../shared/service/contracts';
import { useServiceHistory } from './useServiceHistory';
import { Sparkline } from './Sparkline';
import { StopCard } from './StopCard';
import { platformRoutes } from './wave-field';
import { fieldColour } from '../../../../shared/map/field-palette';
import { useColourMode } from '../../hooks/useColourMode';
import { useTheme } from '../../hooks/useTheme';
import type { RouteBadge } from './wave-field';

/** Compact stop status on selection; the day view and track legend expand
 * only when requested. The map carries the field. */
export function SelectedStopCard({
  stop,
  name,
  onClear,
  controls,
  routes,
}: {
  stop: StopServiceState;
  name?: string;
  onClear: () => void;
  /** Route then direction switchers, rendered by the layer (it owns the
   * map's routes, patterns, and sibling platforms). */
  controls?: ReactNode;
  /** Day routes for this platform — the card's details line. */
  routes?: RouteBadge[];
}) {
  const { colourMode } = useColourMode();
  const { dark } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const { history } = useServiceHistory(expanded, stop.stopId);
  return (
    <div
      className="service-popover"
      role="dialog"
      aria-label={`Delivered service for ${name ?? stop.stopId}`}
    >
      <StopCard
        stop={stop}
        name={name}
        onClear={onClear}
        onDetailsToggle={setExpanded}
        controls={controls}
        routes={routes ?? platformRoutes(stop.routeIds, [])}
      >
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
                style={{
                  background: fieldColour(state, dark ? 'dark' : 'light', colourMode),
                }}
              />
              {text}
            </span>
          ))}
        </p>
      </StopCard>
    </div>
  );
}
