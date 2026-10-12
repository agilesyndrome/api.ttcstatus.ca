import {
  buildViewerData,
  type ViewerData,
  type ViewerSource,
} from '../../../../../shared/map/model';

export function isViewerData(value: unknown): value is ViewerData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<ViewerData>;
  return (
    (data.format === undefined || data.format === 'ttc-viewer-map') &&
    (data.schemaVersion === undefined || data.schemaVersion === 1) &&
    Array.isArray(data.features) &&
    Array.isArray(data.routes) &&
    Array.isArray(data.edges) &&
    data.edges.length > 0 &&
    Boolean(data.geographicTransform?.projection) &&
    Boolean(data.bounds) &&
    typeof data.snapshot === 'string'
  );
}

/** Prefer explicit format identity; legacy cached maps retain their shape-based fallback. */
export function viewerPayload(value: unknown): ViewerData {
  if (value && typeof value === 'object') {
    const identity = value as { format?: string; schemaVersion?: number };
    if (
      (identity.format !== undefined &&
        !['ttc-schematic-map', 'ttc-viewer-map'].includes(identity.format)) ||
      (identity.schemaVersion !== undefined && identity.schemaVersion !== 1)
    )
      throw new Error('Unsupported map format');
  }
  if (
    value &&
    typeof value === 'object' &&
    'graph' in value &&
    (!('format' in value) || value.format === 'ttc-schematic-map')
  ) {
    const source = value as ViewerSource;
    if (
      !Array.isArray(source.stops) ||
      !Array.isArray(source.routes) ||
      !Array.isArray(source.patterns)
    )
      throw new Error('Invalid map payload');
    return buildViewerData(source);
  }
  if (!isViewerData(value)) throw new Error('Invalid map payload');
  return value;
}
