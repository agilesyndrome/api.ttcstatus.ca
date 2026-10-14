import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { baseStopName, type Feature, type Point } from '../../../../shared/map/model';
import { streetcarBody } from '../../../../shared/map/live-status';
import { STREAM_OFFSET } from '../service/wave-field';
import type { TransitMapProps } from './types';
export type { TransitMapControls } from './types';
import { useMapCamera } from './useMapCamera';
import { stopDots } from './platform-pairs';
import { Tracks, points } from './TrackLayer';
import { TrackClosures } from './TrackClosures';
import { RoutePills } from './RoutePills';
import { rectanglesOverlap } from './label-layout';
export type { TrackClosure } from './TrackClosures';

export const TransitMap = memo(function TransitMap({
  data,
  cars = [],
  selectedRoute,
  highlightRoute,
  serviceMode = false,
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
  zoomLimits,
  mapControls = true,
  onInteract,
  onZoomInteract,
  overlay,
  underlay,
  mapTools,
  mapPopup,
  driving = false,
  mapId = 'map',
  controlsRef,
  onSelectFeature,
  onSelectVehicle,
  /** The delivered-service car tint: each car's direction field colour where
   * it rides, or null when that direction has no data. When provided, cars
   * snap onto their direction's stream (offset to its side of the rail) and
   * their bodies take the tint — the car IS the field, moving. */
  serviceCarTint,
}: TransitMapProps) {
  useLanguage();
  const activeRoute = highlightRoute ?? selectedRoute;
  // E5S3 (docs/optimize-overlay.md): while the camera is under the rider's
  // hands, animated map layers pause — `data-gesturing` on the root SVG
  // tells the CSS to freeze the service dash animations, so no 60 fps paint
  // fight with the pan/zoom (the static colour field carries the
  // information while the world moves). Any interaction bumps the idle
  // window; ~400 ms of quiet resumes the flow.
  const gestureIdle = useRef<number | undefined>(undefined);
  const gesturingRef = useRef(false);
  const [gesturing, setGesturing] = useState(false);
  const gestureActivity = useCallback(() => {
    window.clearTimeout(gestureIdle.current);
    if (!gesturingRef.current) {
      gesturingRef.current = true;
      setGesturing(true);
    }
    gestureIdle.current = window.setTimeout(() => {
      gesturingRef.current = false;
      setGesturing(false);
    }, 400);
  }, []);
  useEffect(() => () => window.clearTimeout(gestureIdle.current), []);
  // Route the camera's own interaction seams through the gesture pause:
  // every pan, keyboard move, wheel/double-tap/button zoom and Home reset
  // already reports through onInteract/onZoomInteract (useMapCamera), so
  // the host callbacks keep their behaviour untouched beside ours.
  const handleInteract = useCallback(() => {
    gestureActivity();
    onInteract?.();
  }, [gestureActivity, onInteract]);
  const handleZoomInteract = useCallback(() => {
    gestureActivity();
    onZoomInteract?.();
  }, [gestureActivity, onZoomInteract]);
  const {
    svg,
    camera,
    viewBox,
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
    zoomLimits,
    onInteract: handleInteract,
    onZoomInteract: handleZoomInteract,
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
          (!activeRoute ||
            feature.routeIds.includes(activeRoute) ||
            selectedFeature?.id === feature.id ||
            isEndpoint(feature)),
      ),
    [data, allowedRoutes, showStops, activeRoute, selectedFeature, comparisonStops],
  );
  // Keep the overview for stations and interchanges. Ordinary boarding points
  // become useful only when the rider zooms into a neighborhood.
  // Placement depends on the camera, but the inputs are memoized so renders
  // that keep the camera still (feed refreshes, HUD ticks) skip the O(n²)
  // collision work, and per-label rotation math is precomputed once per map.
  const labelFeatures = useMemo(() => {
    const dayRoutes = new Set(
      data.routes.filter((route) => !route.overnight).map((route) => route.id),
    );
    const landmark = (feature: Feature) =>
      feature.kind === 'terminal' ||
      /station|loop|terminal/i.test(feature.name) ||
      feature.routeIds.filter((id) => dayRoutes.has(id)).length > 1;
    return visibleFeatures
      .filter(
        (feature) =>
          isEndpoint(feature) ||
          selectedFeature?.id === feature.id ||
          feature.kind === 'terminal' ||
          (landmark(feature) && level > (showLabels ? 2.7 : 3.7)) ||
          level > (showLabels ? 5.5 : 7),
      )
      .sort(
        (a, b) =>
          Number(isEndpoint(b)) - Number(isEndpoint(a)) ||
          Number(b.id === selectedFeature?.id) - Number(a.id === selectedFeature?.id) ||
          Number(b.kind === 'terminal') - Number(a.kind === 'terminal') ||
          Number(landmark(b)) - Number(landmark(a)),
      );
  }, [data.routes, visibleFeatures, selectedFeature, showLabels, level, comparisonStops]);
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
    // Driving freezes the label layout: the camera pans every follow tick, so
    // recomputing this O(n²) collision grid per frame is pure waste. The game
    // renders its own HUD/overlay, so empty label layers cost nothing.
    if (driving) return [[], []] as const;
    // Overview labels drop the direction qualifier ("Keele Station", not
    // "Keele Station - Westbound Platform"): at that zoom the direction is
    // noise, and the shorter boxes collide far less. The full name returns
    // past level 3 and lives in the tooltip and details card meanwhile.
    const labelText = (feature: Feature) =>
      level < 3 ? baseStopName(feature.name) : feature.name;
    // The service legend card occupies the bottom-left corner of narrow
    // screens; keep labels out from under it.
    const bottomReserve = underlay && size.width <= 640 ? 88 : 65;
    const occupied: { x: number; y: number; width: number; height: number }[] = [];
    const labelBudget = Math.max(
      8,
      Math.min(28, Math.floor((size.width * size.height) / 50000)),
    );
    let placedLabels = 0;
    const readableLabels = labelFeatures.filter((feature) => {
      const priority = isEndpoint(feature) || selectedFeature?.id === feature.id;
      if (!priority && placedLabels >= labelBudget) return false;
      const x = (feature.point[0] - camera.x) * scale + 8;
      const y = (feature.point[1] - camera.y) * scale - 19;
      const box = {
        x: x - 7,
        y: y - 7,
        width: labelText(feature).length * 6 + 30,
        height: 34,
      };
      if (
        x < 8 ||
        y < 35 ||
        x + box.width > size.width - 8 ||
        y + box.height > size.height - bottomReserve
      )
        return false;
      if (occupied.some((other) => rectanglesOverlap(box, other))) return false;
      occupied.push(box);
      placedLabels += 1;
      return true;
    });
    const contextBudget = Math.max(
      3,
      Math.min(10, Math.floor((size.width * size.height) / 115000)),
    );
    let placedContext = 0;
    const readableContextLabels = contextLabels.filter((label) => {
      if (placedContext >= contextBudget) return false;
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
        x: left - 8,
        y: top - 8,
        width: Math.max(...corners.map((point) => point[0])) - left + 16,
        height: Math.max(...corners.map((point) => point[1])) - top + 16,
      };
      if (
        box.x < 8 ||
        box.y < 35 ||
        box.x + box.width > size.width - 8 ||
        box.y + box.height > size.height - 65
      )
        return false;
      if (occupied.some((other) => rectanglesOverlap(box, other))) return false;
      occupied.push(box);
      placedContext += 1;
      return true;
    });
    return [readableLabels, readableContextLabels] as const;
  }, [
    labelFeatures,
    selectedFeature,
    comparisonStops,
    contextLabels,
    labelGeometry,
    driving,
    camera,
    scale,
    level,
    underlay,
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
  /** Snap a car position onto its direction's stream: shift perpendicular
   * (left of the car's heading) by the stream offset — forward cars land on
   * the direction-0 side, backward cars on the direction-1 side, matching
   * the twin streams exactly. */
  const snapToStream = (
    point: [number, number],
    angle: number,
    snapped: boolean,
  ): [number, number] => {
    if (!snapped) return point;
    const radians = (angle * Math.PI) / 180;
    return [
      point[0] - Math.sin(radians) * STREAM_OFFSET,
      point[1] + Math.cos(radians) * STREAM_OFFSET,
    ];
  };
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
        viewBox={viewBox}
        data-gesturing={gesturing ? 'true' : undefined}
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
          selectedRoute={activeRoute}
          serviceMode={serviceMode}
          includeOvernight={includeOvernight}
          showStreetcar={showStreetcar}
          showSubway={showSubway}
          scale={scale}
        />
        <TrackClosures data={data} closures={closures} />
        {typeof underlay === 'function' ? underlay(scale, camera) : underlay}
        {/* The street test: stop dots carry a gloved-tap hit target (32px
         * screen), and a platform pair (E/W across one intersection)
         * renders as ONE dot until the camera is close enough to tell the
         * boarding points apart — a dashed halo marks the merged pair.
         * Tapping a merged dot selects the intersection, never a
         * direction (the service layer owns that distinction). */}
        {stopDots(visibleFeatures, scale).map((dot) => {
          const feature = dot.feature;
          const saved =
            savedStopIds.includes(feature.id) ||
            (dot.twin !== null && savedStopIds.includes(dot.twin.id));
          return (
            <g
              key={feature.id}
              data-feature={feature.id}
              role="button"
              tabIndex={0}
              aria-label={dot.title}
              transform={`translate(${feature.point.join(' ')}) scale(${1 / scale})`}
              onKeyDown={(event) => selectKey(event, () => onSelectFeature(feature))}
            >
              <title>{dot.title}</title>
              <circle r={16} fill="transparent" />
              {selectedFeature?.id === feature.id && (
                <circle r={12} fill="#278f9120" stroke="#278f91" />
              )}
              {saved && (
                <path
                  className="saved-marker"
                  d="M0 -12L2 -7L7 -7L3 -3L5 2L0 -1L-5 2L-3 -3L-7 -7L-2 -7Z"
                  fill="#c17e16"
                  stroke="#fffdf7"
                />
              )}
              <circle
                className="marker"
                r={feature.kind === 'terminal' ? 5 : 3}
                fill="#fffdf7"
                stroke="#43535e"
              />
              {dot.twin !== null && (
                <circle
                  className="marker marker--pair"
                  r={feature.kind === 'terminal' ? 7 : 5.4}
                  fill="none"
                  stroke="#43535e"
                  strokeWidth={1}
                  strokeDasharray="2.4 1.8"
                />
              )}
            </g>
          );
        })}
        {serviceMode && showLabels && (
          <RoutePills features={visibleFeatures} routes={data.routes} scale={scale} />
        )}
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
              <line className="map-label__leader" x1={0} y1={0} x2={7} y2={-12} />
              <rect
                className="map-label__scrim"
                x={4}
                y={-18}
                width={
                  (level < 3 ? baseStopName(feature.name) : feature.name).length * 6 + 8
                }
                height={16}
                rx={5}
              />
              <text
                className={
                  selectedFeature?.id === feature.id ? 'map-label__selected' : undefined
                }
                x={8}
                y={-7}
                fontSize={11}
                fill="#43535e"
              >
                {level < 3 ? baseStopName(feature.name) : feature.name}
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
              (!activeRoute || car.vehicle.routeId === activeRoute),
          )
          .map((car) => {
            const tint = serviceCarTint?.(car) ?? null;
            const snapped = tint !== null;
            return (
              <g
                key={car.vehicle.id}
                data-vehicle={car.vehicle.id}
                data-selected={selectedVehicleId === car.vehicle.id ? 'true' : undefined}
                data-mode={car.vehicle.mode ?? 'streetcar'}
                className={`live-car${car.match ? '' : ' off-track'}${snapped ? ' on-service-stream' : ''}`}
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
                    .map((section, index) => {
                      const snappedPoint = snapToStream(
                        section.point,
                        section.angle,
                        snapped,
                      );
                      return (
                        <g
                          key={index}
                          className={
                            index === (car.vehicle.mode === 'subway' ? 5 : 4)
                              ? 'streetcar-cab'
                              : undefined
                          }
                          transform={`translate(${snappedPoint.join(' ')}) rotate(${section.angle}) scale(${1 / scale})`}
                        >
                          {index === (car.vehicle.mode === 'subway' ? 5 : 4) ? (
                            <>
                              {/* The cab: the field's colour where this car rides —
                              the car IS the service state, moving. */}
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
                                  tint ??
                                  data.routes.find(
                                    (route) => route.id === car.vehicle.routeId,
                                  )?.color ??
                                  '#b4393f'
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
                      );
                    })
                ) : (
                  <g
                    className="streetcar-cab"
                    transform={`translate(${snapToStream(car.point, car.angle, snapped).join(' ')}) rotate(${car.angle}) scale(${1 / scale})`}
                  >
                    <rect
                      x={-7}
                      y={-6}
                      width={14}
                      height={12}
                      rx={3}
                      fill="transparent"
                    />
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
                        tint ??
                        data.routes.find((route) => route.id === car.vehicle.routeId)
                          ?.color ??
                        '#b4393f'
                      }
                      stroke="#25343c"
                      strokeWidth={0.75}
                      strokeLinejoin="round"
                    />
                  </g>
                )}
                {!driving && (
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
            );
          })}
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
        {typeof overlay === 'function' ? overlay(scale, camera) : overlay}
      </svg>
      {mapTools}
      {mapPopup}
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
      {mapControls && (
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
        </nav>
      )}
    </section>
  );
});
