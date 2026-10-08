import type { Env } from '../env';
import { json } from '../http/responses';

/** Public build/deploy identity. The deployed Worker version comes from the
 * Cloudflare version_metadata binding; manual `wrangler deploy` builds have no
 * binding-backed version and answer with `deploy: null`. The homepage footer
 * independently shows the site version embedded at build time. */
export function versionResponse(env: Env): Response {
  const version = env.CF_VERSION_METADATA;
  return json(
    {
      site: 'ttcstatus.ca',
      source: 'https://github.com/agilesyndrome/api.ttcstatus.ca',
      deploy: version
        ? { id: version.id, tag: version.tag, timestamp: version.timestamp }
        : null,
    },
    200,
    { 'cache-control': 'no-store' },
  );
}
