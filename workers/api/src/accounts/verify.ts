/** Local JWKS/JWT session verification (docs/optimize-transport.md change 4,
 * story E4S1).
 *
 * Session tokens are verified **locally** against Clerk's published JWKS —
 * no per-request Clerk API call, so every overlay/SLA poll costs one
 * subrequest at most (the cached JWKS fetch, once per isolate per hour).
 * At 2M DAU this is the difference between "free" and "Clerk rate limits
 * plus latency on every poll".
 *
 * Rules: only Bearer session tokens; identity comes exclusively from the
 * verified `sub` claim, never from request data; signature (RS256), expiry,
 * not-before, and issuer are all checked. Tampering fails closed.
 *
 * Unit tests (tests/accounts/verify.test.mjs) sign fixture tokens with a
 * real RSA key pair and assert that tampering with any segment fails. */

import { accountReply } from '../http/responses';
import { authorizedSessionParties } from './session-policy';
import type { AccountEnv } from './env';

/** A parsed + cryptographically verified session token's claims. */
export interface SessionClaims {
  sub: string;
  exp: number;
  nbf?: number;
  iss?: string;
  azp?: string;
  sid?: string;
}

export interface JsonWebKeySet {
  keys: Array<{
    kty: string;
    kid?: string;
    alg?: string;
    use?: string;
    n?: string;
    e?: string;
  }>;
}

/** JWKS refresh cadence. Clerk rotates keys rarely; an hour keeps a kid
 * miss from being more than a one-off refetch. */
const JWKS_CACHE_MS = 3_600_000;

const b64url = (value: string): Uint8Array<ArrayBuffer> => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const decodeJson = <T>(value: string): T | null => {
  try {
    return JSON.parse(new TextDecoder().decode(b64url(value))) as T;
  } catch {
    return null;
  }
};

/** Verify a session token against a JWKS. Pure — no I/O, no clock reads
 * (pass `now`); returns the claims or null. Never throws: every failure
 * path is simply "not verified". Checks: shape, RS256 signature via
 * WebCrypto, `exp`, `nbf`, and — when supplied — `iss`/`azp` against the
 * expected parties. */
export async function verifySessionToken(
  token: string,
  jwks: JsonWebKeySet,
  options: {
    now: number;
    issuer?: string;
    authorizedParties?: readonly string[];
  },
): Promise<SessionClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const header = decodeJson<{ alg?: string; kid?: string }>(parts[0]);
  const claims = decodeJson<SessionClaims>(parts[1]);
  if (!header || !claims) return null;
  if (header.alg !== 'RS256') return null;
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) return null;
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= options.now) return null;
  if (claims.nbf !== undefined && claims.nbf * 1000 > options.now) return null;
  if (options.issuer && claims.iss !== options.issuer) return null;
  if (
    options.authorizedParties?.length &&
    !options.authorizedParties.includes(claims.azp ?? '')
  )
    return null;
  const key = jwks.keys.find(
    (candidate) =>
      candidate.kty === 'RSA' &&
      (!header.kid || !candidate.kid || candidate.kid === header.kid),
  );
  if (!key || !key.n || !key.e) return null;
  try {
    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      { ...key, kty: 'RSA', n: key.n, e: key.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      b64url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    return valid ? claims : null;
  } catch {
    // Malformed segments or unusable key material: not verified, never a 500.
    return null;
  }
}

/** Fetch (and cache, in-isolate) the JWKS. One subrequest per hour per
 * isolate; failures propagate so callers can treat auth as unavailable. */
export async function fetchJwks(
  url: string,
  fetcher: typeof fetch = fetch,
  cache: { value?: { keys: JsonWebKeySet; at: number }; promise?: Promise<JsonWebKeySet> } = {},
  now = Date.now(),
): Promise<JsonWebKeySet> {
  if (cache.value && now - cache.value.at < JWKS_CACHE_MS) return cache.value.keys;
  cache.promise ??= fetcher(url)
    .then((response) => {
      if (!response.ok) throw new Error(`JWKS returned HTTP ${response.status}`);
      return response.json() as Promise<JsonWebKeySet>;
    })
    .then((keys) => {
      cache.value = { keys, at: now };
      return keys;
    })
    .finally(() => {
      cache.promise = undefined;
    });
  return cache.promise;
}

/** One isolate-scoped JWKS cache per Worker instance (module state). */
const jwksCache: { value?: { keys: JsonWebKeySet; at: number }; promise?: Promise<JsonWebKeySet> } =
  {};

/** Verify the request's Bearer session token locally.
 * Returns the verified user ID, or a 503/401 Response for the caller to
 * return verbatim. Identity never comes from query parameters. */
export async function verifySession(
  request: Request,
  env: AccountEnv & { CLERK_JWKS_URL?: string },
): Promise<string | Response> {
  if (!env.CLERK_JWKS_URL) return accountReply({ error: 'auth-unavailable' }, 503);
  const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return accountReply({ error: 'unauthorized' }, 401);
  let keys: JsonWebKeySet;
  try {
    keys = await fetchJwks(env.CLERK_JWKS_URL, fetch, jwksCache);
  } catch {
    return accountReply({ error: 'auth-unavailable' }, 503);
  }
  const claims = await verifySessionToken(token, keys, {
    now: Date.now(),
    authorizedParties: authorizedSessionParties(env),
  });
  if (!claims) return accountReply({ error: 'unauthorized' }, 401);
  return claims.sub;
}