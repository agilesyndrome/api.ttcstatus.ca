import {
  buildViewerData,
  type ViewerData,
  type ViewerSource,
} from '../../../../../shared/map/model';

export function isViewerData(value: unknown): value is ViewerData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<ViewerData>;
  return (
    Array.isArray(data.features) &&
    Array.isArray(data.routes) &&
    Array.isArray(data.edges) &&
    data.edges.length > 0 &&
    Boolean(data.geographicTransform?.projection) &&
    Boolean(data.bounds) &&
    typeof data.snapshot === 'string'
  );
}

/** Accept both existing wire formats; the API contract is unchanged. */
export function viewerPayload(value: unknown): ViewerData {
  if (value && typeof value === 'object' && 'graph' in value) {
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
