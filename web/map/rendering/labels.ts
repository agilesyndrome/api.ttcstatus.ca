import type { Edge, Feature, Point, Route, ViewerData } from '../../../shared/map/model';
import { shape } from './dom';

interface LabelOptions {
  scale: number;
  data: ViewerData;
  labelsLayer: SVGGElement;
  rect(): DOMRect;
  screenPoint(point: Point): Point;
  worldPoint(x: number, y: number): Point;
  zoomLevel(): number;
  selected?: Feature;
  hovered?: Feature;
  selectedRoute?: string;
  moreLabels: boolean;
  sortedRoutes(ids: string[]): Route[];
  paintedRoute(edge: Edge): Route | undefined;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function renderLabels({
  scale,
  data,
  labelsLayer,
  rect,
  screenPoint,
  worldPoint,
  zoomLevel,
  selected,
  hovered,
  selectedRoute,
  moreLabels,
  sortedRoutes,
  paintedRoute,
}: LabelOptions) {
  labelsLayer.replaceChildren();
  const occupied: Box[] = [
    { x: 0, y: rect().height - 65, width: 340, height: 65 },
    { x: rect().width - 60, y: 0, width: 60, height: 75 },
  ];
  const fits = (box: Box) =>
    box.x > 8 &&
    box.y > 10 &&
    box.x + box.width < rect().width - 8 &&
    box.y + box.height < rect().height - 8 &&
    !occupied.some(
      (p) =>
        box.x < p.x + p.width + 4 &&
        box.x + box.width + 4 > p.x &&
        box.y < p.y + p.height + 4 &&
        box.y + box.height + 4 > p.y,
    );
  const visible = (p: Point) => {
    const [x, y] = screenPoint(p);
    return x >= 0 && y >= 0 && x <= rect().width && y <= rect().height;
  };
  // Reserve quiet street names before the detailed boarding labels fill in.
  for (const label of data.labels) {
    if (!visible(label.point)) continue;
    const [x, y] = screenPoint(label.point),
      width = label.text.length * 6.5 + 10,
      height = 22;
    const vertical = Math.abs(label.angle) === 90;
    const box = {
      x: x - (vertical ? height : width) / 2,
      y: y - (vertical ? width : height) / 2,
      width: vertical ? height : width,
      height: vertical ? width : height,
    };
    if (!fits(box)) continue;
    occupied.push(box);
    const group = shape('g', {
      class: 'street-label',
      transform: `translate(${label.point.join(' ')}) scale(${1 / scale}) rotate(${label.angle})`,
    });
    const text = shape('text', {
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': 12,
      fill: '#7c8789',
      'letter-spacing': 0.6,
    });
    text.textContent = label.text;
    group.append(text);
    labelsLayer.append(group);
  }
  const labelFeatures = data.features
    .filter(
      (f) =>
        visible(f.point) &&
        (f.kind === 'terminal' ||
          f.id === selected?.id ||
          f.id === hovered?.id ||
          zoomLevel() >= (moreLabels ? 1 : 5.5)),
    )
    .sort(
      (a, b) =>
        Number(b.id === selected?.id) - Number(a.id === selected?.id) ||
        Number(b.id === hovered?.id) - Number(a.id === hovered?.id) ||
        Number(b.kind === 'terminal') - Number(a.kind === 'terminal') ||
        Number(b.routeIds.includes(selectedRoute ?? '')) -
          Number(a.routeIds.includes(selectedRoute ?? '')),
    );
  for (const f of labelFeatures) {
    const [x, y] = screenPoint(f.point),
      terminal = f.kind === 'terminal';
    const name = f.name.replace(/\s+/g, ' ');
    const text = name.length > 43 && zoomLevel() < 5 ? `${name.slice(0, 40)}…` : name;
    const sub =
      zoomLevel() >= 7 && !terminal
        ? sortedRoutes(f.routeIds)
            .map((r) => r.number)
            .join(' · ')
        : '';
    const width = text.length * (terminal ? 6.7 : 5.8) + 12,
      height = sub ? 35 : 23;
    const offsets = [
      [10, -height - 3],
      [10, 5],
      [-width - 10, -height - 3],
      [-width - 10, 5],
      [-width / 2, -height - 11],
      [-width / 2, 12],
    ];
    const box = offsets
      .map(([dx, dy]) => ({ x: x + dx, y: y + dy, width, height }))
      .find(fits);
    if (!box) continue;
    occupied.push(box);
    const p = worldPoint(rect().left + box.x, rect().top + box.y);
    const group = shape('g', {
      class: terminal ? 'terminal-label' : 'stop-label',
      transform: `translate(${p[0]} ${p[1]}) scale(${1 / scale})`,
    });
    group.append(shape('rect', { width, height, rx: 4, fill: '#fffdf7', opacity: 0.95 }));
    const title = shape('text', {
      x: 6,
      y: 15,
      fill: f.id === selected?.id ? '#167c7e' : '#25343c',
      'font-size': terminal ? 12 : 11,
      'font-weight': terminal ? 650 : 500,
    });
    title.textContent = text;
    group.append(title);
    if (sub) {
      const subtitle = shape('text', { x: 6, y: 28, fill: '#697980', 'font-size': 10 });
      subtitle.textContent = sub;
      group.append(subtitle);
    }
    labelsLayer.append(group);
  }
  for (const route of data.routes.filter((r) => !r.overnight)) {
    const candidates = data.edges
      .filter(
        (e) =>
          paintedRoute(e)?.id === route.id &&
          visible(e.points[Math.floor(e.points.length / 2)]),
      )
      .sort((a, b) => b.lengthMetres - a.lengthMetres);
    const edge = candidates[0];
    if (!edge) continue;
    const point: Point = [
      (edge.points[0][0] + edge.points.at(-1)![0]) / 2,
      (edge.points[0][1] + edge.points.at(-1)![1]) / 2,
    ];
    const [x, y] = screenPoint(point),
      box = { x: x - 17, y: y - 10, width: 34, height: 20 };
    if (!fits(box)) continue;
    occupied.push(box);
    const badge = shape('g', {
      transform: `translate(${point.join(' ')}) scale(${1 / scale})`,
      opacity: selectedRoute && selectedRoute !== route.id ? 0.3 : 1,
    });
    badge.append(
      shape('rect', {
        x: -17,
        y: -10,
        width: 34,
        height: 20,
        rx: 5,
        fill: '#fffdf7',
        stroke: route.color,
        'stroke-width': 1.5,
      }),
    );
    const text = shape('text', {
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': 11,
      'font-weight': 700,
      fill: route.color,
    });
    text.textContent = route.number;
    badge.append(text);
    labelsLayer.append(badge);
  }
}
