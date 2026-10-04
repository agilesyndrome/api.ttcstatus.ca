MAP_INPUT ?= $(if $(wildcard dist/streetcarmap.json),dist/streetcarmap.json,data/fixtures/streetcarmap.json)

.PHONY: dev admin/sync admin/sync/status map/streetcar map/streetcar/svg map/debug

dev:
	@npm run dev:viewer

admin/sync:
	op run --env-file=.env -- ./bin/api POST /api/v1/admin/sync

admin/sync/status:
	op run --env-file=.env -- ./bin/api GET /api/v1/feed/status | jq

map/streetcar:
	@./bin/api GET /api/v1/map/streetcar --fail --show-error

map/streetcar/svg:
	@npm run map:preview -- "$(MAP_INPUT)"

map/debug:
	@set -eu; \
		mkdir -p dist; \
		tmp=$$(mktemp ./dist/streetcarmap.json.XXXXXX); \
		trap 'rm -f "$$tmp"' EXIT HUP INT TERM; \
		./bin/api GET /api/v1/map/streetcar --fail --show-error --output "$$tmp"; \
		mv "$$tmp" dist/streetcarmap.json
	@$(MAKE) --no-print-directory map/streetcar/svg MAP_INPUT=dist/streetcarmap.json
	@node scripts/preview/open-map.mjs
