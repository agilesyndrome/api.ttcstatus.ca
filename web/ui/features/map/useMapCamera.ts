import { useEffect, useRef, useState, type SVGProps } from 'react';
import { fitCamera, moveCamera, zoomCamera } from '../../../../shared/map/camera';
import { boundsOf, type Bounds, type Point } from '../../../../shared/map/model';
import type { TransitMapProps } from './types';

// Camera lifecycle and gestures share one current camera reference.
export function useMapCamera({
  data,
  cars = [],
  selectedRoute,
  selectedFeature,
  focusPoint,
  focusPointLevel,
  focusBounds,
  resetKey = 0,
  onInteract,
  driving = false,
  controlsRef,
  onSelectFeature,
  onSelectVehicle,
}: Pick<
  TransitMapProps,
  | 'data'
  | 'cars'
  | 'selectedRoute'
  | 'selectedFeature'
  | 'focusPoint'
  | 'focusPointLevel'
  | 'focusBounds'
  | 'resetKey'
  | 'onInteract'
  | 'driving'
  | 'controlsRef'
  | 'onSelectFeature'
  | 'onSelectVehicle'
>) {
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 1000, height: 700 });
  const initial = fitCamera(data.bounds, size.width / size.height);
  const [camera, setCamera] = useState<Bounds>(initial);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const pointers = useRef(new Map<number, Point>());
  const moved = useRef(false);
  const start = useRef<Point | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const pending = useRef<Bounds>(camera);
  const interact = useRef(onInteract);
  interact.current = onInteract;
  const scale = size.width / camera.width;
  const level = initial.width / camera.width;
  // At network scale, one compact marker per car leaves the tracks readable.
  // Reveal the full outlined, articulated body once there is room for it.
  const detailedCars = level >= 2.5;

  // Camera updates during a gesture are limited to one render per animation frame.
  function move(next: Bounds) {
    pending.current = next;
    cameraRef.current = next;
    if (frame.current === undefined)
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        setCamera(pending.current);
      });
  }
  function zoom(factor: number, anchor?: Point) {
    const current = cameraRef.current;
    move(
      zoomCamera(
        current,
        factor,
        anchor ?? [current.x + current.width / 2, current.y + current.height / 2],
        initialRef.current.width / 12,
        initialRef.current.width,
      ),
    );
  }
  function world(clientX: number, clientY: number): Point {
    const rect = svg.current!.getBoundingClientRect(),
      current = cameraRef.current;
    return [
      current.x + ((clientX - rect.left) * current.width) / rect.width,
      current.y + ((clientY - rect.top) * current.height) / rect.height,
    ];
  }
  useEffect(() => {
    if (!controlsRef) return;
    controlsRef.current = {
      zoomBy: (factor, clientPoint) =>
        zoom(factor, clientPoint ? world(...clientPoint) : undefined),
      followPoint: (point) => {
        const current = cameraRef.current;
        move({
          x: point[0] - current.width / 2,
          y: point[1] - current.height / 2,
          width: current.width,
          height: current.height,
        });
      },
      cancelGesture: () => {
        for (const id of pointers.current.keys())
          if (svg.current?.hasPointerCapture(id)) svg.current.releasePointerCapture(id);
        pointers.current.clear();
        moved.current = true;
      },
    };
    return () => {
      controlsRef.current = null;
    };
  }, [controlsRef, data]);
  useEffect(() => {
    const node = svg.current!;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        const current = cameraRef.current,
          previous = initialRef.current;
        const next = fitCamera(data.bounds, width / height);
        const zoomLevel = previous.width / current.width;
        const fitted =
          zoomLevel < 1.01
            ? next
            : {
                x: current.x + current.width / 2 - next.width / zoomLevel / 2,
                y: current.y + current.height / 2 - next.height / zoomLevel / 2,
                width: next.width / zoomLevel,
                height: next.height / zoomLevel,
              };
        setSize({ width, height });
        cameraRef.current = fitted;
        setCamera(fitted);
      }
    });
    observer.observe(node);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      interact.current?.();
      zoom(
        Math.exp(Math.max(-160, Math.min(160, event.deltaY)) * 0.0025),
        world(event.clientX, event.clientY),
      );
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      node.removeEventListener('wheel', wheel);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, [data]);
  useEffect(() => {
    move(initialRef.current);
  }, [resetKey]);
  useEffect(() => {
    if (!selectedRoute) return;
    const routePoints = data.edges
      .filter((edge) => edge.routeIds.includes(selectedRoute))
      .flatMap((edge) => edge.points);
    if (routePoints.length)
      move(fitCamera(boundsOf(routePoints, 80), size.width / size.height));
  }, [selectedRoute, data]);
  useEffect(() => {
    if (!selectedFeature) return;
    const fitted = initialRef.current,
      width = fitted.width / 5,
      height = fitted.height / 5;
    move({
      x: selectedFeature.point[0] - width / 2,
      y: selectedFeature.point[1] - height / 2,
      width,
      height,
    });
  }, [selectedFeature]);

  useEffect(() => {
    if (!focusPoint) return;
    const fitted = initialRef.current,
      level = Math.max(1, focusPointLevel ?? 5),
      width = driving ? cameraRef.current.width : fitted.width / level,
      height = driving ? cameraRef.current.height : fitted.height / level;
    move({ x: focusPoint[0] - width / 2, y: focusPoint[1] - height / 2, width, height });
  }, [focusPoint, focusPointLevel, driving]);
  useEffect(() => {
    if (focusBounds) move(fitCamera(focusBounds, size.width / size.height));
  }, [focusBounds]);

  const handlers: SVGProps<SVGSVGElement> = {
    onPointerDown: (event) => {
      if (event.button !== 0) return;
      if (!pointers.current.size) {
        moved.current = false;
        start.current = [event.clientX, event.clientY];
      } else moved.current = true;
      pointers.current.set(event.pointerId, [event.clientX, event.clientY]);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event) => {
      const previous = pointers.current.get(event.pointerId);
      if (!previous) return;
      const before = [...pointers.current.values()];
      pointers.current.set(event.pointerId, [event.clientX, event.clientY]);
      const after = [...pointers.current.values()];
      const rect = event.currentTarget.getBoundingClientRect();
      if (driving && event.pointerType === 'touch' && after.length === 1) {
        moved.current = true;
        return;
      }
      if (after.length > 1) {
        moved.current = true;
        const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
        const oldDistance = distance(before[0], before[1]),
          newDistance = distance(after[0], after[1]);
        if (newDistance && oldDistance)
          zoom(
            oldDistance / newDistance,
            world((after[0][0] + after[1][0]) / 2, (after[0][1] + after[1][1]) / 2),
          );
      } else if (
        start.current &&
        Math.hypot(event.clientX - start.current[0], event.clientY - start.current[1]) > 4
      )
        moved.current = true;
      if (moved.current) {
        interact.current?.();
        move(
          moveCamera(
            cameraRef.current,
            (-(event.clientX - previous[0]) * cameraRef.current.width) / rect.width,
            (-(event.clientY - previous[1]) * cameraRef.current.height) / rect.height,
          ),
        );
      }
    },
    onPointerUp: (event) => {
      if (!moved.current) {
        // Pointer capture retargets clicks: hit-test the original release position.
        const target = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest('[data-feature], [data-vehicle]');
        const feature = data.features.find(
          (feature) => feature.id === target?.getAttribute('data-feature'),
        );
        const car = cars.find(
          (car) => car.vehicle.id === target?.getAttribute('data-vehicle'),
        );
        if (car) onSelectVehicle(car);
        else if (feature) onSelectFeature(feature);
      }
      pointers.current.delete(event.pointerId);
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: (event) => {
      pointers.current.delete(event.pointerId);
      moved.current = true;
    },
    onDoubleClick: (event) => {
      interact.current?.();
      zoom(0.5, world(event.clientX, event.clientY));
    },
    onKeyDown: (event) => {
      if (driving) return;
      const directions: Record<string, Point> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (directions[event.key]) {
        event.preventDefault();
        interact.current?.();
        const [x, y] = directions[event.key];
        move(moveCamera(camera, x * camera.width * 0.08, y * camera.height * 0.08));
      } else if (['+', '=', '-'].includes(event.key)) {
        event.preventDefault();
        interact.current?.();
        zoom(event.key === '-' ? 1 / 0.7 : 0.7);
      } else if (event.key === 'Home' || event.key === '0') {
        event.preventDefault();
        interact.current?.();
        move(initial);
      }
    },
  };
  return {
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
  };
}
