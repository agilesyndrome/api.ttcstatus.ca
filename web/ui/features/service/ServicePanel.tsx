import { useReducer, useState } from 'react';
import type { ServiceWaveResponse } from '../../../../shared/service/contracts';
import type { ServiceFeedState } from './useServiceFeed';
import { ReplayDiagram } from './ReplayDiagram';
import { useServiceHistory } from './useServiceHistory';
import { Sparkline } from './Sparkline';

/** The debug panel (stories 5.2/5.3/5.4): minimal legend, feed status, the
 * space-time replay, and the selected stop's 36-hour sparkline. Ugly is a
 * feature — this is scaffolding for the future polished overlay, gated to
 * named users. */
export function ServicePanel({
  feed,
  wave,
  onRefreshWave,
  reducedMotion,
}: {
  feed: ServiceFeedState;
  wave: ServiceWaveResponse | null;
  onRefreshWave: () => void;
  reducedMotion: boolean;
}) {
  const [open, toggleOpen] = useReducer((value: boolean) => !value, true);
  const [selectedStop, setSelectedStop] = useState<string | null>(null);
  const { history } = useServiceHistory(feed.states.length > 0, selectedStop);
  if (feed.loading) return null;
  const stopOptions = [...new Set(feed.states.map((state) => state.stopId))].sort();
  return (
    <aside className="service-panel" aria-label="Delivered service debug panel">
      <div className="service-panel__bar">
        <strong>voidOverlay</strong>
        <span
          className={
            feed.failed
              ? 'service-panel__status service-panel__status--failed'
              : 'service-panel__status'
          }
        >
          {feed.failed
            ? 'feed failed'
            : feed.at
              ? `tick ${new Date(feed.at).toLocaleTimeString()}`
              : 'waiting'}
        </span>
        <button className="chip" onClick={toggleOpen} aria-expanded={open}>
          {open ? 'hide' : 'show'}
        </button>
      </div>
      {open && (
        <div className="service-panel__body">
          <ul className="service-legend" aria-label="Service states">
            <li>
              <span className="void-swatch void-swatch--fresh" /> fresh
            </li>
            <li>
              <span className="void-swatch void-swatch--due" /> due
            </li>
            <li>
              <span className="void-swatch void-swatch--void" /> void (minutes shown)
            </li>
            <li>
              <span className="void-swatch void-swatch--unmonitored" /> unmonitored
            </li>
            <li>
              <span className="void-swatch void-swatch--collecting" /> collecting
            </li>
            <li>
              <span className="void-swatch void-swatch--b2b" /> back-to-back badge
            </li>
          </ul>
          <div className="service-panel__replay">
            <div className="service-panel__replay-bar">
              <strong>space-time replay</strong>
              <button className="chip" onClick={onRefreshWave}>
                refresh
              </button>
            </div>
            {wave ? (
              <ReplayDiagram wave={wave} reducedMotion={reducedMotion} />
            ) : (
              <p className="service-replay__note">
                {feed.failed
                  ? 'Recorder unreachable — unmonitored, not empty.'
                  : 'Waiting for the wave…'}
              </p>
            )}
          </div>
          {stopOptions.length > 0 && (
            <div className="service-panel__sparkline">
              <div className="service-panel__replay-bar">
                <strong>today so far</strong>
                <select
                  aria-label="Stop history"
                  value={selectedStop ?? ''}
                  onChange={(event) => setSelectedStop(event.target.value || null)}
                >
                  <option value="">select a stop…</option>
                  {stopOptions.map((stopId) => (
                    <option key={stopId} value={stopId}>
                      {stopId}
                    </option>
                  ))}
                </select>
              </div>
              {history && <Sparkline history={history} />}
            </div>
          )}
          <p className="service-panel__note">
            Directional markers are split per stop; unmonitored is hatched, never a void.
          </p>
        </div>
      )}
    </aside>
  );
}
