import type { Route } from '../../../../shared/map/model';
export interface ExportDetails {
  title: string;
  snapshot: string;
  capturedAt: string;
  routes: Route[];
  northAngle: number;
  feed?: string;
  endpoints?: string[];
  includeCars: boolean;
}
const NS = 'http://www.w3.org/2000/svg';
/** Build a self-contained image of the current camera, with a paper palette.
 * Personal location and bookmark decorations are deliberately omitted. */
export function exportMap(svg: SVGSVGElement, details: ExportDetails): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone
    .querySelectorAll('.location-marker,.saved-marker,script,foreignObject,image,a')
    .forEach((node) => node.remove());
  if (!details.includeCars)
    clone.querySelectorAll('.live-car').forEach((node) => node.remove());
  for (const node of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    for (const attribute of Array.from(node.attributes)) {
      if (
        /^on/i.test(attribute.name) ||
        [
          'id',
          'tabindex',
          'role',
          'aria-hidden',
          'aria-label',
          'style',
          'href',
          'xlink:href',
        ].includes(attribute.name) ||
        attribute.name.startsWith('data-')
      )
        node.removeAttribute(attribute.name);
      else if (attribute.value.includes('var(--surface)'))
        node.setAttribute(
          attribute.name,
          attribute.value.replaceAll('var(--surface)', '#fffdf7'),
        );
    }
  }
  const document = svg.ownerDocument;
  const element = (
    name: string,
    attributes: Record<string, string | number> = {},
    text?: string,
  ) => {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attributes))
      node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const width = 1200,
    padding = 24,
    mapWidth = width - 2 * padding;
  const box = svg.getBoundingClientRect();
  const mapHeight = Math.round(
    Math.max(300, Math.min(900, (mapWidth * (box.height || 600)) / (box.width || 900))),
  );
  const mapY = 96,
    legendY = mapY + mapHeight + 26;
  const lines = [
    ...(details.endpoints ?? []),
    'Map snapshot: ' +
      (details.snapshot || 'not supplied') +
      ' · Captured: ' +
      details.capturedAt,
    ...(details.includeCars && details.feed ? [details.feed] : []),
    'Schematic map · Train markers show predicted stations; streetcars show reported positions · Location marker and saved-stop stars omitted.',
    'TTC service & Toronto geography · Open Government Licence – Toronto · © OpenStreetMap contributors · ODbL.',
  ].flatMap(
    (line) => line.match(/.{1,145}(?:\s|$)|.{1,145}/g)?.map((part) => part.trim()) ?? [],
  );
  const footerY = legendY + Math.ceil(details.routes.length / 3) * 24 + 20;
  const height = footerY + lines.length * 20 + 24;
  const root = element('svg', {
    xmlns: NS,
    width,
    height,
    viewBox: '0 0 ' + width + ' ' + height,
    fill: '#25343c',
    role: 'img',
    'aria-labelledby': 'export-title export-description',
  });
  root.append(element('title', { id: 'export-title' }, details.title));
  root.append(
    element(
      'desc',
      { id: 'export-description' },
      'Current view of the Toronto rail map. ' + lines.join(' '),
    ),
  );
  root.append(
    element(
      'style',
      {},
      'text{font-family:system-ui,sans-serif}.track{vector-effect:non-scaling-stroke}.marker{fill:#fffdf7;stroke:#43535e}.map-label text{paint-order:stroke;stroke:#f7f5ed;stroke-width:4;stroke-linejoin:round;fill:#43535e}.water-context polygon{fill:#d8e8e9}.water-context polyline{stroke:#bdd7da}',
    ),
  );
  root.append(element('rect', { width, height, fill: '#fffdf7' }));
  root.append(
    element(
      'text',
      { x: padding, y: 42, 'font-size': 28, 'font-weight': 700 },
      details.title,
    ),
  );
  root.append(
    element(
      'text',
      { x: padding, y: 70, 'font-size': 13 },
      'Your Toronto rail field map · Current view',
    ),
  );
  root.append(
    element('rect', {
      x: padding,
      y: mapY,
      width: mapWidth,
      height: mapHeight,
      fill: '#f7f5ed',
      stroke: '#d9dfd7',
    }),
  );
  clone.setAttribute('x', String(padding));
  clone.setAttribute('y', String(mapY));
  clone.setAttribute('width', String(mapWidth));
  clone.setAttribute('height', String(mapHeight));
  clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  root.append(clone);
  const north = element('g', {
    transform: 'translate(' + (width - padding - 44) + ' ' + (mapY + 10) + ')',
  });
  north.append(
    element('rect', { x: 0, y: 0, width: 40, height: 56, rx: 6, fill: '#fffdf7' }),
  );
  north.append(
    element('text', { x: 20, y: 14, 'text-anchor': 'middle', 'font-size': 11 }, 'N'),
  );
  north.append(
    element('path', {
      d: 'M7 18H29M21 13L29 18L21 23',
      transform: 'translate(2 16) rotate(' + details.northAngle + ' 18 18)',
      fill: 'none',
      stroke: '#43535e',
      'stroke-width': 1.6,
    }),
  );
  root.append(north);
  details.routes.forEach((route, index) => {
    const x = padding + (index % 3) * (mapWidth / 3),
      y = legendY + Math.floor(index / 3) * 24;
    root.append(
      element('line', {
        x1: x,
        x2: x + 24,
        y1: y - 4,
        y2: y - 4,
        stroke: route.color,
        'stroke-width': 4,
      }),
    );
    root.append(
      element(
        'text',
        { x: x + 32, y, 'font-size': 11 },
        (route.number + ' ' + route.name + (route.overnight ? ' · overnight' : '')).slice(
          0,
          57,
        ),
      ),
    );
  });
  lines.forEach((line, index) =>
    root.append(
      element('text', { x: padding, y: footerY + index * 20, 'font-size': 11 }, line),
    ),
  );
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    new XMLSerializer().serializeToString(root)
  );
}
