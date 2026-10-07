MAP_INPUT ?= $(if $(wildcard dist/streetcarmap.json),dist/streetcarmap.json,data/fixtures/streetcarmap.json)

.PHONY: dev dev/new admin/sync admin/sync/status map/streetcar

dev:
	@set -eu; \
		map_pid=; \
		cleanup() { \
			if [ -n "$$map_pid" ]; then \
				kill "$$map_pid" 2>/dev/null || true; \
				wait "$$map_pid" 2>/dev/null || true; \
			fi; \
		}; \
		trap cleanup EXIT HUP INT TERM; \
		npm run dev:map & map_pid=$$!; \
		op run --env-file=.env.local -- npm run dev:api

# Recreate local D1, fetch a fresh TTC GTFS ZIP, and generate the local map.
# This does not read production D1 or import production map artifacts.
dev/new:
	@npx wrangler d1 execute ttcstatus --local --file scripts/dev/drop-local.sql \
		-c workers/api/wrangler.jsonc --yes
	@npm run db:migrate:local
	@node scripts/dev/bootstrap-local.mjs


admin/sync:
	op run --env-file=.env.prod -- ./bin/api POST /api/v1/admin/sync

admin/sync/status:
	op run --env-file=.env.prod -- ./bin/api GET /api/v1/feed/status | jq

map/streetcar:
	@./bin/api GET /api/v1/map/streetcar --fail --show-error
