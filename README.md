# ttcstatus.ca

Live TTC map and delivered-service analytics on Cloudflare Workers + D1 + R2:
streetcar + subway/LRT map (Lines 1, 2, 4, 5, 6), live fleet GPS, the
delivered-service overlay, a members-only Status panel and Replay, Streetcar
Snake, and a `lite` text-only status board. Sign-in (Clerk) gates journals,
saved stops, Status and Replay; the map and transit APIs stay public.

## Run it

Prerequisites: Node 22+, `npm install`. 1Password CLI optionally resolves
`.env.local` secrets (`op://…` references); without it, accounts stay
disabled and everything else works.

```sh
make dev            # full local stack: builds UI, migrates local D1/R2,
                    # boots the Worker (API :8787) + Vite viewer (:4173),
                    # provisions the map through the real admin/sync path
make dev/stop       # stop the whole stack (survives even a SIGKILLed run)
make dev/new        # drop + recreate local D1, then run make dev
make sla/fold       # nudge the hourly SLA fold (wrangler dev fires no crons)
```

Open `http://127.0.0.1:4173/`. `make dev` is idempotent — it always stops a
previous stack first. Nightly-cron path locally: `curl :8787/__scheduled?cron=41+*+*+*+*`.

Quality gate and deploy (break-glass; CI deploys on push after checks pass):

```sh
./pre-flight        # gitleaks, boundaries, types, lint, format, tests, builds
npm run deploy:api  # applies D1 migrations, then deploys (Workers Builds: npm run ci)
```

## Docs

| Doc                                                            | What it tells you                                           |
| -------------------------------------------------------------- | ----------------------------------------------------------- |
| [docs/architecture.md](docs/architecture.md)                   | How it's built: high level → medium level → file layout.    |
| [docs/Data.md](docs/Data.md)                                   | Data model (D1/R2/DO), the GTFS load path, per-app schemas. |
| [docs/privacy.md](docs/privacy.md)                             | Privacy rules and the controls that enforce them.           |
| [docs/map-admin.md](docs/map-admin.md)                         | Map error paths, operator messages, recovery steps.         |
| [docs/security.md](docs/security.md)                           | Credentials, input bounds, headers, secrets sync.           |
| [docs/clerk-setup.md](docs/clerk-setup.md)                     | Clerk bindings, migrations, activation.                     |
| [docs/analytics.md](docs/analytics.md)                         | First-party analytics events and the `ttc_aid` cookie.      |
| [docs/subway-map.md](docs/subway-map.md)                       | Subway/LRT feed semantics, local preview.                   |
| [docs/replay.md](docs/replay.md)                               | The recorded-ticks TV.                                      |
| [docs/ui-platform.md](docs/ui-platform.md)                     | UI platform boundaries (web/native).                        |
| [docs/ios-build.md](docs/ios-build.md)                         | Capacitor iPhone build steps (not yet built).               |
| [docs/snakettc-map-contract.md](docs/snakettc-map-contract.md) | Map bundle schema, field by field.                          |
| [docs/physical-loop-audit.md](docs/physical-loop-audit.md)     | Audited turnback loops behind the map overlays.             |
| [docs/snake-*.md](docs/snake-driving-review.md)                | Snake driving/intersection/playability contracts.           |
| [docs/api/mobile-privacy.md](docs/api/mobile-privacy.md)       | Privacy-focused API client contract.                        |
| [docs/bugs/](docs/bugs/)                                       | Known bug investigations.                                   |
| [CODEMAP.md](CODEMAP.md)                                       | File-by-file code walkthrough.                              |
| [docs/lite-bbs-proposal.md](docs/lite-bbs-proposal.md)         | lite BBS design (work in flight).                           |

## Architecture in one breath

One Cloudflare Worker (`workers/api`) serves the React app, the public API,
the admin/debug endpoints, and the lite board; the map generator lives
in-process (`workers/api/src/mapgen/`). A nightly cron checks the TTC
Complete GTFS source, streams changed ZIPs into R2, imports a versioned
snapshot into D1, regenerates the schematic map, and publishes immutable,
chunked artifacts (`streetcar` / `snake` / `ttcstatus` names, tag- and
active-resolved). The `ServiceRecorder` Durable Object samples both live
feeds every 30 s and publishes broadcast tick documents to the public live
bucket (`live.ttcstatus.ca`, 7-day retention) — browsers join the shared
tick grid from the CDN; no per-user requests, no fallback route, device
location never leaves the device. Hourly, rollups fold into the SLA
tables. Details: [docs/architecture.md](docs/architecture.md).

Data citizenship: the importer is deliberately stingy with Toronto Open
Data (HEAD first, conditional GET, at most current + previous ZIP kept).
Attribution travels in every generated artifact: _Contains information
licensed under the Open Government Licence - Toronto_.
