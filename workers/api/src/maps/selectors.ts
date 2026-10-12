import { json } from '../http/responses';

export const MAP_NAMES = ['streetcar', 'snake', 'ttcstatus'] as const;

/** Public release selectors contain no geography or user identity. */
export function mapSelector(url: URL, defaultName = 'ttcstatus') {
  const name = url.searchParams.get('map') ?? defaultName;
  const tag = url.searchParams.get('tag') || undefined;
  const rawArtifact = url.searchParams.get('artifact');
  const artifactId = rawArtifact === null ? undefined : Number(rawArtifact);
  if (
    !MAP_NAMES.includes(name as (typeof MAP_NAMES)[number]) ||
    (rawArtifact !== null &&
      (!/^\d+$/.test(rawArtifact) ||
        !Number.isSafeInteger(artifactId) ||
        Number(artifactId) <= 0 ||
        url.searchParams.has('tag')))
  ) {
    return json({ error: 'invalid-artifact-selector' }, 400, {
      'cache-control': 'no-store',
    });
  }
  return { name, tag, artifactId };
}
