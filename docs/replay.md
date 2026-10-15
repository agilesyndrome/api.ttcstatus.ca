# Replay — the recorded-ticks TV

Replay re-experiences the recorder's tick archive: pick a window (the last
30 minutes, 2/6/24 hours, or a whole Toronto day) and watch the network as
it was, at 1–600× real time, with the frame's capture time on screen.

## Data source

The recorder publishes one immutable fleet tick document per 30-second tick
to the public live bucket (`live/t/{tick}/vehicles.json`; see
[Data.md](Data.md)). The R2 lifecycle expires `live/t/` objects
after 7 days, which is exactly replay's horizon. Replay reads the same
broadcast path the live map polls — **no new API surface exists for
replay**; the only shared addition is `fetchHistoricalTick`
(`shared/live/polling.ts`): one specific tick id, the same three-case
contract as the live poll (200 → parse, 404 → null gap, anything else →
throw), with browser HTTP caching left enabled so scrubbing replays from
cache.

The tick documents themselves stay world-readable by design (broadcast
data). Members-only is the _feature_:

- The Replay destination is `signedInOnly` in the nav — hidden while
  signed out (like Journal and Badges).
- The playback engine mounts only for a signed-in member
  (`useHomeWorkspace`), so a signed-out visitor never fetches a historical
  tick through the app.
- A deep-linked `#view=replay` panel renders the `AccountRequired`
  sign-in gate — the same treatment as the Status report.

## Playback engine (`useReplay.ts`)

A virtual playhead advances at the chosen speed through the resolved
window. Tick documents are prefetched just ahead of it (bounded look-ahead,
8 concurrent fetches, per-tick retry cooldown) and projected once each with
the same `projectSnapshot` pipeline as the live map. Missing ticks — outage
holes, the unpublished tail, retention-expired edges — are skipped
honestly: the glide spans to the next available frame (up to a sane limit,
beyond which the picture holds) and the missing count surfaces in the
panel. The engine owns no transport of its own and never touches the live
feed.

## The dreamy glide (`glideFleet`, replay.ts)

Between frame boundaries the fleet interpolates at 12 fps:

- Same-edge track matches lerp along their shared edge, so articulated
  bodies stay on the rail.
- A changed or absent match glides straight with the match dropped —
  honestly "between fixes" for one interval.
- Cars that left hold position, dimmed; cars that joined appear from the
  halfway point.
- Long gaps (long outages) hold the source frame instead of crawling the
  fleet across them.

## The screen

- The map stays mounted; replay swaps the projected cars and floats the
  frame clock (Toronto time, CCTV-style), the TV bar (play/pause, scrubber,
  speed chip) and the focused-route chip over it. Map taps stay inert for
  selection — replay is a screen, not the explorer.
- The rail panel is the remote: quick ranges (30 min, 2 h, 6 h, 24 h — no
  window ever spans more than a day), a Toronto-local day picker bounded to
  the retention window, speeds (1–600×), transport and the frame-time
  readout.
- A tapped car solos it and the camera follows it through time; its card
  (`ReplayCarCard`) lists the stops it made — consecutive ticks with a ~0
  reported speed (or fixes within ~20 m when speeds are absent) merged
  into dwells, each with the tick window it sat still and, when the feed
  supplies one, the stop name — "what time the stop was recorded".
- A tapped track focuses its route: other routes' cars hide and their
  rails dim. Panning hands the whole network back.

## Checks

- `tests/ui/replay.test.mjs` — window resolution, Toronto day bounds
  (DST-safe), the glide, dwell grouping and the historical-tick contract.
- `scripts/checks/check-replay.mjs` (via
  `node scripts/checks/run-browser-suite.mjs replay`) — the signed-out
  gate, ticks, glide, pause, seek, speed, car focus and route focus, end
  to end against synthesized tick documents.
