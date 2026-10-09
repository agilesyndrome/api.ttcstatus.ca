# Product analytics (Cloudflare Workers Analytics Engine)

The app reports broad, allowlisted user actions through Cloudflare's native
[Workers Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/).
No third-party scripts, no location data, no account identifiers.

## How it works

- The `ANALYTICS` binding (dataset `ttcstatus_metrics`) is declared in
  `workers/api/wrangler.jsonc`.
- `POST /api/v1/event` with `{"action": "..."}` (see
  `workers/api/src/diagnostics/analytics.ts`) writes one Analytics Engine data
  point. The server accepts only an exact allowlist of action names:
  `located`, `tracked-streetcar`, `played-snake`, `saved-stop`,
  `removed-stop`, `exported-map`.
- The first request sets a `ttc_aid` cookie: a random UUID that is **HttpOnly,
  SameSite=Lax, Secure**, carries no account or profile link, and exists only
  so "distinct users" can be counted per action. It never leaves Cloudflare and
  is never joined with anything that could identify a person or a location.
- The browser helper `web/ui/analytics.ts` (`trackEvent`) reports at most once
  per action per page load, from the interaction sites in the app (locate
  button, snake launch and `/snake` routes, journal "collect", save/remove
  stop, map export).

## Querying

Data points store the action in `blob1` and the anonymous visitor id in
`blob2`. "How many distinct users took each action today":

```sql
SELECT blob1 AS action, uniq(blob2) AS distinct_users, count() AS events
FROM ttcstatus_metrics
WHERE timestamp >= now() - INTERVAL '1' DAY
GROUP BY blob1
ORDER BY distinct_users DESC
```

Single action, distinct users over the last 7 days:

```sql
SELECT uniq(blob2) AS distinct_users
FROM ttcstatus_metrics
WHERE blob1 = 'played-snake' AND timestamp >= now() - INTERVAL '7' DAY
```

Run these from the [Analytics Engine SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/)
(or the GraphQL API) with an API token that has the Account > Analytics
Read permission.
