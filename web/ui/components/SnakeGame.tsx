import { memo, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Point, ViewerData } from '../../map/model';
import type { PlottedVehicle } from '../../map/live-status';
import type { FeedState } from './LiveFeedStatus';
import { TransitMap } from './TransitMap';
import { localToMap } from '../../../workers/shared/map-projection';
import { SnakeEngine, gameMissions, type Mode, type Turn } from '../snake/engine';

interface Props { data: ViewerData; cars: PlottedVehicle[]; feed: FeedState; onClose(): void }
const noSelection = () => {};
const readBest = () => { try { const value = Number(localStorage.getItem('ttc:snake:v2:best')); return Number.isSafeInteger(value) && value > 0 ? value : 1; } catch { return 1; } };

const MiniTracks = memo(function MiniTracks({ data }: { data: ViewerData }) {
  return <g fill="none" stroke="#697980" strokeWidth={1} vectorEffect="non-scaling-stroke">{data.edges.map(edge => <polyline key={edge.id} points={edge.points.map(point => point.join(',')).join(' ')} vectorEffect="non-scaling-stroke" />)}</g>;
});
function Minimap({ data, point }: { data: ViewerData; point: Point }) {
  const { x, y, width, height } = data.bounds;
  return <svg className="snake-minimap" role="img" aria-label="Network minimap showing your streetcar" viewBox={`${x} ${y} ${width} ${height}`}><MiniTracks data={data} /><circle cx={point[0]} cy={point[1]} r={width / 65} fill="#d71920" stroke="var(--surface)" strokeWidth={2} vectorEffect="non-scaling-stroke" /></svg>;
}

export function SnakeGame({ data, cars, feed, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const engine = useMemo(() => new SnakeEngine(data), [data]);
  const missions = useMemo(() => gameMissions(data), [data]);
  const [mode, setMode] = useState<Mode>('arcade');
  const [missionId, setMissionId] = useState('');
  const [best, setBest] = useState(readBest);
  const [follow, setFollow] = useState(true);
  const [muted, setMuted] = useState(() => { try { return localStorage.getItem('ttc:snake:v2:muted') === '1'; } catch { return false; } });
  const [, redraw] = useReducer(value => value + 1, 0);
  const traffic = useRef(cars); traffic.current = cars;
  const keys = useRef(new Set<string>());
  const pedals = useRef(new Map<number, number>());
  const audio = useRef<AudioContext | undefined>(undefined);
  const soundMuted = useRef(muted); soundMuted.current = muted;
  const swipe = useRef<{ x: number; y: number; multiple: boolean } | undefined>(undefined);
  const originBounds = useMemo(() => {
    const point = engine.pose().point, width = data.bounds.width / 7, height = data.bounds.height / 7;
    return { x: point[0] - width / 2, y: point[1] - height / 2, width, height };
  }, [engine, data]);

  function chime() {
    if (soundMuted.current || !audio.current || audio.current.state !== 'running') return;
    const context = audio.current;
    [659, 784, 988].forEach((frequency, index) => {
      const oscillator = context.createOscillator(), gain = context.createGain(), start = context.currentTime + index * .09;
      oscillator.frequency.value = frequency; gain.gain.setValueAtTime(.025, start); gain.gain.exponentialRampToValueAtTime(.001, start + .2);
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(start); oscillator.stop(start + .2);
    });
  }
  function pause() { engine.pause(); keys.current.clear(); pedals.current.clear(); redraw(); }
  function steer(turn: Turn | string) { engine.queue(turn); redraw(); }
  function depart() {
    if (!muted) {
      try { audio.current ??= new AudioContext(); void audio.current.resume().catch(() => {}); } catch { /* Silent play remains available. */ }
    }
    engine.start(mode, traffic.current, missions.find(mission => mission.id === missionId));
    setFollow(true); keys.current.clear(); pedals.current.clear(); redraw();
  }

  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => { node.close(); void audio.current?.close(); };
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      if (event.target instanceof HTMLElement && event.target.closest('input,select,textarea,a')) return;
      const key = event.key.toLowerCase();
      if (key === ' ' && event.target instanceof HTMLElement && event.target.closest('button')) return;
      if (!['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', '+', '=', '-', 'p'].includes(key)) return;
      if (engine.status === 'ready' || engine.status === 'over') return;
      event.preventDefault(); event.stopPropagation();
      keys.current.add(key);
      if (event.repeat) return;
      if (key === 'p') pause();
      else if (key === 'arrowleft') steer('left');
      else if (key === 'arrowright') steer('right');
      else if (key === ' ') steer('straight');
    };
    const keyup = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase());
    const away = () => { keys.current.clear(); pedals.current.clear(); if (engine.status === 'running') { engine.pause(); redraw(); } };
    const visibility = () => { if (document.hidden) away(); };
    window.addEventListener('keydown', keydown, true); window.addEventListener('keyup', keyup);
    window.addEventListener('blur', away); document.addEventListener('visibilitychange', visibility);
    let frame: number, previous = 0, lastDraw = 0;
    const animate = (now: number) => {
      const before = engine.count;
      const brake = keys.current.has('arrowdown') || keys.current.has('-') || [...pedals.current.values()].includes(-1);
      const throttle = keys.current.has('arrowup') || keys.current.has('+') || keys.current.has('=') || [...pedals.current.values()].includes(1);
      engine.tick(previous ? (now - previous) / 1000 : 0, traffic.current, brake ? -1 : throttle ? 1 : 0);
      previous = now;
      if (engine.count > before) chime();
      if (now - lastDraw >= 32) { redraw(); lastDraw = now; }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame); window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', away); document.removeEventListener('visibilitychange', visibility);
    };
  }, [engine]);
  useEffect(() => {
    if (engine.mode !== 'arcade' || engine.count <= best) return;
    setBest(engine.count);
    try { localStorage.setItem('ttc:snake:v2:best', String(engine.count)); } catch { /* A run does not require browser storage. */ }
  }, [engine.count, best, engine]);

  const pose = engine.pose(), body = engine.body(), upcoming = engine.upcoming(), nextStop = engine.nextStop();
  const fresh = cars.filter(car => !car.stale && car.match && !engine.collected.has(car.vehicle.id));
  const visibleCars = cars.filter(car => !engine.collected.has(car.vehicle.id));
  const playing = engine.status === 'running' || engine.status === 'paused';
  const feedText = feed.failed ? 'Live refresh unavailable · using fresh reports only' : !feed.active ? 'Live feed paused · using fresh reports only' : fresh.length ? `${fresh.length} fresh streetcars on the map` : 'Waiting for fresh streetcar positions';
  const pedal = (value: number) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); pedals.current.set(event.pointerId, value); },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => pedals.current.delete(event.pointerId),
    onPointerCancel: (event: React.PointerEvent<HTMLButtonElement>) => pedals.current.delete(event.pointerId),
    onLostPointerCapture: (event: React.PointerEvent<HTMLButtonElement>) => pedals.current.delete(event.pointerId),
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pedals.current.set(-value - 10, value); } },
    onKeyUp: () => pedals.current.delete(-value - 10),
    onBlur: () => pedals.current.delete(-value - 10),
  });
  return <dialog ref={dialog} className="snake-game" aria-labelledby="snake-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="snake-world" onPointerDown={event => {
      if (event.pointerType !== 'touch' || !(event.target as Element).closest('svg')) return;
      if (swipe.current) swipe.current.multiple = true;
      else swipe.current = { x: event.clientX, y: event.clientY, multiple: false };
    }} onPointerUp={event => {
      const start = swipe.current; swipe.current = undefined;
      if (!start || start.multiple || event.pointerType !== 'touch') return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (Math.hypot(dx, dy) < 45) return;
      steer(Math.abs(dx) > Math.abs(dy) ? dx < 0 ? 'left' : 'right' : 'straight');
    }} onPointerCancel={() => { swipe.current = undefined; }}>
      <TransitMap mapId="snake-map" data={data} cars={visibleCars} includeOvernight showLabels driving focusPoint={follow && playing ? pose.point : undefined} focusBounds={originBounds} onInteract={() => setFollow(false)} onSelectFeature={noSelection} onSelectVehicle={noSelection} overlay={scale => <g className="snake-train" pointerEvents="none">
        <polyline points={body.map(sample => sample.point.join(',')).join(' ')} fill="none" stroke="var(--surface)" strokeWidth={9} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
        <polyline points={body.map(sample => sample.point.join(',')).join(' ')} fill="none" stroke="#278f91" strokeWidth={5} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
        {upcoming && <circle cx={upcoming.point[0]} cy={upcoming.point[1]} r={3} fill="none" stroke="#c17e16" strokeWidth={3} vectorEffect="non-scaling-stroke" />}
        {engine.carCentres().map((car, index) => {
          const front = localToMap([car.source[0] + car.tangent[0] * 15.1, car.source[1] + car.tangent[1] * 15.1], data.geographicTransform);
          const back = localToMap([car.source[0] - car.tangent[0] * 15.1, car.source[1] - car.tangent[1] * 15.1], data.geographicTransform);
          const length = Math.max(18, Math.hypot(front[0] - back[0], front[1] - back[1]) * scale);
          return <g key={index} data-snake-head={index === 0 ? '' : undefined} transform={`translate(${car.point.join(' ')}) rotate(${car.angle}) scale(${1 / scale})`}>
            <rect x={-length / 2} y={-5} width={length} height={10} rx={3} fill="var(--surface)" stroke={index === 0 ? '#278f91' : '#25343c'} strokeWidth={index === 0 ? 2.5 : 1} />
            <rect x={-length / 2 + 2} y={-2.5} width={length - 4} height={5} rx={1} fill="#d71920" />
            {[.25, .5, .75].map(fraction => <path key={fraction} d={`M${-length / 2 + length * fraction} -4V4`} stroke="var(--surface)" strokeWidth={1} />)}
            {index === 0 && <path d={`M${length / 2 - 5} -2L${length / 2 - 1} 0L${length / 2 - 5} 2Z`} fill="white" />}
          </g>;
        })}
      </g>} />
    </div>
    <header className="snake-top"><div><strong id="snake-title">🐍 Streetcar Snake</strong><small>{engine.status === 'ready' ? 'Toronto, on the rails' : `${engine.mode === 'purist' ? 'Purist' : 'Arcade'} · ${engine.mission ? engine.mission.label : 'Free play'}`}</small></div><button aria-label="Close Streetcar Snake" onClick={onClose}>✕</button></header>
    {playing && <Minimap data={data} point={pose.point} />}
    <div className="snake-hud"><span><b data-snake-count>{engine.count}</b> {engine.count === 1 ? 'car' : 'cars'}</span><span><b data-snake-speed>{Math.round(engine.speed)}</b> km/h</span><span>{engine.trips ? `${engine.trips} trips · ` : ''}Best {best}</span></div>
    {playing && <div className="snake-status"><p role="status">{engine.message}</p>{nextStop && <p>Next stop: {nextStop.name} · {Math.round(nextStop.metres)} m</p>}<small>{feedText}</small>{feed.snapshot && <small>Positions: {new Date(feed.snapshot.feedTimestamp ?? feed.snapshot.fetchedAt).toLocaleTimeString()} · {feed.snapshot.attribution}</small>}</div>}
    {!playing ? <section className="snake-menu" aria-label="Game setup">
      <p className="eyebrow">{engine.status === 'over' ? 'End of the line' : 'Your streetcar. Your switches.'}</p>
      <h1>{engine.status === 'over' ? 'Game over' : 'Take the controls'}</h1>
      {engine.status === 'over' && <p role="status">{engine.message}</p>}
      <label>Driving mode<select aria-label="Driving mode" value={mode} onChange={event => setMode(event.target.value as Mode)}><option value="arcade">Arcade — collect and grow</option><option value="purist">Purist — drive one streetcar</option></select></label>
      <p>{mode === 'arcade' ? 'Couple live streetcars into an ever longer train. Avoid your own tail. Start at 180 km/h, with arcade overdrive up to 2000.' : 'Drive one streetcar at up to 50 km/h. Touch another streetcar and the run ends.'}</p>
      <label>Route<select aria-label="Route" value={missionId} onChange={event => setMissionId(event.target.value)}><option value="">Free play — all tracks</option>{missions.map(mission => <option key={mission.id} value={mission.id}>{mission.label}</option>)}</select></label>
      <p>Route missions follow the signed path. Reach the terminal for a return trip and, in arcade, a bonus car. Manual switches let you divert.</p>
      <p className="snake-instructions">↑ / ↓ accelerate and brake · ← / → / Space throw switches · P pauses. On mobile, hold the pedals and tap a switch or swipe. Pinch to zoom.</p>
      <p className="snake-feed-note">{feedText}. Only fresh, on-track reports count. Positions update with the map’s live feed.</p>
      <label className="snake-mute"><input type="checkbox" checked={muted} onChange={event => { setMuted(event.target.checked); try { localStorage.setItem('ttc:snake:v2:muted', event.target.checked ? '1' : '0'); } catch { /* Optional preference. */ } }} />Mute sounds</label>
      <button className="primary-action" onClick={depart}>{engine.status === 'over' ? 'Play again' : 'Depart'}</button>
      <a href="/snake/v1/">Play the classic original ↗</a>
    </section> : <>
      {engine.status === 'paused' && <div className="snake-paused"><strong>Paused</strong><button onClick={pause}>Resume driving</button></div>}
      <div className="snake-switches" aria-label="Switch controls"><small>{upcoming ? `Switch in ${Math.round(upcoming.distance)} m` : 'Queue the next switch'}</small><div>
        {upcoming ? upcoming.choices.map(choice => <button key={choice.edgeId} aria-pressed={engine.queued === choice.edgeId || engine.queued === choice.turn} onClick={() => steer(choice.edgeId)}>{choice.label}</button>) : (['left', 'straight', 'right'] as Turn[]).map(turn => <button key={turn} aria-pressed={engine.queued === turn} onClick={() => steer(turn)}>{turn === 'left' ? '← Left' : turn === 'right' ? 'Right →' : '↑ Straight'}</button>)}
      </div></div>
      <div className="snake-pedals"><button className="snake-brake" {...pedal(-1)}>Hold to brake</button><div><button onClick={pause}>{engine.status === 'paused' ? 'Resume' : 'Pause'}</button><button aria-pressed={follow} onClick={() => setFollow(current => !current)}>{follow ? 'Following' : 'Follow car'}</button></div><button className="snake-accelerator" {...pedal(1)}>Hold to accelerate</button></div>
    </>}
  </dialog>;
}
