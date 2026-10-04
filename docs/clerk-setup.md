# Clerk accounts on TTCstatus

The React/Vite frontend uses `@clerk/react`; the Cloudflare API Worker verifies
Clerk session bearer tokens with `@clerk/backend`. There is no Next.js middleware.
The map, live fleet, stop tools, and transit APIs stay public. Journal and profile
settings require an account. Public badge profiles are opt-in.

## Production configuration

Use the **production instance** of Clerk application
`app_3KEDoBsmoral5eBK5fJ1sE5OziW`, configured for **https://ttcstatus.ca**.
Complete Clerk's production domain/DNS setup and enable the sign-up methods you
want in the Clerk Dashboard. Use keys from the same instance.

Set these two bindings on the **ttcstatus-api** Worker:

```sh
npx wrangler secret put CLERK_PUBLISHABLE_KEY -c workers/api/wrangler.jsonc
npx wrangler secret put CLERK_SECRET_KEY -c workers/api/wrangler.jsonc
```

`CLERK_PUBLISHABLE_KEY` (`pk_live_…`) is intentionally public. The browser fetches
it at runtime from `/api/v1/auth/config`; it can be stored as a Cloudflare secret
for configuration convenience. No `VITE_` key or frontend rebuild is required
when rotating it. `CLERK_SECRET_KEY` (`sk_live_…`) remains in the Worker and is
never returned to the browser. No webhook secret is needed in this phase.

`CLERK_AUTHORIZED_PARTIES` is a non-secret Worker variable already set to
`https://ttcstatus.ca`. For a separate staging deployment, explicitly list its
trusted frontend origins, separated by commas. Do not add untrusted origins.

Apply the migration and build before deploying:

```sh
npm run db:migrate:remote
npm run build:api
npm run deploy:api
```

These instructions do not deploy or modify production by themselves. The map
continues to work when Clerk keys are missing, with an “Accounts unavailable”
indicator and a locked Journal. **Retry accounts** reloads runtime configuration
after a configuration fix or temporary request failure.

If accounts are unavailable after publishing, check the deployed runtime, rather
than only the Cloudflare build environment:

```sh
curl https://ttcstatus.ca/api/v1/auth/config
npx wrangler secret list -c workers/api/wrangler.jsonc
npx wrangler d1 migrations list ttcstatus --remote -c workers/api/wrangler.jsonc
```

The config endpoint must return `enabled: true` and the production publishable
key. Both Clerk keys must be **runtime bindings on ttcstatus-api**. Build variables
alone do not become Worker bindings. `0002_accounts.sql` must also be applied;
adding keys does not create the account tables.

## Clerk CLI

SDK integration is already implemented. CLI login needs a human browser session;
it was not completed in the agent environment. To link CLI management locally:

```sh
npx clerk auth login
npx clerk link --app app_3KEDoBsmoral5eBK5fJ1sE5OziW
npx clerk doctor
```

If setting up a fresh checkout with the scaffolder, always use
`npx clerk init --app app_3KEDoBsmoral5eBK5fJ1sE5OziW` after login. Review its changes
before accepting generated provider/env setup: this project's existing integration
loads keys from Worker bindings rather than Vite build-time variables. Doctor's
generic `.env`/`VITE_CLERK_PUBLISHABLE_KEY` warning does not reflect that runtime
configuration and should not be resolved by putting a secret into a `VITE_` variable.

## Local development

The credential-free `npm run dev:viewer` preview keeps the map public and accounts
disabled. To exercise real authentication and D1, create
`workers/api/.dev.vars` locally (gitignored), containing development keys and the
local frontend origin:

```dotenv
CLERK_PUBLISHABLE_KEY=pk_test_REPLACE_ME
CLERK_SECRET_KEY=sk_test_REPLACE_ME
CLERK_AUTHORIZED_PARTIES=http://localhost:8787,http://127.0.0.1:8787
```

Then run `npm run db:migrate:local` and `npm run dev:api`. The local Worker needs
an imported map to show the transit map; `/profile` and `/u/<username>` can be
opened directly without one. Use the local port Wrangler reports and adjust the
authorized origins to match if it selects another port. Never commit keys.

## Account data and privacy

- `/api/v1/me/profile` and `/api/v1/me/journal` accept only verified Clerk session
  bearer tokens. The Worker derives ownership from the token's user ID.
- Journals persist in D1 per Clerk user ID, with a revision check preventing
  silent overwrites across tabs/devices. GPS coordinates are not stored.
- The pre-auth browser journal stays untouched. Signed-in users can explicitly
  import it using **Import earlier browser journal**, or restore a JSON backup.
  It is never automatically assigned to an account on a shared device.
- `/profile` lets a user reserve a lowercase username and enable public badges.
  Usernames belong to TTCstatus application data, independently of Clerk's login
  identifiers. Clerk continues to manage email, passwords and other account data
  through the user menu.
- `/u/<username>#badges` is viewable without signing in only after opt-in. Private
  and nonexistent profiles both return the same 404 API response. Public responses
  contain only the username and earned badge descriptions, never journal entries,
  notes, dates, email or Clerk user ID. Responses use `Cache-Control: no-store`, so
  future requests reflect privacy changes immediately. Already viewed information
  cannot be recalled from a visitor's browser or copies they saved.
- Badges represent a manually saved collection, not independently verified rides.
- Account deletion is managed by Clerk. D1 cleanup on Clerk user deletion is a
  future webhook task; this phase does not configure webhooks or offer deletion
  controls in the application. Data retention should be addressed before enabling
  account deletion in Clerk's account UI.

## First-account check

After configuring and deploying, open `https://ttcstatus.ca` signed out and confirm
the map works. Sign up from the header and confirm the user icon appears. Add a
streetcar to Journal, edit a note, and reload. Open Profile, choose a username,
and confirm the public URL is unavailable until sharing is enabled. Enable
sharing, visit the URL in a signed-out browser, then disable it and reload that
browser to confirm the profile disappears. Sign in with another account and
verify its Journal is separate. A real sign-up/sign-in test still needs your
configured Clerk instance and keys.

References: [Clerk React quickstart](https://clerk.com/docs/react/getting-started/quickstart),
[Clerk request verification](https://clerk.com/docs/reference/backend/authenticate-request),
[Clerk CLI](https://clerk.com/docs/cli).

## Automated verification

`npm test` includes real RSA-signed session-token verification against a fixture
JWKS and real SQLite tests for the account migration, isolation, revisions and
privacy. `npm run test:auth` and `npm run test:collection` run against the Vite
preview using an isolated Clerk SDK/session fixture. They test application flows
without creating real users or replacing live Clerk configuration. These fixtures
are loaded only by Playwright and are never included in the production app.
