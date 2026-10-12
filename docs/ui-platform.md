# UI platform boundaries

The desktop website, Mobile Safari, and a future Capacitor app use the same React
features. Device APIs, network transport, navigation, and storage are separate
services. The API Worker and its wire contracts are unchanged by this UI work.

## Ownership

| Boundary                         | Owns                                                                      | Does not own                             |
| -------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------- |
| `services/platform/contracts.ts` | Device capability interfaces                                              | Transit or account rules                 |
| `services/platform/browser/`     | Browser GPS, preferences, IndexedDB, sharing, visibility                  | Native plugins                           |
| `services/platform/capacitor/`   | Native GPS, notifications, preferences, private files, sharing, lifecycle | React components                         |
| `services/http/`                 | API origins, bearer injection, timeout, cancellation                      | Sign-in widgets or response presentation |
| `services/navigation/`           | Internal destinations, history, link interception, device launch URLs     | Map selection calculations               |
| `services/cache/`                | Validated snapshots and ordered cache writes/deletion                     | Authentication or queued account edits   |
| `features/accounts/`             | Session driver, owned documents, revision writes                          | Raw device storage or direct fetch       |
| `features/map/workspace/`        | Selection, location state, saved stops, map-link synchronization          | Plugin or HTTP implementation            |
| `shared/transit/`                | Transit types, filters, proximity, links                                  | Translation, React, browser state        |

Run `npm run check:boundaries` to enforce application and service import direction.
It also rejects native plugin imports outside the platform service, direct feature
`fetch` calls, and direct feature `localStorage` access.

## Web and native builds

Normal web builds use same-origin `/api/` requests. Shared links always point to
the public website, even when generated inside a locally bundled app.

A future Capacitor shell should set the public build configuration explicitly:

```sh
# Build-time public origins; these variables never contain account credentials.
VITE_API_ORIGIN=https://ttcstatus.ca VITE_SITE_ORIGIN=https://ttcstatus.ca npm run build:ui
```

Point Capacitor's `webDir` at `dist`. Platform initialization detects a native
runtime and loads the native adapters before React mounts; browsers use the
browser adapters. Each native capability lives in its own small file.

The iOS project still needs normal Xcode capability/permission configuration,
including location usage descriptions. This change prepares the shared UI; it
does not create or provision an iOS project. Native foreground location is
supported. Background location/geofencing needs an additional implementation
behind the location port; a WebView timer is not a background service.

The notification port schedules and cancels local reminders and forwards taps to
the same internal route handler as shared links. Browser local scheduling is
explicitly unavailable. Push delivery and alert subscriptions remain future API
work. No permission is requested automatically on launch.

`AccountProvider` accepts an `adapter` implementing the exported `Account` port.
A native session driver can provide sign-in, sign-out, account management, and a
request client made with `createApiClient({ token, credentials: 'omit' })`.
The browser driver continues to use Clerk. Account data is only exposed after
the current session driver supplies a loaded user identity.

The existing API's account CORS and mobile token configuration still require the
separate API work identified in the review. No client bypass was introduced.

## Navigation and responsive presentation

Internal navigation uses history without reloading the document. The map screen
remains mounted across Settings/Profile/Status visits. Its state and camera
survive, while acquisition stops whenever its screen is inactive. Browser Back,
Forward, public map hashes, native launch URLs, and notification destinations all
enter through the same navigation service. External links, downloads, modified
clicks, and the archived Snake v1 route retain ordinary browser behavior.

Desktop retains its navigation rail. Phones have a full navigation menu and a
separate, non-modal details card that leaves the map interactive. Both reuse the
same selection renderer. Safe areas, touch target sizes, and visual viewport
height account for the iPhone keyboard without replacing desktop behavior.

## Offline data and freshness

Static maps are stored by API origin and exact artifact request, including pinned
tags. Cached geometry renders first and is revalidated with its ETag. A failed
refresh keeps the last usable geometry with a visible saved-time notice.
Revalidation of an unchanged artifact retains the in-memory map identity.

Production browser builds precache the public app shell and hashed build assets
through a generated service worker. The worker never intercepts API requests or
caches account responses. New shell versions wait for existing tabs to close.
Capacitor uses its installed bundle instead of registering this worker.

Stops and journals have separate caches keyed by API origin, resource, and user
identity. Cached account data is read-only until a successful refresh establishes
the current server revision. Reconnect refreshes it. Failed edits retain their
existing retry behavior; this UI does not queue offline writes or change the
server's conflict protocol. Account changes and sign-out remove private caches,
with deletion ordered after any pending save. Authentication tokens and user GPS
positions are never written into these caches.

Live observations retain their existing timestamp/staleness treatment. A cached
map is static geometry, not a claim that live service is current.

## Validation

```sh
# All scripts use fixture transit data; no repetitive upstream acquisition.
npm run typecheck
npm run check:boundaries
npm run test:app
npm run build:api
npm run test:browser
```

`test:browser` owns a local preview server and runs the desktop, phone, account,
language, retained-navigation, and built offline-shell checks. Set
`CHROMIUM_PATH` when using an externally installed compatible Chromium binary.
Real Mobile Safari and iOS plugin/device validation remain part of the future
native-shell integration.
