// API query inputs are public artifact selectors or explicitly chosen transit
// preferences. Adding a parameter requires a deliberate contract change here.
export const allowedApiQueries: Record<string, readonly string[]> = {
  '/api/v1/map/streetcar': ['tag', 'artifact', 'format', 'client'],
  '/api/v1/map/snake': ['tag', 'artifact', 'format', 'client'],
  '/api/v1/map/ttcstatus': ['tag', 'artifact', 'format', 'client'],
  '/api/v1/stops': ['map', 'tag', 'artifact'],
  '/api/v1/manifest': ['map', 'tag'],
  '/api/v1/service/stops': ['routes'],
  '/api/v1/service/wave': ['routes'],
  '/api/v1/service/history': ['stop', 'routes', 'from'],
  '/api/v1/sla/report': ['route'],
};

export function hasUnsupportedApiQuery(url: URL): boolean {
  if (!url.pathname.startsWith('/api/')) return false;
  const allowed = allowedApiQueries[url.pathname] ?? [];
  return [...url.searchParams.keys()].some((field) => !allowed.includes(field));
}
