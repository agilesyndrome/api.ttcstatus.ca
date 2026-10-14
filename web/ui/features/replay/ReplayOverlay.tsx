import { t, getLocale } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import type { ReplayState } from './useReplay';
import { REPLAY_SPEEDS, formatFrameClock, formatScrubClock } from './replay';

/** The replay screen furniture, floating over the map: the frame clock
 * (the moment the visible picture was taken, Toronto time — like a CCTV
 * timestamp), the TV bar (play/pause, the window scrubber and a speed
 * chip) and the focused route's chip. Pointer events pass through the
 * root so panning the map keeps working around it. */
export function ReplayOverlay({
  replay,
  routeNumber,
  onClearFocus,
}: {
  replay: ReplayState;
  /** The focused route's display number, when a route owns the screen. */
  routeNumber?: string;
  onClearFocus?(): void;
}) {
  useLanguage();
  const { window, playheadMs, frameMs, playing, speed, buffering, ended } = replay;
  if (!window || playheadMs === undefined) return null;
  const locale = getLocale();
  const nextSpeed = () => {
    const index = REPLAY_SPEEDS.findIndex((multiplier) => multiplier === speed);
    replay.setSpeed(REPLAY_SPEEDS[(index + 1) % REPLAY_SPEEDS.length]);
  };
  return (
    <div className="replay-tv">
      {routeNumber && (
        <button
          type="button"
          className="replay-focus"
          onClick={onClearFocus}
          title={t('replay.clearFocus')}
        >
          {t('replay.routeLabel', { value1: routeNumber })}{' '}
          <span aria-hidden="true">×</span>
        </button>
      )}
      <div className="replay-clock" data-replaying={playing ? '' : undefined}>
        {frameMs !== undefined
          ? formatFrameClock(frameMs, locale)
          : t('replay.buffering')}
      </div>
      <div className="replay-bar">
        <button
          type="button"
          className="replay-toggle"
          aria-label={playing ? t('replay.pause') : t('replay.play')}
          title={playing ? t('replay.pause') : t('replay.play')}
          onClick={replay.toggle}
        >
          {playing ? <PauseGlyph /> : <PlayGlyph />}
        </button>
        <input
          type="range"
          className="replay-scrub"
          min={window.startMs}
          max={window.endMs}
          step={window.tickMs / 2}
          value={playheadMs}
          aria-label={t('replay.scrubLabel')}
          aria-valuetext={
            frameMs !== undefined ? formatFrameClock(frameMs, locale) : undefined
          }
          onChange={(event) => replay.seek(Number(event.target.value))}
        />
        <button
          type="button"
          className="replay-speed-chip"
          onClick={nextSpeed}
          title={t('replay.speedLabel')}
        >
          {speed}×
        </button>
      </div>
      <div className="replay-scale">
        <span>{formatScrubClock(window.startMs, locale)}</span>
        {buffering && <span role="status">{t('replay.buffering')}</span>}
        {ended && <span role="status">{t('replay.endOfReplay')}</span>}
        <span>{formatScrubClock(window.endMs, locale)}</span>
      </div>
    </div>
  );
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M4.5 2.8v10.4L13 8z" fill="currentColor" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <rect x="3.6" y="2.8" width="3" height="10.4" rx="0.8" fill="currentColor" />
      <rect x="9.4" y="2.8" width="3" height="10.4" rx="0.8" fill="currentColor" />
    </svg>
  );
}
