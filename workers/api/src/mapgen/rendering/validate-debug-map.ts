import type { DebugMapBundle } from './debug-types';

// Validate only rendering inputs; additional map metadata remains compatible.
const MAX_ITEMS = 20_000;
const MAX_LABELS = 1_000;

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Map rendering requires objects');
  }
  return value as RecordValue;
}

function finite(value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Map coordinates and angles must be finite numbers');
  }
}

function text(value: unknown, optional = false): void {
  if (optional && value === undefined) return;
  if (typeof value !== 'string')
    throw new Error('Map labels and identifiers must be strings');
}

function items(
  value: unknown,
  visit: (value: unknown) => void,
  maximum = MAX_ITEMS,
): void {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error('Map collection is invalid or too large');
  }
  value.forEach(visit);
}

function point(value: unknown): void {
  if (!Array.isArray(value) || value.length !== 2) throw new Error('Invalid map point');
  value.forEach(finite);
}

function identifiers(value: unknown): void {
  items(value, (item) => text(item));
}

export function validateDebugMapBundle(value: unknown): asserts value is DebugMapBundle {
  const bundle = record(value);
  const display = record(bundle.display);
  finite(display.width);
  finite(display.height);
  if (Number(display.width) <= 0 || Number(display.height) <= 0) {
    throw new Error('map display dimensions must be positive numbers');
  }
  text(bundle.generatorVersion, true);

  if (bundle.routes !== undefined)
    items(bundle.routes, (value) => {
      const route = record(value);
      text(route.id);
      text(route.shortName, true);
      text(route.longName, true);
      text(route.color, true);
    });
  for (const name of ['paths', 'infrastructure']) {
    if (bundle[name] !== undefined)
      items(bundle[name], (value) => {
        const path = record(value);
        text(path.id);
        text(path.name, true);
        text(path.kind, true);
        if (path.routeIds !== undefined) identifiers(path.routeIds);
        if (path.points !== undefined) items(path.points, point);
      });
  }
  if (bundle.stops !== undefined)
    items(bundle.stops, (value) => {
      const stop = record(value);
      text(stop.id);
      text(stop.name, true);
      finite(stop.x);
      finite(stop.y);
    });
  if (bundle.graph !== undefined) {
    const graph = record(bundle.graph);
    items(graph.nodes, (value) => {
      const node = record(value);
      text(node.id);
      finite(node.x);
      finite(node.y);
      identifiers(node.edgeIds);
    });
    items(graph.edges, (value) => {
      const edge = record(value);
      text(edge.id);
      identifiers(edge.routeIds);
      identifiers(edge.infrastructureIds);
      items(edge.points, point);
      if (!(edge.points as unknown[]).length) throw new Error('Map edges need points');
    });
  }
  if (bundle.context !== undefined) {
    const context = record(bundle.context);
    items(
      context.labels ?? [],
      (value) => {
        const label = record(value);
        text(label.text);
        text(label.kind);
        finite(label.angle);
        point(label.point);
      },
      MAX_LABELS,
    );
    items(context.shoreline ?? [], point);
    finite(record(context.north).angle);
  }
}
