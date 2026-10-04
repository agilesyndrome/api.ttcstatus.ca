import { memo, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Point, ViewerData } from '../../../../shared/map/model';
import type { PlottedVehicle } from '../../../../shared/map/live-status';
import type { FeedState } from '../map/LiveFeedStatus';
import { TransitMap, type TransitMapControls } from '../map/TransitMap';
import { localToMap } from '../../../../shared/map/projection';
import { buildSnakeMap, snakeCars } from './game-map';
import { SnakeEngine, gameMissions, type Mode, type Turn } from './engine';

interface Props {
  data: ViewerData;
  cars: PlottedVehicle[];
  feed: FeedState;
  onClose(): void;
}
const noSelection = () => {};
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
  const { x, y, width, height } = data.bounds;
  return (
    <svg
      className="snake-minimap"
      role="img"
      aria-label="Network minimap showing your streetcar"
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

export function SnakeGame({ data: sourceData, cars: sourceCars, feed, onClose }: Props) {
  const gameMap = useMemo(() => buildSnakeMap(sourceData), [sourceData]);
  const data = gameMap.data;
  const cars = useMemo(() => snakeCars(data, sourceCars), [data, sourceCars]);
  const dialog = useRef<HTMLDialogElement>(null);
  const engine = useMemo(() => new SnakeEngine(data, { easySwitches: true }), [data]);
  const missions = useMemo(() => gameMissions(data), [data]);
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
  const mapControls = useRef<TransitMapControls | null>(null);
  const touches = useRef(new Map<number, Point>());
  const pinching = useRef(false);
  const pinchDistance = useRef(0);
  const swipe = useRef<{ x: number; y: number; multiple: boolean } | undefined>(
    undefined,
  );
  const originBounds = useMemo(() => {
    const point = engine.pose().point,
      width = data.bounds.width / 7,
      height = data.bounds.height / 7;
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
      if (
        ![
          'arrowup',
          'arrowdown',
          'arrowleft',
          'arrowright',
          ' ',
          '+',
          '=',
          '-',
          '_',
          'q',
          'e',
          'r',
          'p',
        ].includes(key)
      )
        return;
      if (engine.status === 'ready' || engine.status === 'over') return;
      event.preventDefault();
      event.stopPropagation();
      keys.current.add(event.code || key);
      if (event.repeat) return;
      if (key === 'p') pause();
      else if (key === 'arrowleft' || key === 'q') steer('left');
      else if (key === 'arrowright' || key === 'e') steer('right');
      else if (key === ' ' || key === 'r') steer('straight');
    };
    const keyup = (event: KeyboardEvent) =>
      keys.current.delete(event.code || event.key.toLowerCase());
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
      lastDraw = 0;
    const animate = (now: number) => {
      const before = engine.count;
      engine.tick(previous ? (now - previous) / 1000 : 0, traffic.current, heldPedals());
      previous = now;
      if (engine.count > before) chime();
      if (now - lastDraw >= 32) {
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
        has(['ArrowUp', 'Equal', 'NumpadAdd', 'arrowup', '+', '=']) ||
        [...pedals.current.values()].includes(1),
      brake:
        has(['ArrowDown', 'Minus', 'NumpadSubtract', 'arrowdown', '-', '_']) ||
        [...pedals.current.values()].includes(-1),
    };
  }
  const pose = engine.pose(),
    body = engine.body(),
    upcoming = engine.upcoming(),
    nextStop = engine.nextStop();
  const preview = engine.routePreview((upcoming?.distance ?? 0) + 85),
    held = heldPedals();
  const previewEnd = preview.at(-1)!,
    previewBefore = preview.at(-2) ?? previewEnd;
  const previewAngle =
    (Math.atan2(previewEnd[1] - previewBefore[1], previewEnd[0] - previewBefore[0]) *
      180) /
    Math.PI;
  const fresh = cars.filter(
    (car) => !car.stale && car.match && !engine.collected.has(car.vehicle.id),
  );
  const visibleCars = cars.filter((car) => !engine.collected.has(car.vehicle.id));
  const playing = engine.status === 'running' || engine.status === 'paused';
  const feedText = feed.failed
    ? 'Live refresh unavailable · using fresh reports only'
    : !feed.active
      ? 'Live feed paused · using fresh reports only'
      : fresh.length
        ? `${fresh.length} fresh streetcars on the map`
        : 'Waiting for fresh streetcar positions';
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
    if (distance && pinchDistance.current)
      mapControls.current?.zoomBy(pinchDistance.current / distance, [
        (a[0] + b[0]) / 2,
        (a[1] + b[1]) / 2,
      ]);
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
          cars={visibleCars}
          includeOvernight
          showLabels
          driving
          focusPoint={follow && playing ? pose.point : undefined}
          focusBounds={originBounds}
          onInteract={() => setFollow(false)}
          onSelectFeature={noSelection}
          onSelectVehicle={noSelection}
          overlay={(scale) => (
            <g className="snake-train" pointerEvents="none">
              <polyline
                data-snake-route-preview
                data-selection={upcoming?.manual ? 'manual' : 'automatic'}
                points={preview.map((point) => point.join(',')).join(' ')}
                fill="none"
                stroke="var(--surface)"
                strokeWidth={9}
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
              />
              <polyline
                points={preview.map((point) => point.join(',')).join(' ')}
                fill="none"
                stroke="#087f5b"
                strokeWidth={5}
                strokeDasharray={upcoming?.manual ? undefined : '6 4'}
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                opacity={0.85}
              />
              {preview.length > 1 && (
                <path
                  d="M-8 -6L0 0L-8 6"
                  transform={`translate(${previewEnd.join(' ')}) rotate(${previewAngle}) scale(${1 / scale})`}
                  fill="none"
                  stroke="#087f5b"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
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
                const length = Math.max(
                  18,
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
          <strong id="snake-title">🐍 Streetcar Snake</strong>
          <small>
            {engine.status === 'ready'
              ? 'Toronto · Snake playground'
              : `${engine.mode === 'purist' ? 'Purist' : 'Arcade'} · ${engine.mission ? `${data.routes.find((route) => route.id === engine.mission?.routeId)?.number} · ${engine.destination}` : 'Free play'}`}
          </small>
        </div>
        <button aria-label="Close Streetcar Snake" onClick={onClose}>
          ✕
        </button>
      </header>
      {playing && <Minimap data={data} point={pose.point} />}
      <div className="snake-hud">
        <span>
          <b data-snake-count>{engine.count}</b> {engine.count === 1 ? 'car' : 'cars'}
        </span>
        <span>
          <b data-snake-speed>{Math.round(engine.speed)}</b> km/h
        </span>
        <span>
          {engine.trips ? `${engine.trips} trips · ` : ''}Best {best}
        </span>
      </div>
      {playing && (
        <div className="snake-status">
          <p role="status">{engine.message}</p>
          {nextStop && (
            <p>
              Next stop: {nextStop.name} · {Math.round(nextStop.metres)} m
            </p>
          )}
          <small>{feedText}</small>
          {feed.snapshot && (
            <small>
              Positions:{' '}
              {new Date(
                feed.snapshot.feedTimestamp ?? feed.snapshot.fetchedAt,
              ).toLocaleTimeString()}{' '}
              · {feed.snapshot.attribution}
            </small>
          )}
        </div>
      )}
      {!playing ? (
        <section className="snake-menu" aria-label="Game setup">
          <p className="eyebrow">
            {engine.status === 'over'
              ? 'End of the line'
              : 'Your streetcar. Your switches.'}
          </p>
          <h1>{engine.status === 'over' ? 'Game over' : 'Take the controls'}</h1>
          {engine.status === 'over' && <p role="status">{engine.message}</p>}
          <label>
            Driving mode
            <select
              aria-label="Driving mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as Mode)}
            >
              <option value="arcade">Arcade — collect and grow</option>
              <option value="purist">Purist — drive one streetcar</option>
            </select>
          </label>
          <p>
            {mode === 'arcade'
              ? 'Couple live streetcars into an ever longer train. Avoid your own tail. Start at 180 km/h, with arcade overdrive up to 2000.'
              : 'Drive one streetcar at up to 50 km/h. Touch another streetcar and the run ends.'}
          </p>
          <label>
            Route
            <select
              aria-label="Route"
              value={missionId}
              onChange={(event) => setMissionId(event.target.value)}
            >
              <option value="">Free play — all tracks</option>
              {missions.map((mission) => (
                <option key={mission.id} value={mission.id}>
                  {mission.label}
                </option>
              ))}
            </select>
          </label>
          <p>
            Route missions follow the signed path. Reach the terminal for a return trip
            and, in arcade, a bonus car. Manual switches let you divert.
          </p>
          <p>
            A Toronto playground with simpler junctions and automatic terminal turns. Pick
            your next switch early — it stays selected until you reach it.
            {gameMap.transfers.length > 0 &&
              ' Take a Subway transfer to snake between lines.'}
          </p>
          <p className="snake-instructions">
            ↑ / ↓ accelerate and brake · ← / → / Space (or Q / E / R) throw switches · P
            pauses. On mobile, hold the pedals and tap a switch or swipe. Pinch to zoom.
          </p>
          <p className="snake-feed-note">
            {feedText}. Only fresh, on-track reports count. Positions update with the
            map’s live feed.
          </p>
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
            Mute sounds
          </label>
          <button className="primary-action" onClick={depart}>
            {engine.status === 'over' ? 'Play again' : 'Depart'}
          </button>
          <a href="/snake/v1/">Play the classic original ↗</a>
        </section>
      ) : (
        <>
          {engine.status === 'paused' && (
            <div className="snake-paused">
              <strong>Paused</strong>
              <button onClick={pause}>Resume driving</button>
            </div>
          )}
          <div className="snake-switches" aria-label="Switch controls">
            <small>
              {engine.turningAround
                ? `Turning around · ${Math.round(engine.turnbackRemaining)} m`
                : upcoming
                  ? `${upcoming.manual ? 'Selected' : 'Auto'}: ${upcoming.selected.label} · ${Math.round(upcoming.distance)} m`
                  : engine.queued
                    ? `Queued: ${engine.queued}`
                    : 'Queue the next switch'}
            </small>
            <div>
              {upcoming
                ? upcoming.choices.map((choice) => (
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
                  ))
                : (['left', 'straight', 'right'] as Turn[]).map((turn) => (
                    <button
                      key={turn}
                      aria-pressed={engine.queued === turn}
                      onClick={() => steer(turn)}
                    >
                      {turn === 'left'
                        ? '← Left'
                        : turn === 'right'
                          ? 'Right →'
                          : '↑ Straight'}
                    </button>
                  ))}
            </div>
          </div>
          <div className="snake-pedals">
            <button
              className="snake-brake"
              aria-pressed={held.brake}
              data-held={held.brake}
              {...pedal(-1)}
            >
              Hold to brake
            </button>
            <div>
              <button onClick={pause}>
                {engine.status === 'paused' ? 'Resume' : 'Pause'}
              </button>
              <button
                aria-pressed={follow}
                onClick={() => setFollow((current) => !current)}
              >
                {follow ? 'Following' : 'Follow car'}
              </button>
            </div>
            <button
              className="snake-accelerator"
              aria-pressed={held.accelerator}
              data-held={held.accelerator}
              {...pedal(1)}
            >
              Hold to accelerate
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
