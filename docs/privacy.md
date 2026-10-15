# Privacy

TTCstatus collects nothing that identifies a person or where a person was.
Device GPS never leaves the device. The contract details live in
[api/mobile-privacy.md](api/mobile-privacy.md); this page is the rulebook.

## What exists where

| Data                  | Where                                     | Rules                                                                                                                                                                                                                                                                                                                                        |
| --------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Device GPS / location | Browser or device only                    | Nearest stops computed on device (`shared/transit/nearby.ts`, device-only 500 m grid). Never transmitted: not in URLs (server rejects unallowlisted query fields), not in analytics, not in saved stops, journals, exports, or shared links. The `located` analytics event carries the action name only — no position, stop, route, or cell. |
| Account identity      | Clerk only                                | We store Clerk's `user_id`, nothing more. Emails live in Clerk; token `azp` is checked against `CLERK_AUTHORIZED_PARTIES` and fails closed. Bearer sessions, never cookie authorization.                                                                                                                                                     |
| Account data          | D1, keyed by `user_id`                    | `user_profiles` (username, colour mode, opt-in `public_badges`), `user_journals` (≤ 500 cars, notes private), `user_saved_stops` (≤ 100). Journal entries and notes are never public; badge profiles are opt-in. Writes are revision-checked (CAS, 409 on conflict).                                                                         |
| Usage analytics       | Cloudflare Analytics Engine (first party) | `POST /api/v1/event` accepts an exact allowlist of action names only. No third-party scripts.                                                                                                                                                                                                                                                |
| `ttc_aid` cookie      | Browser                                   | Random UUID, `HttpOnly`, `SameSite=Lax`, `Secure`. Exists only to count distinct users per action. Never joined with accounts, journals, or location; never leaves Cloudflare.                                                                                                                                                               |
| Logs                  | Cloudflare                                | Route + method + error class only. No raw URLs, query values, exception text, tokens, or payloads. `wrangler.jsonc` disables invocation logs and redacts query strings.                                                                                                                                                                      |
| Live tick documents   | `live.ttcstatus.ca` (R2)                  | World-readable broadcast fleet data by design; no identity, no location, no per-user anything.                                                                                                                                                                                                                                               |
| IP addresses          | Hosting provider                          | Normal connection metadata exists at Cloudflare. This is GPS privacy, not network anonymity.                                                                                                                                                                                                                                                 |

## Enforcement (the controls, not hopes)

- HTTP seam allowlists query fields; account/event schemas reject unknown
  fields. The rejection is the control — don't widen it casually.
- Account ownership comes only from verified sessions, never request fields.
- Admin/diagnostic surfaces (`/api/v1/admin/sync`, `/api/v1/feed/status`,
  debug map render, generator debug) require the `SYNC_TOKEN` bearer
  (SHA-256, constant-time compare). `/api/v1/feed/status` is `404` without a
  token configured, `401` without the credential.
- Site headers (`public/_headers`): `nosniff`, HSTS,
  `X-Frame-Options: DENY`, `Permissions-Policy`, enforced CSP. Dev-only Clerk
  widening rewrites `dist/_headers` (never `public/_headers`).
- gitleaks scans the working tree and full git history on every pre-flight
  run; `.env.*` files are gitignored but still scanned.
- Account/conflict responses are `no-store`; exports omit your location, and
  browser tests verify export and saved-map privacy.

## Caveats that will burn you

- Adding a query parameter or analytics action without updating the
  allowlist fails the request. That failure is intentional.
- `ttc_aid` is a cookie: never join it to accounts or location, never widen
  its SameSite/HttpOnly settings.
- Usernames are unique and case-insensitive; public badges expose the
  username. Treat username as a quasi-identifier.
- Do not re-enable wrangler invocation logs or remove query-string
  redaction — automatic logs contain raw URLs.
- `CLERK_SECRET_KEY` stays in the Worker. `CLERK_PUBLISHABLE_KEY` (`pk_live_…`)
  is public by design and fetched at runtime from `/api/v1/auth/config` —
  never bake it as a `VITE_` variable.
- Sign-out removes server snapshots and pending local drafts together;
  session changes abort in-flight edits. Don't add persistence that
  outlives sign-out. Locally inferred nearest stops never auto-become
  cloud favourites.
- Git history still contains a rotated, now-invalid `SYNC_TOKEN`
  (acknowledged in `.gitleaksignore`). Don't rotate to something guessable;
  don't commit new secrets to "fix" it.
