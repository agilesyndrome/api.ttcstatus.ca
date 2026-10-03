.PHONY: admin/sync map/streetcar

admin/sync:
	op run --env-file=.env -- ./bin/api POST /v1/admin/sync

map/streetcar:
	op run --env-file=.env -- ./bin/api GET /v1/map/streetcar
