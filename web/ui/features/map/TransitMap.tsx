import type { Feature, Point } from '../../../../shared/map/model';
import { streetcarBody } from '../../../../shared/map/live-status';
import type { TransitMapProps } from './types';
export type { TransitMapControls } from './types';
import { useMapCamera } from './useMapCamera';
import { Tracks, points } from './TrackLayer';

export function TransitMap({
  data,
  cars = [],
  selectedRoute,
  selectedFeature,
  focusPoint,
  showLabels = false,
  includeOvernight = false,
  resetKey = 0,
  savedStopIds = [],
  locationPoint,
  selectedVehicleId,
  focusBounds,
  comparisonStops,
  pickingLabel,
  onInteract,
  onExport,
  overlay,
  mapTools,
  driving = false,
  mapId = 'map',
  controlsRef,
  onSelectFeature,
  onSelectVehicle,
}: TransitMapProps) {
  const {
    svg,
    camera,
    size,
    scale,
    level,
    detailedCars,
    zoom,
    move,
    initial,
    interact,
    handlers,
  } = useMapCamera({
    data,
    cars,
    selectedRoute,
    selectedFeature,
    focusPoint,
    focusBounds,
    resetKey,
    onInteract,
    driving,
    controlsRef,
    onSelectFeature,
    onSelectVehicle,
  });
  const selectKey = (event: React.KeyboardEvent, action: () => void) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      action();
    }
  };
  const allowedRoutes = new Set(
    data.routes
      .filter((route) => includeOvernight || !route.overnight)
      .map((route) => route.id),
  );
  const isEndpoint = (feature: Feature) =>
    feature.id === comparisonStops?.from?.id || feature.id === comparisonStops?.to?.id;
  const visibleFeatures = data.features.filter(
    (feature) =>
      (isEndpoint(feature) ||
        selectedFeature?.id === feature.id ||
        feature.kind === 'terminal' ||
        feature.routeIds.some((id) => allowedRoutes.has(id))) &&
      (!selectedRoute ||
        feature.routeIds.includes(selectedRoute) ||
        selectedFeature?.id === feature.id ||
        isEndpoint(feature)),
  );
  // Keep labels readable; reveal ordinary stops at closer zoom levels.
  const labelFeatures = visibleFeatures
    .filter(
      (feature) =>
        isEndpoint(feature) ||
        feature.kind === 'terminal' ||
        selectedFeature?.id === feature.id ||
        level > (showLabels ? 1.5 : 3),
    )
    .sort(
      (a, b) =>
        Number(isEndpoint(b)) - Number(isEndpoint(a)) ||
        Number(b.id === selectedFeature?.id) - Number(a.id === selectedFeature?.id) ||
        Number(b.kind === 'terminal') - Number(a.kind === 'terminal'),
    );
  const occupied: { x: number; y: number; width: number; height: number }[] = [];
  const readableLabels = labelFeatures.filter((feature) => {
    const x = (feature.point[0] - camera.x) * scale + 8;
    const y = (feature.point[1] - camera.y) * scale - 19;
    const box = { x, y, width: feature.name.length * 6 + 10, height: 20 };
    if (
      x < 8 ||
      y < 35 ||
      x + box.width > size.width - 8 ||
      y + box.height > size.height - 65
    )
      return false;
    if (
      occupied.some(
        (other) =>
          box.x < other.x + other.width &&
          box.x + box.width > other.x &&
          box.y < other.y + other.height &&
          box.y + box.height > other.y,
      )
    )
      return false;
    occupied.push(box);
    return true;
  });
  const readableContextLabels = data.labels
    .filter((label) => label.kind === 'street' || label.kind === 'water')
    .filter((label) => {
      // Context uses rotated text. Reserve its screen-space bounds so street
      // names do not pile up over terminals when the whole map fits a phone.
      const angle = (label.angle * Math.PI) / 180;
      const width = label.text.length * 6,
        height = 16;
      const x = (label.point[0] - camera.x) * scale,
        y = (label.point[1] - camera.y) * scale;
      const corners = [
        [0, -height],
        [width, -height],
        [0, 0],
        [width, 0],
      ].map(([dx, dy]) => [
        x + dx * Math.cos(angle) - dy * Math.sin(angle),
        y + dx * Math.sin(angle) + dy * Math.cos(angle),
      ]);
      const left = Math.min(...corners.map((point) => point[0])),
        top = Math.min(...corners.map((point) => point[1]));
      const box = {
        x: left - 3,
        y: top - 3,
        width: Math.max(...corners.map((point) => point[0])) - left + 6,
        height: Math.max(...corners.map((point) => point[1])) - top + 6,
      };
      if (
        box.x < 8 ||
        box.y < 35 ||
        box.x + box.width > size.width - 8 ||
        box.y + box.height > size.height - 65
      )
        return false;
      if (
        occupied.some(
          (other) =>
            box.x < other.x + other.width &&
            box.x + box.width > other.x &&
            box.y < other.y + other.height &&
            box.y + box.height > other.y,
        )
      )
        return false;
      occupied.push(box);
      return true;
    });
  const shoreline = data.shoreline;
  const water = shoreline.length
    ? ([
        ...shoreline,
        [5000, shoreline.at(-1)![1]],
        [5000, 5000],
        [-5000, 5000],
        [-5000, shoreline[0][1]],
      ] as Point[])
    : [];
  return (
    <section className="map-viewport" aria-label="Interactive streetcar map">
      <svg
        ref={svg}
        id={mapId}
        role="group"
        tabIndex={0}
        aria-label={
          driving
            ? 'Toronto streetcar game map. Drag or pinch to explore.'
            : 'Toronto streetcar network. Arrow keys pan; plus and minus zoom; Home fits the map.'
        }
        viewBox={`${camera.x} ${camera.y} ${camera.width} ${camera.height}`}
        {...handlers}
      >
        <g className="water-context" aria-hidden="true">
          <polygon points={points(water)} fill="#d8e8e9" />
          <polyline
            points={points(shoreline)}
            fill="none"
            stroke="#bdd7da"
            vectorEffect="non-scaling-stroke"
          />
        </g>
        <Tracks
          data={data}
          selectedRoute={selectedRoute}
          includeOvernight={includeOvernight}
        />
        {visibleFeatures.map((feature) => (
          <g
            key={feature.id}
            data-feature={feature.id}
            role="button"
            tabIndex={0}
            aria-label={feature.name}
            transform={`translate(${feature.point.join(' ')}) scale(${1 / scale})`}
            onKeyDown={(event) => selectKey(event, () => onSelectFeature(feature))}
          >
            <title>{feature.name}</title>
            <circle r={10} fill="transparent" />
            {selectedFeature?.id === feature.id && (
              <circle r={12} fill="#278f9120" stroke="#278f91" />
            )}
            {savedStopIds.includes(feature.id) && (
              <path
                className="saved-marker"
                d="M0 -12L2 -7L7 -7L3 -3L5 2L0 -1L-5 2L-3 -3L-7 -7L-2 -7Z"
                fill="#c17e16"
                stroke="#fffdf7"
              />
            )}
            <circle
              className="marker"
              r={feature.kind === 'terminal' ? 4.6 : 2.2}
              fill="#fffdf7"
              stroke="#43535e"
            />
          </g>
        ))}
        <g className="map-label" aria-hidden="true">
          {readableContextLabels.map((label, index) => (
            <g
              key={index}
              transform={`translate(${label.point.join(' ')}) rotate(${label.angle}) scale(${1 / scale})`}
            >
              <text fill="#7b8794" fontSize={11}>
                {label.text}
              </text>
            </g>
          ))}
          {readableLabels.map((feature) => (
            <g
              key={feature.id}
              transform={`translate(${feature.point.join(' ')}) scale(${1 / scale})`}
            >
              <text x={8} y={-7} fontSize={11} fill="#43535e">
                {feature.name}
              </text>
            </g>
          ))}
        </g>
        {cars
          .filter(
            (car) =>
              (includeOvernight ||
                !data.routes.find((route) => route.id === car.vehicle.routeId)
                  ?.overnight) &&
              (!selectedRoute || car.vehicle.routeId === selectedRoute),
          )
          .map((car) => (
            <g
              key={car.vehicle.id}
              data-vehicle={car.vehicle.id}
              className={`live-car${car.match ? '' : ' off-track'}`}
              role="button"
              tabIndex={0}
              aria-label={`Streetcar ${car.vehicle.label}${car.stale ? ', stale position' : ''}`}
              opacity={car.stale ? 0.45 : 1}
              onKeyDown={(event) => selectKey(event, () => onSelectVehicle(car))}
            >
              <title>
                Car {car.vehicle.label}
                {car.stale ? ' · Stale position' : ''}
              </title>
              {selectedVehicleId === car.vehicle.id && (
                <circle
                  className="selected-car-ring"
                  cx={car.point[0]}
                  cy={car.point[1]}
                  r={15 / scale}
                  fill="#278f9120"
                  stroke="#278f91"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {detailedCars ? (
                streetcarBody(car, data.edges, scale)
                  .reverse()
                  .map((section, index) => (
                    <g
                      key={index}
                      className={index === 4 ? 'streetcar-cab' : undefined}
                      transform={`translate(${section.point.join(' ')}) rotate(${section.angle}) scale(${1 / scale})`}
                    >
                      {index === 4 ? (
                        <>
                          {/* The body is drawn tail-first; the larger, pointed cab faces +x. */}
                          <path
                            className="streetcar-halo"
                            d="M-4 -5H3L7 0L3 5H-4Z"
                            fill="#fffdf7"
                            stroke="#fffdf7"
                            strokeWidth={3.5}
                            strokeLinejoin="round"
                          />
                          <path
                            className="streetcar-body"
                            d="M-4 -5H3L7 0L3 5H-4Z"
                            fill={
                              data.routes.find(
                                (route) => route.id === car.vehicle.routeId,
                              )?.color ?? '#b4393f'
                            }
                            stroke="#25343c"
                            strokeWidth={1.2}
                            strokeLinejoin="round"
                          />
                          <path
                            d="M0 -2.5L3 0L0 2.5"
                            fill="none"
                            stroke="#fffdf7"
                            strokeWidth={1.8}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </>
                      ) : (
                        <>
                          <rect
                            className="streetcar-halo"
                            x={-4}
                            y={-4}
                            width={8}
                            height={8}
                            rx={1.6}
                            fill="#fffdf7"
                            stroke="#fffdf7"
                            strokeWidth={3.5}
                          />
                          <rect
                            className="streetcar-body"
                            x={-4}
                            y={-4}
                            width={8}
                            height={8}
                            rx={1.6}
                            fill="#fffdf7"
                            stroke="#25343c"
                            strokeWidth={1.2}
                          />
                          <path
                            d="M-2 0H2"
                            fill="none"
                            stroke={
                              data.routes.find(
                                (route) => route.id === car.vehicle.routeId,
                              )?.color ?? '#b4393f'
                            }
                            strokeWidth={2}
                            strokeLinecap="round"
                          />
                        </>
                      )}
                    </g>
                  ))
              ) : (
                <g
                  className="streetcar-cab"
                  transform={`translate(${car.point.join(' ')}) rotate(${car.angle}) scale(${1 / scale})`}
                >
                  <rect x={-7} y={-6} width={14} height={12} rx={3} fill="transparent" />
                  <path
                    className="streetcar-halo"
                    d="M-4 -3H1L5 0L1 3H-4Z"
                    fill="#fffdf7"
                    stroke="#fffdf7"
                    strokeWidth={2}
                    strokeLinejoin="round"
                  />
                  <path
                    className="streetcar-body"
                    d="M-4 -3H1L5 0L1 3H-4Z"
                    fill={
                      data.routes.find((route) => route.id === car.vehicle.routeId)
                        ?.color ?? '#b4393f'
                    }
                    stroke="#25343c"
                    strokeWidth={0.75}
                    strokeLinejoin="round"
                  />
                </g>
              )}
            </g>
          ))}
        {locationPoint && (
          <g
            className="location-marker"
            transform={`translate(${locationPoint.join(' ')}) scale(${1 / scale})`}
            role="img"
            aria-label="Your approximate location"
          >
            <circle r={16} fill="#477cb125" />
            <circle r={6} fill="#477cb1" stroke="#fff" strokeWidth={2} />
          </g>
        )}
        {(
          [
            ['A', comparisonStops?.from],
            ['B', comparisonStops?.to],
          ] as const
        ).map(
          ([letter, stop]) =>
            stop && (
              <g
                key={letter}
                className="comparison-marker"
                data-endpoint={letter}
                transform={`translate(${stop.point.join(' ')}) scale(${1 / scale})`}
                role="img"
                aria-label={`${letter === 'A' ? 'Start' : 'Destination'}: ${stop.name}`}
              >
                <path
                  d="M0 0L-10 -13A12 12 0 1 1 10 -13Z"
                  fill={letter === 'A' ? '#278f91' : '#b4393f'}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
                <text
                  x={0}
                  y={-15}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={700}
                  fill="white"
                >
                  {letter}
                </text>
              </g>
            ),
        )}
        {typeof overlay === 'function' ? overlay(scale) : overlay}
      </svg>
      {mapTools}
      <div
        className={`map-hint${pickingLabel ? ' picking-hint' : ''}`}
        role={pickingLabel ? 'status' : undefined}
      >
        {pickingLabel ?? 'Drag to explore · Scroll or pinch to zoom · Select a stop'}
      </div>
      <div className="north" aria-hidden="true">
        <span>N</span>
        <svg viewBox="0 0 36 36">
          <path
            d="M7 18H29M21 13L29 18L21 23"
            transform={`rotate(${data.northAngle} 18 18)`}
          />
        </svg>
      </div>
      <nav className="map-controls" aria-label="Map controls">
        <button
          aria-label="Zoom in"
          onClick={() => {
            interact.current?.();
            zoom(0.7);
          }}
        >
          +
        </button>
        <output>{Math.round(level * 100)}%</output>
        <button
          aria-label="Zoom out"
          onClick={() => {
            interact.current?.();
            zoom(1 / 0.7);
          }}
        >
          −
        </button>
        <button
          onClick={() => {
            interact.current?.();
            move(initial);
          }}
        >
          Fit map
        </button>
        {onExport && (
          <button aria-label="Print or download map" onClick={onExport}>
            Save map
          </button>
        )}
      </nav>
    </section>
  );
}
