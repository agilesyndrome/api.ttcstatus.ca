import { memo, useEffect, useRef, useState } from 'react';
import { fitCamera, moveCamera, zoomCamera } from '../../map/camera';
import { boundsOf, type Bounds, type Feature, type Point, type ViewerData } from '../../map/model';
import { streetcarBody, type PlottedVehicle } from '../../map/live-status';

interface Props {
  data: ViewerData; cars?: PlottedVehicle[]; selectedRoute?: string; selectedFeature?: Feature;
  showLabels?: boolean; includeOvernight?: boolean; resetKey?: number;
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

export function TransitMap({ data, cars = [], selectedRoute, selectedFeature, showLabels = false, includeOvernight = false, resetKey = 0, onSelectFeature, onSelectVehicle }: Props) {
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
  const scale = size.width / camera.width;
  const level = initial.width / camera.width;

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
    const wheel = (event: WheelEvent) => { event.preventDefault(); zoom(Math.exp(Math.max(-160, Math.min(160, event.deltaY)) * .0025), world(event.clientX, event.clientY)); };
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

  const selectKey = (event: React.KeyboardEvent, action: () => void) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); action(); } };
  const allowedRoutes = new Set(data.routes.filter(route => includeOvernight || !route.overnight).map(route => route.id));
  const visibleFeatures = data.features.filter(feature => (feature.kind === 'terminal' || feature.routeIds.some(id => allowedRoutes.has(id))) && (!selectedRoute || feature.routeIds.includes(selectedRoute) || selectedFeature?.id === feature.id));
  // Keep labels readable; reveal ordinary stops at closer zoom levels.
  const labelFeatures = visibleFeatures
    .filter(feature => feature.kind === 'terminal' || selectedFeature?.id === feature.id || level > (showLabels ? 1.5 : 3))
    .sort((a, b) => Number(b.id === selectedFeature?.id) - Number(a.id === selectedFeature?.id) || Number(b.kind === 'terminal') - Number(a.kind === 'terminal'));
  const occupied: { x: number; y: number; width: number; height: number }[] = [];
  const readableLabels = labelFeatures.filter(feature => {
    const x = (feature.point[0] - camera.x) * scale + 8;
    const y = (feature.point[1] - camera.y) * scale - 19;
    const box = { x, y, width: feature.name.length * 6 + 10, height: 20 };
    if (x < 8 || y < 35 || x + box.width > size.width - 8 || y + box.height > size.height - 65) return false;
    if (occupied.some(other => box.x < other.x + other.width && box.x + box.width > other.x && box.y < other.y + other.height && box.y + box.height > other.y)) return false;
    occupied.push(box); return true;
  });
  const shoreline = data.shoreline;
  const water = shoreline.length ? [...shoreline, [5000, shoreline.at(-1)![1]], [5000, 5000], [-5000, 5000], [-5000, shoreline[0][1]]] as Point[] : [];
  return <section className="map-viewport" aria-label="Interactive streetcar map">
    <svg ref={svg} id="map" role="group" tabIndex={0} aria-label="Toronto streetcar network. Arrow keys pan; plus and minus zoom; Home fits the map." viewBox={`${camera.x} ${camera.y} ${camera.width} ${camera.height}`}
      onPointerDown={event => { if (event.button !== 0) return; if (!pointers.current.size) { moved.current = false; start.current = [event.clientX, event.clientY]; } else moved.current = true; pointers.current.set(event.pointerId, [event.clientX, event.clientY]); event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => {
        const previous = pointers.current.get(event.pointerId); if (!previous) return;
        const before = [...pointers.current.values()];
        pointers.current.set(event.pointerId, [event.clientX, event.clientY]);
        const after = [...pointers.current.values()];
        const rect = event.currentTarget.getBoundingClientRect();
        if (after.length > 1) {
          moved.current = true;
          const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
          const oldDistance = distance(before[0], before[1]), newDistance = distance(after[0], after[1]);
          if (newDistance && oldDistance) zoom(oldDistance / newDistance, world((after[0][0] + after[1][0]) / 2, (after[0][1] + after[1][1]) / 2));
        } else if (start.current && Math.hypot(event.clientX - start.current[0], event.clientY - start.current[1]) > 4) moved.current = true;
        if (moved.current) move(moveCamera(cameraRef.current, -(event.clientX - previous[0]) * cameraRef.current.width / rect.width, -(event.clientY - previous[1]) * cameraRef.current.height / rect.height));
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
      onDoubleClick={event => zoom(.5, world(event.clientX, event.clientY))}
      onKeyDown={event => {
        const directions: Record<string, Point> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (directions[event.key]) { event.preventDefault(); const [x, y] = directions[event.key]; move(moveCamera(camera, x * camera.width * .08, y * camera.height * .08)); }
        else if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); zoom(event.key === '-' ? 1 / .7 : .7); }
        else if (event.key === 'Home' || event.key === '0') { event.preventDefault(); move(initial); }
      }}>
      <g aria-hidden="true"><polygon points={points(water)} fill="#d8e8e9" /><polyline points={points(shoreline)} fill="none" stroke="#bdd7da" vectorEffect="non-scaling-stroke" /></g>
      <Tracks data={data} selectedRoute={selectedRoute} includeOvernight={includeOvernight} />
      {visibleFeatures.map(feature => <g key={feature.id} data-feature={feature.id} role="button" tabIndex={0} aria-label={feature.name} transform={`translate(${feature.point.join(' ')}) scale(${1 / scale})`} onKeyDown={event => selectKey(event, () => onSelectFeature(feature))}>
        <title>{feature.name}</title><circle r={10} fill="transparent" />{selectedFeature?.id === feature.id && <circle r={12} fill="#278f9120" stroke="#278f91" />}<circle className="marker" r={feature.kind === 'terminal' ? 4.6 : 2.2} fill="#fffdf7" stroke="#43535e" />
      </g>)}
      <g className="map-label" aria-hidden="true">
        {data.labels.filter(label => label.kind === 'street' || label.kind === 'water').map((label, index) => <g key={index} transform={`translate(${label.point.join(' ')}) rotate(${label.angle}) scale(${1 / scale})`}><text fill="#7b8794" fontSize={11}>{label.text}</text></g>)}
        {readableLabels.map(feature => <g key={feature.id} transform={`translate(${feature.point.join(' ')}) scale(${1 / scale})`}><text x={8} y={-7} fontSize={11} fill="#43535e">{feature.name}</text></g>)}
      </g>
      {cars.filter(car => (includeOvernight || !data.routes.find(route => route.id === car.vehicle.routeId)?.overnight) && (!selectedRoute || car.vehicle.routeId === selectedRoute)).map(car => <g key={car.vehicle.id} data-vehicle={car.vehicle.id} className={`live-car${car.match ? '' : ' off-track'}`} role="button" tabIndex={0} aria-label={`Streetcar ${car.vehicle.label}${car.stale ? ', stale position' : ''}`} opacity={car.stale ? .45 : 1} onKeyDown={event => selectKey(event, () => onSelectVehicle(car))}>
        <title>Car {car.vehicle.label}{car.stale ? ' · Stale position' : ''}</title>{streetcarBody(car, data.edges, scale).reverse().map((section, index) => <g key={index} transform={`translate(${section.point.join(' ')}) rotate(${section.angle}) scale(${1 / scale})`}><rect x={-4} y={-3} width={8} height={6} rx={1.5} fill={data.routes.find(route => route.id === car.vehicle.routeId)?.color ?? '#b4393f'} stroke="#fffdf7" /></g>)}
      </g>)}
    </svg>
    <div className="map-hint">Drag to explore · Scroll or pinch to zoom · Select a stop</div>
    <div className="north" aria-hidden="true"><span>N</span><svg viewBox="0 0 36 36"><path d="M7 18H29M21 13L29 18L21 23" transform={`rotate(${data.northAngle} 18 18)`} /></svg></div>
    <nav className="map-controls" aria-label="Map controls"><button aria-label="Zoom in" onClick={() => zoom(.7)}>+</button><output>{Math.round(level * 100)}%</output><button aria-label="Zoom out" onClick={() => zoom(1 / .7)}>−</button><button onClick={() => move(initial)}>Fit map</button></nav>
  </section>;
}
