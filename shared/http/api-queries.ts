// API query inputs are public artifact selectors or explicitly chosen transit
// preferences. Adding a parameter requires a deliberate contract change here.
export const allowedApiQueries: Record<string, readonly string[]> = {
  '/api/v1/map/streetcar': ['tag', 'artifact', 'format', 'client'],
  '/api/v1/map/snake': ['tag', 'artifact', 'format', 'client'],
  '/api/v1/map/ttcstatus': ['tag', 'artifact', 'format', 'client'],
  '/api/v1/stops': ['map', 'tag', 'artifact'],
  '/api/v1/manifest': ['map', 'tag'],
  '/api/v1/service/wave': ['routes'],
  '/api/v1/service/history': ['stop', 'routes', 'from'],
  '/api/v1/sla/report': ['route'],
};

/** Location-bearing parameter names rejected on EVERY path (optimize-transport.md
 * change 7, E6S1) — the tripwire for the 2027 `?lat=&lon=` PR. Query strings
 * on the live host are already impossible by construction (format variants are
 * paths, change 1's rule); this list extends the same rejection to any public
 * path the Worker serves, including future live-host-shaped routes. */
export const locationQueryParameters: ReadonlySet<string> = new Set([
  'lat',
  'latitude',
  'lon',
  'lng',
  'long',
  'longitude',
  'accuracy',
  'geohash',
  'quadrant',
  'cellId',
  'cellid',
  'bbox',
]);

/** A location query parameter is rejected everywhere — even on paths whose
 * selector allowlist would otherwise admit it, and even on paths with no
 * allowlist entry at all. Broadcast data never carries device location. */
export function hasLocationQuery(url: URL): boolean {
  for (const field of url.searchParams.keys()) {
    if (locationQueryParameters.has(field.toLowerCase())) return true;
  }
  return false;
}

export function hasUnsupportedApiQuery(url: URL): boolean {
  if (!url.pathname.startsWith('/api/')) return false;
  const allowed = allowedApiQueries[url.pathname] ?? [];
  return [...url.searchParams.keys()].some((field) => !allowed.includes(field));
}
