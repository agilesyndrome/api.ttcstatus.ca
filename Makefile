MAP_INPUT ?= $(if $(wildcard dist/streetcarmap.json),dist/streetcarmap.json,data/fixtures/streetcarmap.json)
API_PORT ?= 8787
GEN_PORT ?= 8788
API_LOCAL ?= http://localhost:$(API_PORT)

.PHONY: dev dev/new dev/bootstrap admin/sync admin/sync/status map/streetcar

# Dev/prod parity: both Workers run from their production wrangler configs in
# `wrangler dev` (the real Worker code in workerd; the MAP_GENERATOR service
# binding connects the two processes), local D1/R2 apply the same migrations,
# and dev/bootstrap provisions the map through the same POST /api/v1/admin/sync
# endpoint production operators use. Ports are pinned so 8787 is always the
# API Worker. --test-scheduled exposes /__scheduled for cron-path parity.
dev:
	@set -eu; \
		npm run --silent build:ui && npm run --silent build:viewer; \
		npm run --silent db:migrate:local; \
		op run --env-file=.env.local -- npx wrangler dev \
			-c workers/api/wrangler.jsonc --port $(API_PORT) --test-scheduled & api_pid=$$!; \
		op run --env-file=.env.local -- npx wrangler dev \
			-c workers/map-generator/wrangler.jsonc --port $(GEN_PORT) & gen_pid=$$!; \
		cleanup() { \
			kill $$api_pid $$gen_pid 2>/dev/null || true; \
			wait $$api_pid $$gen_pid 2>/dev/null || true; \
		}; \
		trap cleanup EXIT HUP INT TERM; \
		for i in $$(seq 1 90); do \
			[ "$$(curl -s --max-time 2 $(API_LOCAL)/api/healthz 2>/dev/null | jq -r .worker 2>/dev/null)" = ttcstatus-api ] && break; \
			sleep 1; \
		done; \
		$(MAKE) --no-print-directory dev/bootstrap || \
			echo "dev/bootstrap failed — the Workers are still running. Fix the source (see STATIC_GTFS_URL in .env.local) and re-run: make dev/bootstrap"; \
		wait $$api_pid $$gen_pid

# Provision the local network + map. Converged with production: when the GTFS
# source is a remote http(s) feed this is the exact production operator motion
# (bin/api POST /api/v1/admin/sync, pointed at localhost) running the real
# Worker pipeline. Only a file:// fixture source falls back to the Node
# platform-proxy harness, because workerd cannot fetch file:// URLs — the
# harness runs the same syncStaticGtfs/generateStreetcarMap module code.
dev/bootstrap:
	@set -eu; \
		if grep -qE '^STATIC_GTFS_URL=file:' .env.local; then \
			echo "file:// GTFS source: provisioning via the Node platform proxy (same pipeline modules; workerd cannot fetch file://)"; \
			op run --env-file=.env.local -- node scripts/dev/bootstrap-local.mjs; \
		else \
			echo "Provisioning via the production pipeline endpoint POST /api/v1/admin/sync against $(API_LOCAL):"; \
			op run --env-file=.env.local -- env API_HOST=$(API_LOCAL) ./bin/api POST /api/v1/admin/sync | jq .; \
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
