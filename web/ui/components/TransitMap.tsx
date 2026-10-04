import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { fitCamera, moveCamera, zoomCamera } from '../../map/camera';
import { boundsOf, type Bounds, type Feature, type Point, type ViewerData } from '../../map/model';
import { streetcarBody, type PlottedVehicle } from '../../map/live-status';

interface Props {
  data: ViewerData; cars?: PlottedVehicle[]; selectedRoute?: string; selectedFeature?: Feature; focusPoint?: Point;
  showLabels?: boolean; includeOvernight?: boolean; resetKey?: number;
  savedStopIds?: string[]; locationPoint?: Point; selectedVehicleId?: string;
  focusBounds?: Bounds; comparisonStops?: { from?: Feature; to?: Feature }; pickingLabel?: string;
  onInteract?(): void; onExport?(): void;
  overlay?: ReactNode | ((scale: number) => ReactNode); mapTools?: ReactNode; driving?: boolean; mapId?: string;
  onSelectFeature(feature: Feature): void; onSelectVehicle(car: PlottedVehicle): void;
}
const points = (values: Point[]) => values.map(point => point.join(',')).join(' ');
const Tracks = memo(function Tracks({ data, selectedRoute, includeOvernight }: Pick<Props, 'data' | 'selectedRoute' | 'includeOvernight'>) {
  return <g aria-hidden="true">{data.edges.map(edge => {
    const activeRoutes = data.routes.filter(route => (includeOvernight || !route.overnight) && edge.routeIds.includes(route.id));
    const route = activeRoutes.find(route => route.id === selectedRoute && edge.routeIds.includes(route.id)) ?? activeRoutes.find(route => !route.overnight) ?? activeRoutes[0];
    return <polyline key={edge.id} className="track" points={points(edge.points)} fill="none" stroke={route?.color ?? '#7b8794'} strokeWidth={activeRoutes.length ? 4.5 : 3} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={activeRoutes.length ? undefined : '6 5'} opacity={selectedRoute && !edge.routeIds.includes(selectedRoute) ? .18 : 1} />;
  })}</g>;
});

export function TransitMap({ data, cars = [], selectedRoute, selectedFeature, focusPoint, showLabels = false, includeOvernight = false, resetKey = 0, savedStopIds = [], locationPoint, selectedVehicleId, focusBounds, comparisonStops, pickingLabel, onInteract, onExport, overlay, mapTools, driving = false, mapId = 'map', onSelectFeature, onSelectVehicle }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 1000, height: 700 });
  const initial = fitCamera(data.bounds, size.width / size.height);
  const [camera, setCamera] = useState<Bounds>(initial);
  const cameraRef = useRef(camera); cameraRef.current = camera;
  const initialRef = useRef(initial); initialRef.current = initial;
  const pointers = useRef(new Map<number, Point>());
  const moved = useRef(false);
  const start = useRef<Point | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const pending = useRef<Bounds>(camera);
  const interact = useRef(onInteract); interact.current = onInteract;
  const scale = size.width / camera.width;
  const level = initial.width / camera.width;
  // At network scale, one compact marker per car leaves the tracks readable.
  // Reveal the full outlined, articulated body once there is room for it.
  const detailedCars = level >= 2.5;

  // Camera updates during a gesture are limited to one render per animation frame.
  function move(next: Bounds) {
    pending.current = next; cameraRef.current = next;
    if (frame.current === undefined) frame.current = requestAnimationFrame(() => { frame.current = undefined; setCamera(pending.current); });
  }
  function zoom(factor: number, anchor?: Point) {
    const current = cameraRef.current;
    move(zoomCamera(current, factor, anchor ?? [current.x + current.width / 2, current.y + current.height / 2], initialRef.current.width / 12, initialRef.current.width));
  }
  function world(clientX: number, clientY: number): Point {
    const rect = svg.current!.getBoundingClientRect(), current = cameraRef.current;
    return [current.x + (clientX - rect.left) * current.width / rect.width, current.y + (clientY - rect.top) * current.height / rect.height];
  }
  useEffect(() => {
    const node = svg.current!;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        const current = cameraRef.current, previous = initialRef.current;
        const next = fitCamera(data.bounds, width / height);
        const zoomLevel = previous.width / current.width;
        const fitted = zoomLevel < 1.01 ? next : { x: current.x + current.width / 2 - next.width / zoomLevel / 2, y: current.y + current.height / 2 - next.height / zoomLevel / 2, width: next.width / zoomLevel, height: next.height / zoomLevel };
        setSize({ width, height }); cameraRef.current = fitted; setCamera(fitted);
      }
    });
    observer.observe(node);
    const wheel = (event: WheelEvent) => { event.preventDefault(); interact.current?.(); zoom(Math.exp(Math.max(-160, Math.min(160, event.deltaY)) * .0025), world(event.clientX, event.clientY)); };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); node.removeEventListener('wheel', wheel); if (frame.current !== undefined) cancelAnimationFrame(frame.current); };
  }, [data]);
  useEffect(() => { move(initialRef.current); }, [resetKey]);
  useEffect(() => {
    if (!selectedRoute) return;
    const routePoints = data.edges.filter(edge => edge.routeIds.includes(selectedRoute)).flatMap(edge => edge.points);
    if (routePoints.length) move(fitCamera(boundsOf(routePoints, 80), size.width / size.height));
  }, [selectedRoute, data]);
  useEffect(() => {
    if (!selectedFeature) return;
    const fitted = initialRef.current, width = fitted.width / 5, height = fitted.height / 5;
    move({ x: selectedFeature.point[0] - width / 2, y: selectedFeature.point[1] - height / 2, width, height });
  }, [selectedFeature]);

  useEffect(() => {
    if (!focusPoint) return;
    const fitted = initialRef.current, width = driving ? cameraRef.current.width : fitted.width / 5, height = driving ? cameraRef.current.height : fitted.height / 5;
    move({ x: focusPoint[0] - width / 2, y: focusPoint[1] - height / 2, width, height });
  }, [focusPoint, driving]);
  useEffect(() => { if (focusBounds) move(fitCamera(focusBounds, size.width / size.height)); }, [focusBounds]);

  const selectKey = (event: React.KeyboardEvent, action: () => void) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); action(); } };
  const allowedRoutes = new Set(data.routes.filter(route => includeOvernight || !route.overnight).map(route => route.id));
  const isEndpoint = (feature: Feature) => feature.id === comparisonStops?.from?.id || feature.id === comparisonStops?.to?.id;
  const visibleFeatures = data.features.filter(feature => (isEndpoint(feature) || selectedFeature?.id === feature.id || feature.kind === 'terminal' || feature.routeIds.some(id => allowedRoutes.has(id))) && (!selectedRoute || feature.routeIds.includes(selectedRoute) || selectedFeature?.id === feature.id || isEndpoint(feature)));
  // Keep labels readable; reveal ordinary stops at closer zoom levels.
  const labelFeatures = visibleFeatures
    .filter(feature => isEndpoint(feature) || feature.kind === 'terminal' || selectedFeature?.id === feature.id || level > (showLabels ? 1.5 : 3))
    .sort((a, b) => Number(isEndpoint(b)) - Number(isEndpoint(a)) || Number(b.id === selectedFeature?.id) - Number(a.id === selectedFeature?.id) || Number(b.kind === 'terminal') - Number(a.kind === 'terminal'));
  const occupied: { x: number; y: number; width: number; height: number }[] = [];
  const readableLabels = labelFeatures.filter(feature => {
    const x = (feature.point[0] - camera.x) * scale + 8;
    const y = (feature.point[1] - camera.y) * scale - 19;
    const box = { x, y, width: feature.name.length * 6 + 10, height: 20 };
    if (x < 8 || y < 35 || x + box.width > size.width - 8 || y + box.height > size.height - 65) return false;
    if (occupied.some(other => box.x < other.x + other.width && box.x + box.width > other.x && box.y < other.y + other.height && box.y + box.height > other.y)) return false;
    occupied.push(box); return true;
  });
  const readableContextLabels = data.labels.filter(label => label.kind === 'street' || label.kind === 'water').filter(label => {
    // Context uses rotated text. Reserve its screen-space bounds so street
    // names do not pile up over terminals when the whole map fits a phone.
    const angle = label.angle * Math.PI / 180;
    const width = label.text.length * 6, height = 16;
    const x = (label.point[0] - camera.x) * scale, y = (label.point[1] - camera.y) * scale;
    const corners = [[0, -height], [width, -height], [0, 0], [width, 0]].map(([dx, dy]) => [x + dx * Math.cos(angle) - dy * Math.sin(angle), y + dx * Math.sin(angle) + dy * Math.cos(angle)]);
    const left = Math.min(...corners.map(point => point[0])), top = Math.min(...corners.map(point => point[1]));
    const box = { x: left - 3, y: top - 3, width: Math.max(...corners.map(point => point[0])) - left + 6, height: Math.max(...corners.map(point => point[1])) - top + 6 };
    if (box.x < 8 || box.y < 35 || box.x + box.width > size.width - 8 || box.y + box.height > size.height - 65) return false;
    if (occupied.some(other => box.x < other.x + other.width && box.x + box.width > other.x && box.y < other.y + other.height && box.y + box.height > other.y)) return false;
    occupied.push(box); return true;
  });
  const shoreline = data.shoreline;
  const water = shoreline.length ? [...shoreline, [5000, shoreline.at(-1)![1]], [5000, 5000], [-5000, 5000], [-5000, shoreline[0][1]]] as Point[] : [];
  return <section className="map-viewport" aria-label="Interactive streetcar map">
    <svg ref={svg} id={mapId} role="group" tabIndex={0} aria-label={driving ? 'Toronto streetcar game map. Drag or pinch to explore.' : 'Toronto streetcar network. Arrow keys pan; plus and minus zoom; Home fits the map.'} viewBox={`${camera.x} ${camera.y} ${camera.width} ${camera.height}`}
      onPointerDown={event => { if (event.button !== 0) return; if (!pointers.current.size) { moved.current = false; start.current = [event.clientX, event.clientY]; } else moved.current = true; pointers.current.set(event.pointerId, [event.clientX, event.clientY]); event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => {
        const previous = pointers.current.get(event.pointerId); if (!previous) return;
        const before = [...pointers.current.values()];
        pointers.current.set(event.pointerId, [event.clientX, event.clientY]);
        const after = [...pointers.current.values()];
        const rect = event.currentTarget.getBoundingClientRect();
        if (driving && event.pointerType === 'touch' && after.length === 1) { moved.current = true; return; }
        if (after.length > 1) {
          moved.current = true;
          const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
          const oldDistance = distance(before[0], before[1]), newDistance = distance(after[0], after[1]);
          if (newDistance && oldDistance) zoom(oldDistance / newDistance, world((after[0][0] + after[1][0]) / 2, (after[0][1] + after[1][1]) / 2));
        } else if (start.current && Math.hypot(event.clientX - start.current[0], event.clientY - start.current[1]) > 4) moved.current = true;
        if (moved.current) { interact.current?.(); move(moveCamera(cameraRef.current, -(event.clientX - previous[0]) * cameraRef.current.width / rect.width, -(event.clientY - previous[1]) * cameraRef.current.height / rect.height)); }
      }}
      onPointerUp={event => {
        if (!moved.current) {
          // Pointer capture retargets clicks: hit-test the original release position.
          const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-feature], [data-vehicle]');
          const feature = data.features.find(feature => feature.id === target?.getAttribute('data-feature'));
          const car = cars.find(car => car.vehicle.id === target?.getAttribute('data-vehicle'));
          if (car) onSelectVehicle(car); else if (feature) onSelectFeature(feature);
        }
        pointers.current.delete(event.pointerId); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={event => { pointers.current.delete(event.pointerId); moved.current = true; }}
      onDoubleClick={event => { interact.current?.(); zoom(.5, world(event.clientX, event.clientY)); }}
      onKeyDown={event => {
        if (driving) return;
        const directions: Record<string, Point> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (directions[event.key]) { event.preventDefault(); interact.current?.(); const [x, y] = directions[event.key]; move(moveCamera(camera, x * camera.width * .08, y * camera.height * .08)); }
        else if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); interact.current?.(); zoom(event.key === '-' ? 1 / .7 : .7); }
        else if (event.key === 'Home' || event.key === '0') { event.preventDefault(); interact.current?.(); move(initial); }
      }}>
      <g className="water-context" aria-hidden="true"><polygon points={points(water)} fill="#d8e8e9" /><polyline points={points(shoreline)} fill="none" stroke="#bdd7da" vectorEffect="non-scaling-stroke" /></g>
      <Tracks data={data} selectedRoute={selectedRoute} includeOvernight={includeOvernight} />
      {visibleFeatures.map(feature => <g key={feature.id} data-feature={feature.id} role="button" tabIndex={0} aria-label={feature.name} transform={`translate(${feature.point.join(' ')}) scale(${1 / scale})`} onKeyDown={event => selectKey(event, () => onSelectFeature(feature))}>
        <title>{feature.name}</title><circle r={10} fill="transparent" />{selectedFeature?.id === feature.id && <circle r={12} fill="#278f9120" stroke="#278f91" />}{savedStopIds.includes(feature.id) && <path className="saved-marker" d="M0 -12L2 -7L7 -7L3 -3L5 2L0 -1L-5 2L-3 -3L-7 -7L-2 -7Z" fill="#c17e16" stroke="#fffdf7" />}<circle className="marker" r={feature.kind === 'terminal' ? 4.6 : 2.2} fill="#fffdf7" stroke="#43535e" />
      </g>)}
      <g className="map-label" aria-hidden="true">
        {readableContextLabels.map((label, index) => <g key={index} transform={`translate(${label.point.join(' ')}) rotate(${label.angle}) scale(${1 / scale})`}><text fill="#7b8794" fontSize={11}>{label.text}</text></g>)}
        {readableLabels.map(feature => <g key={feature.id} transform={`translate(${feature.point.join(' ')}) scale(${1 / scale})`}><text x={8} y={-7} fontSize={11} fill="#43535e">{feature.name}</text></g>)}
      </g>
      {cars.filter(car => (includeOvernight || !data.routes.find(route => route.id === car.vehicle.routeId)?.overnight) && (!selectedRoute || car.vehicle.routeId === selectedRoute)).map(car => <g key={car.vehicle.id} data-vehicle={car.vehicle.id} className={`live-car${car.match ? '' : ' off-track'}`} role="button" tabIndex={0} aria-label={`Streetcar ${car.vehicle.label}${car.stale ? ', stale position' : ''}`} opacity={car.stale ? .45 : 1} onKeyDown={event => selectKey(event, () => onSelectVehicle(car))}>
        <title>Car {car.vehicle.label}{car.stale ? ' · Stale position' : ''}</title>{selectedVehicleId === car.vehicle.id && <circle className="selected-car-ring" cx={car.point[0]} cy={car.point[1]} r={15 / scale} fill="#278f9120" stroke="#278f91" vectorEffect="non-scaling-stroke" />}{detailedCars ? streetcarBody(car, data.edges, scale).reverse().map((section, index) => <g key={index} className={index === 4 ? 'streetcar-cab' : undefined} transform={`translate(${section.point.join(' ')}) rotate(${section.angle}) scale(${1 / scale})`}>
          {index === 4 ? <>
            {/* The body is drawn tail-first; the larger, pointed cab faces +x. */}
            <path className="streetcar-halo" d="M-4 -5H3L7 0L3 5H-4Z" fill="#fffdf7" stroke="#fffdf7" strokeWidth={3.5} strokeLinejoin="round" />
            <path className="streetcar-body" d="M-4 -5H3L7 0L3 5H-4Z" fill={data.routes.find(route => route.id === car.vehicle.routeId)?.color ?? '#b4393f'} stroke="#25343c" strokeWidth={1.2} strokeLinejoin="round" />
            <path d="M0 -2.5L3 0L0 2.5" fill="none" stroke="#fffdf7" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
          </> : <>
          <rect className="streetcar-halo" x={-4} y={-4} width={8} height={8} rx={1.6} fill="#fffdf7" stroke="#fffdf7" strokeWidth={3.5} />
          <rect className="streetcar-body" x={-4} y={-4} width={8} height={8} rx={1.6} fill="#fffdf7" stroke="#25343c" strokeWidth={1.2} />
          <path d="M-2 0H2" fill="none" stroke={data.routes.find(route => route.id === car.vehicle.routeId)?.color ?? '#b4393f'} strokeWidth={2} strokeLinecap="round" />
          </>}
        </g>) : <g className="streetcar-cab" transform={`translate(${car.point.join(' ')}) rotate(${car.angle}) scale(${1 / scale})`}>
          <rect x={-7} y={-6} width={14} height={12} rx={3} fill="transparent" />
          <path className="streetcar-halo" d="M-4 -3H1L5 0L1 3H-4Z" fill="#fffdf7" stroke="#fffdf7" strokeWidth={2} strokeLinejoin="round" />
          <path className="streetcar-body" d="M-4 -3H1L5 0L1 3H-4Z" fill={data.routes.find(route => route.id === car.vehicle.routeId)?.color ?? '#b4393f'} stroke="#25343c" strokeWidth={.75} strokeLinejoin="round" />
        </g>}
      </g>)}
      {locationPoint && <g className="location-marker" transform={`translate(${locationPoint.join(' ')}) scale(${1 / scale})`} role="img" aria-label="Your approximate location"><circle r={16} fill="#477cb125" /><circle r={6} fill="#477cb1" stroke="#fff" strokeWidth={2} /></g>}
      {([['A', comparisonStops?.from], ['B', comparisonStops?.to]] as const).map(([letter, stop]) => stop && <g key={letter} className="comparison-marker" data-endpoint={letter} transform={`translate(${stop.point.join(' ')}) scale(${1 / scale})`} role="img" aria-label={`${letter === 'A' ? 'Start' : 'Destination'}: ${stop.name}`}><path d="M0 0L-10 -13A12 12 0 1 1 10 -13Z" fill={letter === 'A' ? '#278f91' : '#b4393f'} stroke="var(--surface)" strokeWidth={2} /><text x={0} y={-15} textAnchor="middle" fontSize={11} fontWeight={700} fill="white">{letter}</text></g>)}
      {typeof overlay === 'function' ? overlay(scale) : overlay}
    </svg>
    {mapTools}
    <div className={`map-hint${pickingLabel ? ' picking-hint' : ''}`} role={pickingLabel ? 'status' : undefined}>{pickingLabel ?? 'Drag to explore · Scroll or pinch to zoom · Select a stop'}</div>
    <div className="north" aria-hidden="true"><span>N</span><svg viewBox="0 0 36 36"><path d="M7 18H29M21 13L29 18L21 23" transform={`rotate(${data.northAngle} 18 18)`} /></svg></div>
    <nav className="map-controls" aria-label="Map controls"><button aria-label="Zoom in" onClick={() => { interact.current?.(); zoom(.7); }}>+</button><output>{Math.round(level * 100)}%</output><button aria-label="Zoom out" onClick={() => { interact.current?.(); zoom(1 / .7); }}>−</button><button onClick={() => { interact.current?.(); move(initial); }}>Fit map</button>{onExport && <button aria-label="Print or download map" onClick={onExport}>Save map</button>}</nav>
  </section>;
}
