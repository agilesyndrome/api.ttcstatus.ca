MAP_INPUT ?= $(if $(wildcard dist/streetcarmap.json),dist/streetcarmap.json,data/fixtures/streetcarmap.json)
API_PORT ?= 8787
API_LOCAL ?= http://localhost:$(API_PORT)

.PHONY: dev dev/stop dev/status dev/new dev/bootstrap admin/sync admin/sync/status map/streetcar

# Dev/prod parity: the Worker runs from its production wrangler config in
# `wrangler dev` (the real Worker code in workerd; map generation runs
# in-process since Epic 7 — docs/optimize-transport.md — so there is no
# second Worker), local D1/R2 apply the same migrations,
# and dev/bootstrap provisions the map through the same POST /api/v1/admin/sync
# endpoint production operators use. Ports are pinned so 8787 is always the
# API Worker. --test-scheduled exposes /__scheduled for cron-path parity.
#
# scripts/dev/dev-stack.mjs supervises the whole tree: every Worker runs in
# its own process group, the stack records itself in .wrangler/dev-stack.json,
# and every descendant is tagged (TTC_DEV_STACK_ID) — so `make dev` always
# stops a previous stack first, `make dev/stop` kills every process no matter
# how deeply it spawned, and even a SIGKILLed supervisor leaves a lock file
# that the next run uses to clean up. `.env.local` secrets resolve through
# scripts/dev/with-secrets.mjs (1Password when signed in; a warning + accounts
# disabled otherwise), and dev:headers widens dist/_headers' CSP for Clerk's
# *.clerk.accounts.dev dev instance.
dev:
	@node scripts/dev/dev-stack.mjs start $(API_PORT)

dev/stop:
	@node scripts/dev/dev-stack.mjs stop

dev/status:
	@node scripts/dev/dev-stack.mjs status

# Provision the local network + map. Converged with production: when the GTFS
# source is a remote http(s) feed this is the exact production operator motion
# (bin/api POST /api/v1/admin/sync, pointed at localhost) running the real
# Worker pipeline. Only a file:// fixture source falls back to the Node
# platform-proxy harness, because workerd cannot fetch file:// URLs — the
# harness runs the same syncStaticGtfs/generateStreetcarMap module code.
# Both paths run through with-secrets so the SYNC_TOKEN reaches bin/api the
# same way the Worker got it (1Password-resolved, or the literal value).
dev/bootstrap:
	@set -eu; \
		if grep -qE '^STATIC_GTFS_URL=file:' .env.local; then \
			echo "file:// GTFS source: provisioning via the Node platform proxy (same pipeline modules; workerd cannot fetch file://)"; \
			node scripts/dev/with-secrets.mjs node scripts/dev/bootstrap-local.mjs; \
		else \
			echo "Provisioning via the production pipeline endpoint POST /api/v1/admin/sync against $(API_LOCAL):"; \
			node scripts/dev/with-secrets.mjs env API_HOST=$(API_LOCAL) ./bin/api POST /api/v1/admin/sync | jq .; \
		fi

# Recreate local D1 from scratch (same migrations as production). `make dev`
# after this bootstraps the network and map through the real endpoint.
dev/new:
	@npx wrangler d1 execute ttcstatus --local --file scripts/dev/drop-local.sql \
		-c workers/api/wrangler.jsonc --yes
	@npm run db:migrate:local
	@echo "Local D1 recreated. Run 'make dev' — it provisions the network and map through the real admin/sync endpoint."

admin/sync:
	op run --env-file=.env.prod -- ./bin/api POST /api/v1/admin/sync

# Dev-stack convenience: `wrangler dev` does NOT fire crons on schedule
# (--test-scheduled only exposes the trigger endpoint), so the hourly SLA
# fold needs a manual nudge to refresh the today-so-far bars.
sla/fold:
	@curl -s '$(API_LOCAL)/__scheduled?cron=41+*+*+*+*' ; echo ""

admin/sync/status:
	op run --env-file=.env.prod -- ./bin/api GET /api/v1/feed/status | jq

map/streetcar:
	@./bin/api GET /api/v1/map/streetcar --fail --show-error
