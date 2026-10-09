import type { Env } from '../env';
import { cors, json } from '../http/responses';

/** Broad, product-level actions the app reports. The allowlist keeps the
 * endpoint from becoming a free-form log: only these exact strings are
 * recorded, and no request payload (never a location) is ever stored. */
const ACTIONS = new Set([
  'located',
  'tracked-streetcar',
  'played-snake',
  'saved-stop',
  'removed-stop',
  'exported-map',
]);

/** Anonymous visitor id cookie: a random id with no account, location or
 * profile attached, letting queries count distinct users per action. */
const VISITOR_COOKIE = 'ttc_aid';
const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 400;
const VISITOR_ID = /^[0-9a-f-]{8,64}$/i;

function visitorId(request: Request): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === VISITOR_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export async function analyticsEventResponse(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.ANALYTICS)
    return json({ error: 'analytics-disabled' }, 404, { 'cache-control': 'no-store' });
  // Reject obviously oversized bodies before reading them.
  if (Number(request.headers.get('content-length') ?? 0) > 1024)
    return json({ error: 'payload-too-large' }, 413, { 'cache-control': 'no-store' });
  let action: unknown;
  try {
    action = (await request.json()).action;
  } catch {
    return json({ error: 'invalid-body' }, 400, { 'cache-control': 'no-store' });
  }
  if (typeof action !== 'string' || !ACTIONS.has(action))
    return json({ error: 'unknown-action' }, 422, { 'cache-control': 'no-store' });
  const given = visitorId(request);
  const id = given && VISITOR_ID.test(given) ? given : crypto.randomUUID();
  // blob1 is the action, blob2 the anonymous visitor id — enough for
  // "how many distinct users today took <action>" queries, and nothing that
  // could identify a person or where they are.
  env.ANALYTICS.writeDataPoint({ blobs: [action, id] });
  const headers = cors(new Headers());
  if (given !== id)
    headers.append(
      'set-cookie',
      `${VISITOR_COOKIE}=${encodeURIComponent(id)}; Max-Age=${VISITOR_COOKIE_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    );
  // The data point is already queued in the runtime; nothing else to await.
  return new Response(null, { status: 204, headers });
}
