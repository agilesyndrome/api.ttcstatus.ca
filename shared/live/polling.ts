import { DEFAULT_LIVE_UPDATE_SECONDS, liveUpdateSeconds } from './config';
import { liveTickPath, tickIdAt } from './config';
import type { LiveTransportConfig } from './config';
import type { VehicleSnapshot } from './vehicles';

export interface SnapshotUpdate {
  snapshot?: VehicleSnapshot; // Missing on 304: the current observations still apply.
  etag?: string;
  updateSeconds: number;
  /** The tick (and tick − 1) is not published yet — the device clock is
   * ahead of publish. Keep the last-good snapshot with its age; the next
   * scheduled poll handles it. Never a failure, never a fallback host. */
  unpublished?: boolean;
}

/** Fetch one immutable tick document from the public live path.
 *
 * TRANSPORT CONTRACT — see docs/optimize-transport.md before changing.
 * A native (Swift/Kotlin) rewrite implements exactly this:
 *  1. On launch: GET {apiOrigin}/api/v1/auth/config → { clerk, live }.
 *     Never bake live hosts into a binary; this fetch is the only origin source.
 *  2. Poll only while foreground/app-active: tick = floor(now / (live.updateSeconds * 1000));
 *     GET {live.base} + pathTemplate with {tick} substituted.
 *  3. 404 ⇒ tick unpublished (clock ahead of publish) ⇒ retry tick−1 once
 *     ⇒ else keep last-good + age and wait for the next scheduled poll.
 *  4. Network error ⇒ offline ⇒ keep last-good + age; existing backoff.
 *  5. Outage is a body field (`outage` + empty `vehicles`), never an HTTP status. No 5xx parsing exists.
 *  6. This path is broadcast-only: never attach device location, user IDs,
 *     or query parameters. Nearest stop is computed locally (shared/transit).
 *
 * Exactly three cases exist on the live host: 200 → use the document
 * (outage included), 404 → tick−1 → last-good, anything else (including
 * any 5xx) is a network failure that the caller's backoff already owns.
 * There is no fallback host and no dual error contract — the Worker vehicle
 * route is being removed, and with it the 503/Retry-After/x-live-* header
 * protocol this module used to parse. The cadence comes from config, never
 * from per-response headers. */
export async function requestTickUpdate(
  transport: LiveTransportConfig,
  signal: AbortSignal,
  etag?: string,
  request: (url: string, init?: RequestInit) => Promise<Response> = fetch,
  now: () => number = Date.now,
): Promise<SnapshotUpdate> {
  const url = liveTickUrl(transport, tickIdAt(now(), transport.updateSeconds));
  const response = await request(url, {
    signal,
    // Deliberate tick-following: each poll checks the freshly published tick;
    // edge cache hits are free, so browser HTTP caching buys nothing here.
    cache: 'no-store',
    headers: etag ? { 'if-none-match': etag } : {},
  });
  if (response.status === 304) {
    if (!etag) throw new Error('Live status returned 304 without a previous snapshot');
    // R2/native ETag: identical same-tick refetch (e.g. refresh on
    // visibility return) costs a 304 and no body.
    return { etag: response.headers.get('etag') ?? etag, updateSeconds: transport.updateSeconds };
  }
  if (response.status === 404) {
    // The clock is ahead of publish: retry the previous tick once, then let
    // the last-good snapshot stand until the next scheduled poll.
    const previous = await request(liveTickUrl(transport, tickIdAt(now(), transport.updateSeconds) - 1), {
      signal,
      cache: 'no-store',
    });
    if (previous.ok) return parseTickDocument(previous, transport);
    return { updateSeconds: transport.updateSeconds, unpublished: true };
  }
  if (!response.ok) throw new Error(`Live status returned HTTP ${response.status}`);
  return parseTickDocument(response, transport);
}

/** Build the tick object URL from config: base + path template. The URL is
 * derived, never stored, and never carries query parameters — broadcast
 * bytes identical for every user. */
export function liveTickUrl(transport: LiveTransportConfig, tickId: number): string {
  return `${transport.base}${liveTickPath(transport.pathTemplate, tickId)}`;
}

function parseTickDocument(
  response: Response,
  transport: LiveTransportConfig,
): Promise<SnapshotUpdate> {
  return response
    .json()
    .then((snapshot: VehicleSnapshot) => {
      if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.vehicles))
        throw new Error('Invalid live snapshot');
      // Outage is already inside the document (`vehicles: []` + `outage`),
      // so an outage doc is delivered like any other — never a status.
      const result: SnapshotUpdate = {
        snapshot,
        etag: response.headers.get('etag') ?? undefined,
        updateSeconds: transport.updateSeconds,
      };
      return result;
    });
}

type TimerHandle = ReturnType<typeof setTimeout> | number;

interface PollerOptions {
  onSnapshot(snapshot: VehicleSnapshot): void;
  onStatus(status: {
    failed: boolean;
    updateSeconds: number;
    retrySeconds: number;
  }): void;
  request(signal: AbortSignal, etag?: string): Promise<SnapshotUpdate>;
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
}

/** A cancellable, non-overlapping poll loop. Visibility, connectivity and the
 * layer checkbox are owned by the viewer; this module only schedules requests.
 * It retains ETags and backs off network failures up to five minutes. An
 * unpublished tick (404 → 404) is *not* a failure: the last-good snapshot
 * stands with its age and the next scheduled poll retries. No extrapolation
 * is used: markers move only when a new GPS snapshot arrives. */
export class VehiclePoller {
  private active = false;
  private disposed = false;
  private timer?: TimerHandle;
  private controller?: AbortController;
  private running?: Promise<void>;
  private etag?: string;
  private failures = 0;
  private updateSeconds = DEFAULT_LIVE_UPDATE_SECONDS;
  private nextUpdateAt = 0;
  private now: () => number;
  private setTimer: NonNullable<PollerOptions['setTimer']>;
  private clearTimer: NonNullable<PollerOptions['clearTimer']>;

  constructor(private options: PollerOptions) {
    this.now = options.now ?? Date.now;
    this.setTimer =
      options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
    // Browser timer functions must be called as globals, not with this poller
    // as their receiver (native clearTimeout otherwise throws Illegal invocation).
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  }

  setActive(active: boolean) {
    if (this.disposed || this.active === active) return;
    this.active = active;
    this.cancelTimer();
    if (active) this.schedule();
    else this.controller?.abort();
  }

  /** One startup snapshot is allowed even with the layer switched off. */
  refreshOnce(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.running) return this.running;
    this.cancelTimer();
    const controller = new AbortController();
    this.controller = controller;
    // Timer covers response parsing as well as receiving headers.
    const timeout = this.setTimer(
      () => controller.abort(new Error('Live request timed out')),
      15_000,
    );
    this.running = this.options
      .request(controller.signal, this.etag)
      .then((result) => {
        if (controller.signal.aborted || this.disposed) return;
        this.updateSeconds = liveUpdateSeconds(result.updateSeconds);
        // An unpublished tick keeps the last-good snapshot and its ETag —
        // the next scheduled poll retries the (newer) tick grid.
        if (result.unpublished) {
          this.nextUpdateAt = this.now() + this.updateSeconds * 1000;
          this.options.onStatus({
            failed: false,
            updateSeconds: this.updateSeconds,
            retrySeconds: 0,
          });
          return;
        }
        // Project before accepting its ETag; a failed projection must be retried.
        if (result.snapshot) this.options.onSnapshot(result.snapshot);
        this.etag = result.etag;
        this.failures = 0;
        this.nextUpdateAt = this.now() + this.updateSeconds * 1000;
        this.options.onStatus({
          failed: false,
          updateSeconds: this.updateSeconds,
          retrySeconds: 0,
        });
      })
      .catch((error) => {
        // User pauses abort silently. An actual timeout is a refresh failure.
        if (
          this.disposed ||
          (controller.signal.aborted && controller.signal.reason?.name === 'AbortError')
        )
          return;
        this.failures++;
        const retrySeconds = Math.min(300, this.updateSeconds * 2 ** Math.min(4, this.failures - 1));
        this.nextUpdateAt = this.now() + retrySeconds * 1000;
        this.options.onStatus({
          failed: true,
          updateSeconds: this.updateSeconds,
          retrySeconds,
        });
      })
      .finally(() => {
        this.clearTimer(timeout);
        this.controller = undefined;
        this.running = undefined;
        this.schedule();
      });
    return this.running;
  }

  dispose() {
    this.disposed = true;
    this.active = false;
    this.cancelTimer();
    this.controller?.abort();
  }

  private cancelTimer() {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
  }

  private schedule() {
    if (!this.active || this.disposed || this.running) return;
    this.cancelTimer();
    this.timer = this.setTimer(
      () => {
        this.timer = undefined;
        void this.refreshOnce();
      },
      Math.max(0, this.nextUpdateAt - this.now()),
    );
  }
}