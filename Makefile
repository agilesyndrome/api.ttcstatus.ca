.PHONY: admin/sync admin/sync/status map/streetcar map/streetcar/svg

admin/sync:
	op run --env-file=.env -- ./bin/api POST /v1/admin/sync

admin/sync/status:
	op run --env-file=.env -- ./bin/api GET /v1/feed/status | jq

map/streetcar:
	@op run --env-file=.env -- ./bin/api GET /v1/map/streetcar

map/streetcar/svg:
	@op run --env-file=.env -- sh -c 'curl -sS -X POST https://api.ttcstatus.ca/v1/debug/map/streetcar.svg \
		-H "Authorization: Bearer $$SYNC_TOKEN" \
		-H "Content-Type: application/json" \
		--data-binary @streetcarmap.json' > streetcar-debug.svg
