import {
  DEFAULT_FILTERS,
  type MapLink,
  type MapFilterValues,
  type MapTools,
  type Selection,
} from './types';

export function readMapLink(hash: string): MapLink {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const filters: Partial<MapFilterValues> = {};
  const tools: MapTools = {};
  const panel = params.get('view');
  if (panel === 'journal' || panel === 'badges') tools.panel = panel;
  for (const key of ['live', 'labels', 'overnight', 'streetcar', 'subway'] as const) {
    if (params.get(key) === '1' || params.get(key) === '0')
      filters[key] = params.get(key) === '1';
  }
  const route = params.get('route');
  for (const kind of ['stop', 'car', 'route'] as const) {
    const id = params.get(kind);
    if (id && id.length <= 200)
      return {
        selection: { kind, id },
        filters,
        ...tools,
        ...(kind !== 'route' && route && route.length <= 200
          ? { contextRoute: route }
          : {}),
      };
  }
  return { filters, ...tools };
}
export function mapLinkHash(
  selection: Selection | undefined,
  filters: MapFilterValues,
  contextRoute?: string,
  tools?: MapTools,
): string {
  const params = new URLSearchParams();
  if (selection) params.set(selection.kind, selection.id);
  if (contextRoute && selection?.kind !== 'route') params.set('route', contextRoute);
  if (tools?.panel && tools.panel !== 'explore') params.set('view', tools.panel);
  for (const key of ['live', 'labels', 'overnight', 'streetcar', 'subway'] as const)
    if (filters[key] !== DEFAULT_FILTERS[key]) params.set(key, filters[key] ? '1' : '0');
  return params.size ? `#${params}` : '';
}
