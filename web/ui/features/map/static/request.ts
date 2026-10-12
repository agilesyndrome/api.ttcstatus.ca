const MAP_NAMES = ['ttcstatus', 'streetcar', 'snake'] as const;
/** Bump when the frontend map/cache contract changes. */
export const MAP_CLIENT_VERSION = 2;

/** Named boards and pinned tags retain their existing share/preview URL syntax. */
export function mapRequestFromSearch(search: string) {
  const params = new URLSearchParams(search);
  const requested = params.get('map');
  const name = (MAP_NAMES as readonly string[]).includes(requested ?? '')
    ? requested
    : 'ttcstatus';
  const version = params.get('mapVersion');
  const selector =
    version && /^[\w][\w.-]{0,63}$/.test(version)
      ? `tag=${encodeURIComponent(version)}`
      : name === 'streetcar'
        ? 'format=schematic-v1'
        : '';
  const query = new URLSearchParams(selector);
  query.set('client', String(MAP_CLIENT_VERSION));
  return `/api/v1/map/${name}?${query}`;
}
