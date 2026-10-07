import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { memo, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Point, ViewerData } from '../../../../shared/map/model';
import type { PlottedVehicle } from '../../../../shared/map/live-status';
import { TransitMap, type TransitMapControls } from '../map/TransitMap';
import { TrackClosures } from '../map/TrackClosures';
import { localToMap } from '../../../../shared/map/projection';
import { buildSnakeMap, snakeCars } from './game-map';
import { SnakeEngine, gameMissions, type Mission, type Mode, type Turn } from './engine';

interface Props {
  data: ViewerData;
  cars: PlottedVehicle[];
  onClose(): void;
}
const noSelection = () => {};
const GAME_DRAW_INTERVAL_MS = 50;
const GAME_TICK_INTERVAL_MS = 33;
// The board is derived synchronously from the already-loaded schematic (no
// second network request). Memoize it per schematic so reopening the game is
// instant instead of rebuilding the collapsed board every time.
const snakeBoardCache = new WeakMap<ViewerData, ReturnType<typeof buildSnakeMap>>();
const missionCache = new WeakMap<ViewerData, Mission[]>();
const buildBoard = (source: ViewerData) => {
  let cached = snakeBoardCache.get(source);
  if (!cached) {
    cached = buildSnakeMap(source);
    snakeBoardCache.set(source, cached);
  }
  return cached;
};
const readBest = () => {
  try {
    const value = Number(localStorage.getItem('ttc:snake:v2:best'));
    return Number.isSafeInteger(value) && value > 0 ? value : 1;
  } catch {
    return 1;
  }
};

const MiniTracks = memo(function MiniTracks({ data }: { data: ViewerData }) {
  return (
    <g fill="none" stroke="#697980" strokeWidth={1} vectorEffect="non-scaling-stroke">
      {data.edges.map((edge) => (
        <polyline
          key={edge.id}
          points={edge.points.map((point) => point.join(',')).join(' ')}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
});
function Minimap({ data, point }: { data: ViewerData; point: Point }) {
  useLanguage();
  const { x, y, width, height } = data.bounds;
  return (
    <svg
      className="snake-minimap"
      role="img"
      aria-label={t('snake.networkMinimapShowingYourStreetcar')}
      viewBox={`${x} ${y} ${width} ${height}`}
    >
      <MiniTracks data={data} />
      <circle
        cx={point[0]}
        cy={point[1]}
        r={width / 65}
        fill="#d71920"
        stroke="var(--surface)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export const SnakeGame = memo(function SnakeGame({
  data: sourceData,
  cars: sourceCars,
  onClose,
}: Props) {
  useLanguage();
  useEffect(() => {
    try {
      localStorage.setItem('ttc:snake:v2:played', '1');
    } catch {
      /* Optional achievement storage. */
    }
  }, []);
  const gameMap = useMemo(() => buildBoard(sourceData), [sourceData]);
  const data = gameMap.data;
  const cars = useMemo(() => snakeCars(data, sourceCars), [data, sourceCars]);
  const dialog = useRef<HTMLDialogElement>(null);
  const [touch] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(pointer: coarse)').matches
      : false,
  );
  const engine = useMemo(
    () =>
      new SnakeEngine(data, {
        easySwitches: true,
        gameTraffic: true,
        keyHints: !touch,
        chaos: true,
      }),
    [data, touch],
  );
  const missions = useMemo(() => {
    let cached = missionCache.get(sourceData);
    if (!cached) {
      cached = gameMissions(sourceData);
      missionCache.set(sourceData, cached);
    }
    return cached;
  }, [sourceData]);
  const [mode, setMode] = useState<Mode>('arcade');
  const [missionId, setMissionId] = useState('');
  const [best, setBest] = useState(readBest);
  const [follow, setFollow] = useState(true);
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem('ttc:snake:v2:muted') === '1';
    } catch {
      return false;
    }
  });
  const [, redraw] = useReducer((value) => value + 1, 0);
  const traffic = useRef(cars);
  traffic.current = cars;
  const keys = useRef(new Set<string>());
  const pedals = useRef(new Map<number, number>());
  const audio = useRef<AudioContext | undefined>(undefined);
  const soundMuted = useRef(muted);
  soundMuted.current = muted;
  const followRef = useRef(follow);
  followRef.current = follow;
  const mapControls = useRef<TransitMapControls | null>(null);
  const touches = useRef(new Map<number, Point>());
  const pinching = useRef(false);
  const pinchDistance = useRef(0);
  const swipe = useRef<{ x: number; y: number; multiple: boolean } | undefined>(
    undefined,
  );
  // The game starts zoomed in on the streetcar and zooms out as the train
  // grows (one step per car collected); manual zoom otherwise sticks.
  const grown = useRef(1);
  const originBounds = useMemo(() => {
    const point = engine.pose().point,
      width = data.bounds.width / 12,
      height = (width * data.bounds.height) / data.bounds.width;
    return { x: point[0] - width / 2, y: point[1] - height / 2, width, height };
  }, [engine, data]);

  function chime() {
    if (soundMuted.current || !audio.current || audio.current.state !== 'running') return;
    const context = audio.current;
    [659, 784, 988].forEach((frequency, index) => {
      const oscillator = context.createOscillator(),
        gain = context.createGain(),
        start = context.currentTime + index * 0.09;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.025, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.2);
    });
  }
  function pause() {
    engine.pause();
    keys.current.clear();
    pedals.current.clear();
    // Resuming always re-centers on the streetcar.
    if (engine.status === 'running') setFollow(true);
    redraw();
  }
  function steer(turn: Turn | string) {
    engine.queue(turn);
    redraw();
  }
  function depart() {
    if (!muted) {
      try {
        audio.current ??= new AudioContext();
        void audio.current.resume().catch(() => {});
      } catch {
        /* Silent play remains available. */
      }
    }
    engine.start(
      mode,
      traffic.current,
      missions.find((mission) => mission.id === missionId),
    );
    setFollow(true);
    grown.current = 1;
    keys.current.clear();
    pedals.current.clear();
    redraw();
  }

  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    const preventPageZoom = (event: Event) => {
      if (engine.status === 'running' || engine.status === 'paused')
        event.preventDefault();
    };
    const gestures = ['gesturestart', 'gesturechange', 'gestureend'];
    gestures.forEach((name) =>
      node.addEventListener(name, preventPageZoom, { passive: false }),
    );
    return () => {
      gestures.forEach((name) => node.removeEventListener(name, preventPageZoom));
      node.close();
      void audio.current?.close();
    };
  }, [engine]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('input,select,textarea,a')
      )
        return;
      const key = event.key.toLowerCase();
      if (
        key === ' ' &&
        event.target instanceof HTMLElement &&
        event.target.closest('button')
      )
        return;
      if (!['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) return;
      if (engine.status === 'ready' || engine.status === 'over') return;
      event.preventDefault();
      event.stopPropagation();
      keys.current.add(event.code || key);
      if (key === 'arrowup' || key === 'arrowdown') redraw();
      if (event.repeat) return;
      if (key === 'arrowleft') steer('left');
      else if (key === 'arrowright') steer('right');
      else if (key === ' ') steer('straight');
    };
    const keyup = (event: KeyboardEvent) => {
      keys.current.delete(event.code || event.key.toLowerCase());
      const key = event.key.toLowerCase();
      if (key === 'arrowup' || key === 'arrowdown') redraw();
    };
    const away = () => {
      keys.current.clear();
      pedals.current.clear();
      touches.current.clear();
      pinching.current = false;
      mapControls.current?.cancelGesture();
      if (engine.status === 'running') {
        engine.pause();
        redraw();
      }
    };
    const visibility = () => {
      if (document.hidden) away();
    };
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', away);
    document.addEventListener('visibilitychange', visibility);
    let frame: number,
      previous = 0,
      lastDraw = 0,
      simulationCarry = 0;
    const animate = (now: number) => {
      const wasRunning = engine.status === 'running';
      const wasOver = engine.status === 'over';
      const before = engine.count;
      if (wasRunning) {
        simulationCarry += previous ? Math.min(0.1, (now - previous) / 1000) : 0;
        if (simulationCarry >= GAME_TICK_INTERVAL_MS / 1000) {
          engine.tick(simulationCarry, traffic.current, heldPedals());
          simulationCarry = 0;
          // Each collected car widens the camera one step — but never past a
          // comfortable driving scale, so long trains never over-zoom-out.
          if (engine.count > grown.current) {
            grown.current = engine.count;
            const controls = mapControls.current;
            if (
              controls &&
              controls.cameraWidth() * 1.18 <=
                Math.min(data.bounds.width / 3, data.bounds.width)
            )
              controls.zoomBy(1.18);
          }
          if (followRef.current) mapControls.current?.followPoint(engine.pose().point);
        }
      } else simulationCarry = 0;
      previous = now;
      if (engine.count > before) chime();
      // A run ending mid-tick shows its verdict immediately, not on the next
      // draw interval.
      if (!wasOver && engine.status === 'over') redraw();
      else if (wasRunning && now - lastDraw >= GAME_DRAW_INTERVAL_MS) {
        redraw();
        lastDraw = now;
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', away);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [engine]);
  useEffect(() => {
    if (engine.mode !== 'arcade' || engine.count <= best) return;
    setBest(engine.count);
    try {
      localStorage.setItem('ttc:snake:v2:best', String(engine.count));
    } catch {
      /* A run does not require browser storage. */
    }
  }, [engine.count, best, engine]);

  function heldPedals() {
    const has = (codes: string[]) => codes.some((code) => keys.current.has(code));
    return {
      accelerator:
        has(['ArrowUp', 'arrowup']) || [...pedals.current.values()].includes(1),
      brake: has(['ArrowDown', 'arrowdown']) || [...pedals.current.values()].includes(-1),
    };
  }
  const pose = engine.pose(),
    body = engine.body(),
    upcoming = engine.upcoming(),
    nextStop = engine.nextStop();
  const held = heldPedals();
  const switchArrow = upcoming
    ? (() => {
        const edge = data.edges.find(
          (candidate) => candidate.id === upcoming.selected.edgeId,
        );
        if (!edge) return undefined;
        const lead = Math.min(38, Math.max(1, edge.lengthMetres - 1));
        return engine.pose({
          ...upcoming.selected,
          distance: upcoming.selected.direction === 1 ? lead : edge.lengthMetres - lead,
        });
      })()
    : undefined;
  const fresh = cars.filter(
    (car) => !car.stale && car.match && !engine.collected.has(car.vehicle.id),
  );
  const visibleCars = [
    ...fresh,
    ...engine.gameCars.filter((car) => !engine.collected.has(car.vehicle.id)),
  ];
  const playing = engine.status === 'running' || engine.status === 'paused';
  const pedal = (value: number) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      pedals.current.set(event.pointerId, value);
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) =>
      pedals.current.delete(event.pointerId),
    onPointerCancel: (event: React.PointerEvent<HTMLButtonElement>) =>
      pedals.current.delete(event.pointerId),
    onLostPointerCapture: (event: React.PointerEvent<HTMLButtonElement>) =>
      pedals.current.delete(event.pointerId),
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        pedals.current.set(-value - 10, value);
      }
    },
    onKeyUp: () => pedals.current.delete(-value - 10),
    onBlur: () => pedals.current.delete(-value - 10),
  });
  function pinchStart(event: React.PointerEvent<HTMLDialogElement>) {
    if (event.pointerType !== 'touch' || !playing) return;
    touches.current.set(event.pointerId, [event.clientX, event.clientY]);
    if (touches.current.size < 2) return;
    event.preventDefault();
    event.stopPropagation();
    const [a, b] = [...touches.current.values()];
    pinchDistance.current = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!pinching.current) {
      pinching.current = true;
      keys.current.clear();
      pedals.current.clear();
      swipe.current = undefined;
      mapControls.current?.cancelGesture();
      redraw();
      for (const id of touches.current.keys()) event.currentTarget.setPointerCapture(id);
    }
  }
  function pinchMove(event: React.PointerEvent<HTMLDialogElement>) {
    if (!touches.current.has(event.pointerId)) return;
    touches.current.set(event.pointerId, [event.clientX, event.clientY]);
    if (!pinching.current) return;
    event.preventDefault();
    event.stopPropagation();
    if (touches.current.size < 2) return;
    const [a, b] = [...touches.current.values()],
      distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // Ignore jitter and two-finger pans: without this guard, sub-pixel
    // distance noise zooms the map in and out while the fingers drift.
    const factor =
      distance > 24 && pinchDistance.current > 24 ? pinchDistance.current / distance : 1;
    if (Math.abs(factor - 1) >= 0.04)
      mapControls.current?.zoomBy(factor, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    pinchDistance.current = distance;
  }
  function pinchEnd(event: React.PointerEvent<HTMLDialogElement>) {
    touches.current.delete(event.pointerId);
    if (!pinching.current) return;
    event.preventDefault();
    event.stopPropagation();
    if (!touches.current.size) {
      pinching.current = false;
      pinchDistance.current = 0;
      mapControls.current?.cancelGesture();
    }
  }
  return (
    <dialog
      ref={dialog}
      onPointerDownCapture={pinchStart}
      onPointerMoveCapture={pinchMove}
      onPointerUpCapture={pinchEnd}
      onPointerCancelCapture={pinchEnd}
      className="snake-game"
      aria-labelledby="snake-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        className="snake-world"
        onPointerDown={(event) => {
          if (event.pointerType !== 'touch' || !(event.target as Element).closest('svg'))
            return;
          if (swipe.current) swipe.current.multiple = true;
          else swipe.current = { x: event.clientX, y: event.clientY, multiple: false };
        }}
        onPointerUp={(event) => {
          const start = swipe.current;
          swipe.current = undefined;
          if (!start || start.multiple || event.pointerType !== 'touch') return;
          const dx = event.clientX - start.x,
            dy = event.clientY - start.y;
          if (Math.hypot(dx, dy) < 45) return;
          steer(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : 'straight');
        }}
        onPointerCancel={() => {
          swipe.current = undefined;
        }}
      >
        <TransitMap
          controlsRef={mapControls}
          mapId="snake-map"
          data={data}
          // The game only needs live, matched cars. Stale/off-track reports
          // remain available to the explorer but would add needless SVG nodes
          // and collision work here.
          cars={visibleCars}
          includeOvernight
          showLabels={false}
          showStops={false}
          driving
          focusBounds={originBounds}
          onInteract={() => setFollow(false)}
          onZoomInteract={() => {
            /* Zooming keeps camera following; only panning takes over. */
          }}
          onSelectFeature={noSelection}
          onSelectVehicle={noSelection}
          overlay={(scale) => (
            <g className="snake-train" pointerEvents="none">
              {engine.hazard?.edgeId && engine.hazard.kind !== 'slow' && (
                <TrackClosures
                  data={data}
                  closures={[
                    {
                      edgeIds: [engine.hazard.edgeId],
                      kind: engine.hazard.kind === 'stalled' ? 'stalled' : 'closed',
                    },
                  ]}
                />
              )}
              {switchArrow && (
                <>
                  <path
                    data-snake-switch-arrow
                    data-selection={upcoming?.manual ? 'manual' : 'automatic'}
                    d="M-18 0H10M2 -8L10 0L2 8"
                    transform={`translate(${switchArrow.point.join(' ')}) rotate(${switchArrow.angle}) scale(${1 / scale})`}
                    fill="none"
                    stroke="#16212b"
                    strokeWidth={9}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M-18 0H10M2 -8L10 0L2 8"
                    transform={`translate(${switchArrow.point.join(' ')}) rotate(${switchArrow.angle}) scale(${1 / scale})`}
                    fill="none"
                    stroke="#ffd43b"
                    strokeWidth={5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </>
              )}
              <polyline
                points={body.map((sample) => sample.point.join(',')).join(' ')}
                fill="none"
                stroke="var(--surface)"
                strokeWidth={9}
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
              />
              <polyline
                points={body.map((sample) => sample.point.join(',')).join(' ')}
                fill="none"
                stroke="#278f91"
                strokeWidth={5}
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
              />
              {upcoming && (
                <circle
                  cx={upcoming.point[0]}
                  cy={upcoming.point[1]}
                  r={13 / scale}
                  fill="#f4a30025"
                  stroke="#f4a300"
                  strokeWidth={3}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {engine.carCentres().map((car, index) => {
                const front = localToMap(
                  [
                    car.source[0] + car.tangent[0] * 15.1,
                    car.source[1] + car.tangent[1] * 15.1,
                  ],
                  data.geographicTransform,
                );
                const back = localToMap(
                  [
                    car.source[0] - car.tangent[0] * 15.1,
                    car.source[1] - car.tangent[1] * 15.1,
                  ],
                  data.geographicTransform,
                );
                // True-to-scale car length in screen pixels. Cars sit SPACING
                // metres apart, so the true length always fits without
                // bunching; zoomed out they shrink instead of overlapping
                // (the constant-width body polyline keeps the train legible).
                const length = Math.max(
                  8,
                  Math.hypot(front[0] - back[0], front[1] - back[1]) * scale,
                );
                return (
                  <g
                    key={index}
                    data-snake-head={index === 0 ? '' : undefined}
                    transform={`translate(${car.point.join(' ')}) rotate(${car.angle}) scale(${1 / scale})`}
                  >
                    <rect
                      x={-length / 2}
                      y={-5}
                      width={length}
                      height={10}
                      rx={3}
                      fill="var(--surface)"
                      stroke={index === 0 ? '#278f91' : '#25343c'}
                      strokeWidth={index === 0 ? 2.5 : 1}
                    />
                    <rect
                      x={-length / 2 + 2}
                      y={-2.5}
                      width={length - 4}
                      height={5}
                      rx={1}
                      fill="#d71920"
                    />
                    {[0.25, 0.5, 0.75].map((fraction) => (
                      <path
                        key={fraction}
                        d={`M${-length / 2 + length * fraction} -4V4`}
                        stroke="var(--surface)"
                        strokeWidth={1}
                      />
                    ))}
                    {index === 0 && (
                      <path
                        d={`M${length / 2 - 5} -2L${length / 2 - 1} 0L${length / 2 - 5} 2Z`}
                        fill="white"
                      />
                    )}
                  </g>
                );
              })}
            </g>
          )}
        />
      </div>
      <header className="snake-top">
        <div>
          <strong id="snake-title">{t('snake.streetcarSnake')}</strong>
          <small>
            {engine.status === 'ready'
              ? t('snake.torontoSnakePlayground')
              : `${engine.mode === 'purist' ? t('snake.purist') : t('snake.arcade')} · ${engine.mission ? `${data.routes.find((route) => route.id === engine.mission?.routeId)?.number} · ${engine.destination}` : t('snake.freePlay')}`}
          </small>
        </div>
        <button aria-label={t('snake.closeStreetcarSnake')} onClick={onClose}>
          ✕
        </button>
      </header>
      {playing && <Minimap data={data} point={pose.point} />}
      <div className="snake-hud">
        <span>
          <b data-snake-count>{engine.count}</b>{' '}
          {engine.count === 1 ? t('commute.car') : t('useMapCamera.cars')}
        </span>
        <span>
          <b data-snake-speed>{Math.round(engine.speed)}</b> {t('snake.kmH')}
        </span>
        <span>
          {engine.trips ? t('snake.valueTrips', { value1: engine.trips }) : ''}
          {t('snake.best')} {best}
        </span>
      </div>
      {playing && engine.banner && (
        <div className="snake-event" data-hazard={engine.hazard?.kind} role="status">
          {engine.banner}
        </div>
      )}
      {playing && (
        <div className="snake-status">
          <p className="snake-sr" role="status">
            {t(engine.message)}
          </p>
          {nextStop && (
            <p className="snake-next-stop">
              {t('snake.nextStop')}{' '}
              <b>{nextStop.name.split(/\s+[-–—]\s*/)[0]?.trim() || nextStop.name}</b> ·{' '}
              {Math.round(nextStop.metres)} {t('snake.m')}
            </p>
          )}
        </div>
      )}
      {!playing ? (
        <section className="snake-menu" aria-label={t('snake.gameSetup')}>
          <p className="eyebrow">
            {engine.status === 'over'
              ? t('snake.endOfTheLine')
              : t('snake.yourStreetcarYourSwitches')}
          </p>
          <h1>
            {engine.status === 'over'
              ? engine.gameOverKind === 'closedSection'
                ? t('snake.absolutelyNot')
                : t('snake.serviceSuspended')
              : t('snake.takeTheControls')}
          </h1>
          {engine.status === 'over' && (
            <>
              <p role="status">{t(engine.message)}</p>
              <p className="snake-scoreline">
                {t('snake.valueCarsCoupledBestValue', {
                  value1: engine.count,
                  value2: best,
                })}
              </p>
            </>
          )}
          <label>
            {t('snake.drivingMode')}
            <select
              aria-label={t('snake.drivingMode')}
              value={mode}
              onChange={(event) => setMode(event.target.value as Mode)}
            >
              <option value="arcade">{t('snake.arcadeCollectAndGrow')}</option>
              <option value="purist">{t('snake.puristDriveOneStreetcar')}</option>
            </select>
          </label>
          <label>
            {t('snake.route')}
            <select
              aria-label={t('snake.route')}
              value={missionId}
              onChange={(event) => setMissionId(event.target.value)}
            >
              <option value="">{t('snake.freePlayAllTracks')}</option>
              {missions.map((mission) => (
                <option key={mission.id} value={mission.id}>
                  {mission.label}
                </option>
              ))}
            </select>
          </label>
          <label className="snake-mute">
            <input
              type="checkbox"
              checked={muted}
              onChange={(event) => {
                setMuted(event.target.checked);
                try {
                  localStorage.setItem(
                    'ttc:snake:v2:muted',
                    event.target.checked ? '1' : '0',
                  );
                } catch {
                  /* Optional preference. */
                }
              }}
            />
            {t('snake.muteSounds')}
          </label>
          <button className="primary-action" onClick={depart}>
            {engine.status === 'over' ? t('snake.playAgain') : t('snake.depart')}
          </button>
          <a href="/snake/v1/">{t('snake.playTheClassicOriginal')}</a>
        </section>
      ) : (
        <>
          {engine.status === 'paused' && (
            <div className="snake-paused">
              <strong>{t('snake.paused')}</strong>
              <button onClick={pause}>{t('snake.resumeDriving')}</button>
            </div>
          )}
          {/* No switch nearby: no directional indicators. */}
          {upcoming && (
            <div className="snake-switches" aria-label={t('snake.switchControls')}>
              <div>
                {upcoming.choices.map((choice) => (
                  <button
                    key={choice.edgeId}
                    aria-pressed={upcoming.selected.edgeId === choice.edgeId}
                    data-selection={
                      upcoming.selected.edgeId === choice.edgeId
                        ? upcoming.manual
                          ? 'manual'
                          : 'automatic'
                        : undefined
                    }
                    onClick={() => steer(choice.edgeId)}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="snake-pedals">
            <button
              className="snake-brake"
              aria-pressed={held.brake}
              data-held={held.brake}
              {...pedal(-1)}
            >
              {t('snake.holdToBrake')}
            </button>
            <div>
              <button onClick={pause}>
                {engine.status === 'paused' ? t('snake.resume') : t('snake.pause')}
              </button>
              <button
                aria-pressed={follow}
                onClick={() => setFollow((current) => !current)}
              >
                {follow ? t('snake.following') : t('snake.followCar')}
              </button>
            </div>
            <button
              className="snake-accelerator"
              aria-pressed={held.accelerator}
              data-held={held.accelerator}
              {...pedal(1)}
            >
              {t('snake.holdToAccelerate')}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
});
