const MAP_NAMES = ['ttcstatus', 'streetcar', 'snake'] as const;

/** Named boards and pinned tags retain their existing share/preview URL syntax. */
export function mapRequestFromSearch(search: string) {
  const params = new URLSearchParams(search);
  const requested = params.get('map');
  const name = (MAP_NAMES as readonly string[]).includes(requested ?? '')
    ? requested
    : 'ttcstatus';
  const version = params.get('mapVersion');
  const tag =
    version && /^[\w][\w.-]{0,63}$/.test(version)
      ? `?tag=${encodeURIComponent(version)}`
      : '';
  return `/api/v1/map/${name}${tag || (name === 'streetcar' ? '?format=schematic-v1' : '')}`;
}
