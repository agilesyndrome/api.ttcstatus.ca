import { t, getLocale } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { SegmentedControl } from '../../components/SegmentedControl';
import { trackEvent } from '../../analytics';
import { AccountRequired } from '../accounts/auth';
import type { HomeWorkspaceState } from '../map/useHomeWorkspace';
import {
  REPLAY_QUICK_RANGES,
  REPLAY_SPEEDS,
  REPLAY_RETENTION_MS,
  formatFrameClock,
  quickRangeKeyOf,
  torontoDayString,
  type ReplayRange,
} from './replay';

/** The Replay destination's rail panel — the remote. The map stays mounted
 * beside it as the screen; this panel owns the range (quick spans or a
 * picked Toronto-local day), the speed, the transport (play/pause) and the
 * "frame taken at" readout.
 *
 * Replay is members-only (docs/replay.md): the destination hides from the
 * signed-out nav, the engine never fetches without an account, and a
 * deep-linked panel shows the sign-in gate — the same treatment as the
 * Status report. The live map and the public tick CDN stay world-readable
 * by design; the recorded-ticks TV does not. */
export function ReplayPanel({ workspace }: { workspace: HomeWorkspaceState }) {
  useLanguage();
  const { data, replay } = workspace;
  return (
    <div
      id="panel-replay"
      role="tabpanel"
      aria-label={t('replay.title')}
      className="replay-panel"
    >
      <h2>{t('replay.title')}</h2>
      <p className="replay-intro">{t('replay.intro')}</p>
      <AccountRequired
        heading={t('replay.signInHeading')}
        helper={t('replay.signInBody')}
      >
        {data && replay && <ReplayRemote replay={replay} />}
      </AccountRequired>
    </div>
  );
}

/** The controls themselves — mounted only for signed-in members with map
 * data present. */
function ReplayRemote({ replay }: { replay: NonNullable<HomeWorkspaceState['replay']> }) {
  const locale = getLocale();
  const now = Date.now();
  const day = replay.range.kind === 'day' ? replay.range.day : torontoDayString(now);
  const setRange = (next: ReplayRange) => {
    trackEvent('replayed');
    replay.setRange(next);
  };
  return (
    <>
      <div className="replay-transport">
        <button
          type="button"
          className="replay-play"
          aria-pressed={replay.playing}
          onClick={replay.toggle}
        >
          {replay.playing ? <PauseGlyph /> : <PlayGlyph />}
          {replay.playing ? t('replay.pause') : t('replay.play')}
        </button>
        <div className="replay-frame">
          <span className="replay-frame-time" data-replay-frame>
            {replay.frameMs !== undefined
              ? formatFrameClock(replay.frameMs, locale)
              : '—'}
          </span>
          <span className="replay-frame-label">{t('replay.frameTime')}</span>
        </div>
      </div>
      {replay.failed && (
        <p role="alert" className="replay-note">
          {t('replay.failed')}
        </p>
      )}
      {replay.noData && (
        <p role="alert" className="replay-note">
          {t('replay.noData')}
        </p>
      )}
      {replay.buffering && (
        <p role="status" className="replay-note">
          {t('replay.buffering')}
        </p>
      )}
      {replay.ended && (
        <p role="status" className="replay-note">
          {t('replay.endOfReplay')}
        </p>
      )}
      {!replay.noData && replay.missingTicks > 0 && (
        <p className="replay-note">
          {t('replay.missingFrames', { value1: replay.missingTicks })}
        </p>
      )}
      <h3>{t('replay.rangeLabel')}</h3>
      <SegmentedControl
        label={t('replay.rangeLabel')}
        value={quickRangeKeyOf(replay.range)}
        options={REPLAY_QUICK_RANGES.map((quick) => ({
          value: quick.key,
          label: t(`replay.${quick.key}`),
        }))}
        onChange={(key) => {
          const quick = REPLAY_QUICK_RANGES.find((entry) => entry.key === key);
          if (quick) setRange({ kind: 'relative', durationMs: quick.durationMs });
        }}
      />
      <h3>{t('replay.dayLabel')}</h3>
      <div className="replay-day">
        <input
          type="date"
          value={day}
          min={torontoDayString(now - REPLAY_RETENTION_MS)}
          max={torontoDayString(now)}
          aria-label={t('replay.dayLabel')}
          onChange={(event) => {
            if (event.target.value) setRange({ kind: 'day', day: event.target.value });
          }}
        />
      </div>
      <p className="replay-note replay-day-hint">{t('replay.dayHint')}</p>
      <h3>{t('replay.speedLabel')}</h3>
      <SegmentedControl
        label={t('replay.speedLabel')}
        value={String(replay.speed)}
        options={REPLAY_SPEEDS.map((multiplier) => ({
          value: String(multiplier),
          label: `${multiplier}×`,
        }))}
        onChange={(value) => replay.setSpeed(Number(value))}
      />
      {replay.window && (
        <p className="replay-note">
          {t('replay.playingStatus', { value1: replay.speed })}
        </p>
      )}
    </>
  );
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M4.5 2.8v10.4L13 8z" fill="currentColor" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <rect x="3.6" y="2.8" width="3" height="10.4" rx="0.8" fill="currentColor" />
      <rect x="9.4" y="2.8" width="3" height="10.4" rx="0.8" fill="currentColor" />
    </svg>
  );
}
