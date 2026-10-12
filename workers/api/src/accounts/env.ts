import type { D1Database } from '../../../shared/cloudflare/bindings';

export interface AccountEnv {
  DB: D1Database;
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_SECRET_KEY?: string;
  CLERK_AUTHORIZED_PARTIES?: string;
  /** Clerk's published JWKS (e.g. https://<frontend-api>/.well-known/jwks.json)
   * — enables local session verification (optimize-transport.md E4S1). When
   * unset, session-token verification reads auth-unavailable. */
  CLERK_JWKS_URL?: string;
  // Live transport discovery (docs/optimize-transport.md change 1b): every
  // field is public by design and served from `/api/v1/auth/config`, so
  // clients (including shipped native binaries) never bake a live host,
  // cadence, or vehicle path. Repointing the fleet transport must never
  // require an app update.
  LIVE_PUBLIC_BASE?: string;
  LIVE_PATH_TEMPLATE?: string;
  LIVE_UPDATE_SECONDS?: string;
}
