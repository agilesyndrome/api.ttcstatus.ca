# Security and deployment notes

## Exposed admin credential

The previously committed `.env` is no longer tracked. Both Workers reject its
SHA-256 fingerprint, even if an environment still configures that credential.
The fingerprint is not a replacement token. Source scanning reports filenames
without printing credential values.

Git history still contains the old credential. Removing a file does not revoke a
deployed secret, and rewriting history would affect other branches and clones.
This refactor does not rewrite history or mutate production configuration.

Before deploying this branch, generate a new high-entropy `SYNC_TOKEN` and set the
same value on the API and map-generator Workers through Wrangler's secret prompts:

```sh
npx wrangler secret put SYNC_TOKEN -c workers/api/wrangler.jsonc
npx wrangler secret put SYNC_TOKEN -c workers/map-generator/wrangler.jsonc
```

The laptop can synchronize all runtime secrets from 1Password in one command. The
default environment is `prod`; use `ENV=local` or another environment name when
that `.env.<name>` file is available:

```sh
ENV=prod npm run secrets:sync
ENV=local npm run secrets:sync
```

Run this after deploying the Workers when Cloudflare has lost a runtime binding.
The command restores `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` on the API
Worker, and `SYNC_TOKEN` on both Workers. Cloudflare Build deployments cannot run
this command because they do not have access to the laptop's 1Password session.
The deploy commands use Wrangler's `--keep-vars` flag so dashboard-managed
variables are retained during a deployment.

Update your ignored local `.env` or secret manager with the replacement credential.
Keep `.env.example` as placeholders. Verify the old credential returns 401, the new
credential authorizes the intended admin operation, and a missing token leaves
manual operations disabled. These deployment checks have not been run against
production as part of the branch refactor.

## Input boundaries

Valid existing API paths, response payloads, map geometry, account behavior and
persisted formats remain unchanged. Security fixes reject malformed inputs and
bound resource consumption:

- Debug map bodies: 2,000,000 streamed bytes; numeric attributes must be finite
  numbers, labels/identifiers must be strings, and rendering collections are bounded.
- Account bodies: per-endpoint caps enforced through the shared byte reader with
  stream cleanup — journals are capped at 1,200,000 bytes (above the ~1.1 MB
  theoretical maximum of a fully loaded 500-entry ASCII journal) and profiles at
  2,000 bytes (a username plus a boolean).
- Static GTFS: 512 MiB downloaded, a 60-second HEAD deadline and a 180-second GET
  deadline. Real-time feed limits remain unchanged.
- ZIP metadata: directory/member ranges must fit the archive; directories are
  limited to 2 MiB and members to 1 GiB after decompression. Output cannot exceed
  the declared member size. Members are streamed, not extracted to the filesystem.
- CSV: fields are limited to 1 MiB of characters and rows to 1,000 columns.

Generated debug SVG responses include a sandbox CSP and `nosniff`. Label text is
escaped independently of numeric validation. Public profile projection, private
journal data and session-token verification retain their existing behavior.

## Admin authentication

`authorizedSync` hashes both the presented bearer credential and the configured
`SYNC_TOKEN` with SHA-256 and compares fixed-length hex digests, so request
timing cannot leak the raw secret. The revoked Git-history fingerprint is
checked against the digest of the configured secret before any match is honored.
All four admin/diagnostic surfaces (`/api/v1/admin/sync`,
`/api/v1/debug/map/streetcar.svg`, the generator's `/api/debug/render` and
`/api/internal/generate`, and `/api/v1/feed/status`) use this check.

## Operational diagnostics

`/api/v1/feed/status` returns `404` when no `SYNC_TOKEN` is configured and
`401` without the admin credential. It previously published source URLs, R2
keys, lock state and raw upstream error text without authentication; the same
payload is now only available to the admin credential (`make admin/sync/status`
on the laptop).

## Site-wide headers

`public/_headers` applies `nosniff`, `Referrer-Policy`, `Permissions-Policy`,
`X-Frame-Options: DENY` and HSTS to all static responses. The classic snake game
gets an enforced `Content-Security-Policy` (`default-src 'self'`, no remote
origins). The application shell is in `Content-Security-Policy-Report-Only` mode
until the production Clerk frontend-api origin is confirmed and added — decode
it from the `pk_live_…` key suffix:

```sh
op run --env-file=.env.prod -- node -e \
  "const k=process.env.CLERK_PUBLISHABLE_KEY;console.log(Buffer.from(k.split('_').slice(3).join('_'),'base64url').toString())"
```

Then replace `https://*.clerk.accounts.dev` in the report-only policy with the
actual origin, sign in at https://ttcstatus.ca, confirm zero console violations,
and rename the header to `Content-Security-Policy`.

## Operational correctness

Sync cleanup releases only its own lease. Publication requires a complete artifact
belonging to the target network. Retention preserves the active network even when
newer imports failed, and a retention failure does not mark successful publication
as failed. These cases have SQLite-backed regression tests.

## Follow-up deployment work

Site-wide enforced CSP for the Clerk-backed application shell is staged as a
report-only policy: it requires the deployed Clerk origins to avoid breaking
legitimate usage. Application rate limits remain deployment follow-ups: the
first line of defense is the Cloudflare zone WAF (custom rules and one
rate-limiting rule are included in the Free plan). All traffic must reach the
Workers through the `ttcstatus.ca` zone for those rules to apply — the
`*.workers.dev` route bypasses zone security entirely, so production traffic
should use `api.ttcstatus.ca` (set `workers_dev` to `false` in
`workers/api/wrangler.jsonc` once the custom domain is confirmed live).

CI checks types, lint, formatting, regression tests, module boundaries, source
credentials, builds, Worker packaging, browser flows and component stories. The source scanner covers common
credential patterns and accidental environment-file tracking; it is not a full
historical secret audit. npm audit found no known vulnerabilities in the reviewed
lockfile.
