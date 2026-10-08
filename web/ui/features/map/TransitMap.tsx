import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { useMemo } from 'react';
import type { Feature, Point } from '../../../../shared/map/model';
import { streetcarBody } from '../../../../shared/map/live-status';
import type { TransitMapProps } from './types';
export type { TransitMapControls } from './types';
import { useMapCamera } from './useMapCamera';
import { Tracks, points } from './TrackLayer';
import { TrackClosures } from './TrackClosures';
export type { TrackClosure } from './TrackClosures';

export function TransitMap({
  data,
  cars = [],
  selectedRoute,
  selectedFeature,
  focusPoint,
  focusPointLevel,
  focusBounds,
  followPoint,
  showLabels = false,
  showStops = true,
  includeOvernight = false,
  showStreetcar = true,
  showSubway = true,
  resetKey = 0,
  savedStopIds = [],
  locationPoint,
  selectedVehicleId,
  comparisonStops,
  pickingLabel,
  closures = [],
  onInteract,
  onZoomInteract,
  onExport,
  overlay,
  mapTools,
  driving = false,
  mapId = 'map',
  controlsRef,
  onSelectFeature,
  onSelectVehicle,
}: TransitMapProps) {
  useLanguage();
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
    zoomInteract,
    handlers,
  } = useMapCamera({
    data,
    cars,
    selectedRoute,
    selectedFeature,
    focusPoint,
    focusPointLevel,
    focusBounds,
    followPoint,
    resetKey,
    onInteract,
    onZoomInteract,
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
  // Route visibility depends only on the toggles, not the camera or fleet;
  // memoize so per-frame camera renders do not rebuild the Set.
  const allowedRoutes = useMemo(
    () =>
      new Set(
        data.routes
          .filter((route) => includeOvernight || !route.overnight)
          .filter((route) =>
            /^(1|2|4|5|6)$/.test(route.number) ? showSubway : showStreetcar,
          )
          .map((route) => route.id),
      ),
    [data, includeOvernight, showSubway, showStreetcar],
  );
  const isEndpoint = (feature: Feature) =>
    feature.id === comparisonStops?.from?.id || feature.id === comparisonStops?.to?.id;
  const visibleFeatures = useMemo(
    () =>
      data.features.filter(
        (feature) =>
          (isEndpoint(feature) ||
            selectedFeature?.id === feature.id ||
            feature.kind === 'terminal' ||
            (showStops && feature.routeIds.some((id) => allowedRoutes.has(id)))) &&
          (!selectedRoute ||
            feature.routeIds.includes(selectedRoute) ||
            selectedFeature?.id === feature.id ||
            isEndpoint(feature)),
      ),
    [data, allowedRoutes, showStops, selectedRoute, selectedFeature, comparisonStops],
  );
  // Keep labels readable; reveal ordinary stops at closer zoom levels.
  // Placement depends on the camera, but the inputs are memoized so renders
  // that keep the camera still (feed refreshes, HUD ticks) skip the O(n²)
  // collision work, and per-label rotation math is precomputed once per map.
  const labelFeatures = useMemo(
    () =>
      visibleFeatures
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
        ),
    [visibleFeatures, selectedFeature, showLabels, level, comparisonStops],
  );
  const contextLabels = useMemo(
    () =>
      data.labels.filter((label) => label.kind === 'street' || label.kind === 'water'),
    [data],
  );
  const labelGeometry = useMemo(
    () =>
      new Map(
        data.labels.map((label) => {
          const angle = (label.angle * Math.PI) / 180;
          return [
            label,
            {
              width: label.text.length * 6,
              height: 16,
              cos: Math.cos(angle),
              sin: Math.sin(angle),
            },
          ];
        }),
      ),
    [data],
  );
  const [readableLabels, readableContextLabels] = useMemo(() => {
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
    const readableContextLabels = contextLabels.filter((label) => {
      // Context uses rotated text. Reserve its screen-space bounds so street
      // names do not pile up over terminals when the whole map fits a phone.
      const { width, height, cos, sin } = labelGeometry.get(label)!;
      const x = (label.point[0] - camera.x) * scale,
        y = (label.point[1] - camera.y) * scale;
      const corners = [
        [0, -height],
        [width, -height],
        [0, 0],
        [width, 0],
      ].map(([dx, dy]) => [x + dx * cos - dy * sin, y + dx * sin + dy * cos]);
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
    return [readableLabels, readableContextLabels] as const;
  }, [
    labelFeatures,
    contextLabels,
    labelGeometry,
    camera,
    scale,
    size.width,
    size.height,
  ]);
  const shoreline = data.shoreline;
  // The water frame is pure data: build its point strings once per map, not
  // on every camera frame.
  const waterPoints = useMemo(() => {
    const water = shoreline.length
      ? ([
          ...shoreline,
          [5000, shoreline.at(-1)![1]],
          [5000, 5000],
          [-5000, 5000],
          [-5000, shoreline[0][1]],
        ] as Point[])
      : [];
    return {
      water,
      polygon: points(water),
      coast: points(shoreline),
    };
  }, [shoreline]);
  return (
    <section className="map-viewport" aria-label={t('transitMap.interactiveTtcRailMap')}>
      <svg
        ref={svg}
        id={mapId}
        role="group"
        tabIndex={0}
        aria-label={
          driving
            ? t('transitMap.torontoStreetcarGameMapDragOrPinchToExplore')
            : t('transitMap.torontoSubwayAndStreetcarNetworkArrowKeysPanPlusAnd')
        }
        viewBox={`${camera.x} ${camera.y} ${camera.width} ${camera.height}`}
        {...handlers}
      >
        <g className="water-context" aria-hidden="true">
          <polygon points={waterPoints.polygon} fill="#d8e8e9" />
          <polyline
            points={waterPoints.coast}
            fill="none"
            stroke="#bdd7da"
            vectorEffect="non-scaling-stroke"
          />
        </g>
        <Tracks
          data={data}
          selectedRoute={selectedRoute}
          includeOvernight={includeOvernight}
          showStreetcar={showStreetcar}
          showSubway={showSubway}
        />
        <TrackClosures data={data} closures={closures} />
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
              data-mode={car.vehicle.mode ?? 'streetcar'}
              className={`live-car${car.match ? '' : ' off-track'}`}
              role="button"
              tabIndex={0}
              aria-label={`${car.vehicle.mode === 'subway' ? t('viewer.train') : t('header.streetcar')} ${car.vehicle.label}${car.stale ? t('transitMap.stalePosition') : ''}`}
              opacity={car.stale ? 0.45 : 1}
              onKeyDown={(event) => selectKey(event, () => onSelectVehicle(car))}
            >
              <title>
                {car.vehicle.mode === 'subway' ? t('viewer.train') : t('viewer.car')}{' '}
                {car.vehicle.label}
                {car.vehicle.nextStopName &&
                  t('transitMap.nextStationValuePrediction', {
                    value1: car.vehicle.nextStopName,
                  })}
                {car.stale ? t('viewer.stalePosition') : ''}
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
                  .slice()
                  .reverse()
                  .map((section, index) => (
                    <g
                      key={index}
                      className={
                        index === (car.vehicle.mode === 'subway' ? 5 : 4)
                          ? 'streetcar-cab'
                          : undefined
                      }
                      transform={`translate(${section.point.join(' ')}) rotate(${section.angle}) scale(${1 / scale})`}
                    >
                      {index === (car.vehicle.mode === 'subway' ? 5 : 4) ? (
                        <>
                          {/* The body is drawn tail-first; the larger, pointed cab faces +x. */}
                          <path
                            className="streetcar-halo"
                            d={
                              car.vehicle.mode === 'subway'
                                ? 'M-6 -5H4L7 -2V2L4 5H-6Z'
                                : 'M-4 -5H3L7 0L3 5H-4Z'
                            }
                            fill="#fffdf7"
                            stroke="#fffdf7"
                            strokeWidth={3.5}
                            strokeLinejoin="round"
                          />
                          <path
                            className="streetcar-body"
                            d={
                              car.vehicle.mode === 'subway'
                                ? 'M-6 -5H4L7 -2V2L4 5H-6Z'
                                : 'M-4 -5H3L7 0L3 5H-4Z'
                            }
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
                            x={car.vehicle.mode === 'subway' ? -6 : -4}
                            y={-4}
                            width={car.vehicle.mode === 'subway' ? 12 : 8}
                            height={8}
                            rx={car.vehicle.mode === 'subway' ? 0.5 : 1.6}
                            fill="#fffdf7"
                            stroke="#fffdf7"
                            strokeWidth={3.5}
                          />
                          <rect
                            className="streetcar-body"
                            x={car.vehicle.mode === 'subway' ? -6 : -4}
                            y={-4}
                            width={car.vehicle.mode === 'subway' ? 12 : 8}
                            height={8}
                            rx={car.vehicle.mode === 'subway' ? 0.5 : 1.6}
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
                    d={
                      car.vehicle.mode === 'subway'
                        ? 'M-6 -4H3L6 -1V1L3 4H-6Z'
                        : 'M-4 -3H1L5 0L1 3H-4Z'
                    }
                    fill="#fffdf7"
                    stroke="#fffdf7"
                    strokeWidth={2}
                    strokeLinejoin="round"
                  />
                  <path
                    className="streetcar-body"
                    d={
                      car.vehicle.mode === 'subway'
                        ? 'M-6 -4H3L6 -1V1L3 4H-6Z'
                        : 'M-4 -3H1L5 0L1 3H-4Z'
                    }
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
              {(detailedCars || selectedVehicleId === car.vehicle.id) && (
                <g
                  transform={`translate(${car.point.join(' ')}) scale(${1 / scale})`}
                  pointerEvents="none"
                >
                  <text
                    className="vehicle-number"
                    x={10}
                    y={16}
                    fontSize={10}
                    fontWeight={700}
                    fill="#25343c"
                    stroke="#fffdf7"
                    strokeWidth={3}
                    paintOrder="stroke"
                  >
                    {data.routes.find((route) => route.id === car.vehicle.routeId)
                      ?.number ??
                      car.vehicle.routeId ??
                      '—'}{' '}
                    · {car.vehicle.label}
                  </text>
                </g>
              )}
            </g>
          ))}
        {locationPoint && (
          <g
            className="location-marker"
            transform={`translate(${locationPoint.join(' ')}) scale(${1 / scale})`}
            role="img"
            aria-label={t('transitMap.yourApproximateLocation')}
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
                aria-label={`${letter === 'A' ? t('transitMap.start') : t('transitMap.destination')}: ${stop.name}`}
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
        {pickingLabel ?? t('transitMap.dragToExploreScrollOrPinchToZoomSelectA')}
      </div>
      <div className="north" aria-hidden="true">
        <span>{t('keyboard.n')}</span>
        <svg viewBox="0 0 36 36">
          <path
            d="M7 18H29M21 13L29 18L21 23"
            transform={`rotate(${data.northAngle} 18 18)`}
          />
        </svg>
      </div>
      <nav className="map-controls" aria-label={t('transitMap.mapControls')}>
        <button
          aria-label={t('transitMap.zoomIn')}
          onClick={() => {
            zoomInteract.current?.();
            zoom(0.7);
          }}
        >
          +
        </button>
        <output>{Math.round(level * 100)}%</output>
        <button
          aria-label={t('transitMap.zoomOut')}
          onClick={() => {
            zoomInteract.current?.();
            zoom(1 / 0.7);
          }}
        >
          −
        </button>
        <button
          onClick={() => {
            zoomInteract.current?.();
            move(initial);
          }}
        >
          {t('transitMap.fitMap')}
        </button>
        {onExport && (
          <button aria-label={t('transitMap.printOrDownloadMap')} onClick={onExport}>
            {t('map.export')}
          </button>
        )}
      </nav>
    </section>
  );
}
