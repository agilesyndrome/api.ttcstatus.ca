import { DEFAULT_LIVE_UPDATE_SECONDS, liveUpdateSeconds } from "../../workers/shared/live-config";
import type { VehicleSnapshot } from "../../workers/shared/live-vehicles";

export interface SnapshotUpdate {
  snapshot?: VehicleSnapshot; // Missing on 304: the current observations still apply.
  etag?: string;
  updateSeconds: number;
  nextUpdateAt?: number;
}

export class LiveUpdateError extends Error {
  constructor(message: string, readonly updateSeconds?: number, readonly retryAfterSeconds?: number) { super(message); }
}

/** Browser HTTP cache is bypassed deliberately: the Worker owns snapshot age.
 * ETags avoid downloading the fleet again when the observations are unchanged. */
export async function requestVehicleUpdate(endpoint: string, signal: AbortSignal, etag?: string): Promise<SnapshotUpdate> {
  const response = await fetch(endpoint, { signal, cache: "no-store", headers: etag ? { "if-none-match": etag } : {} });
  const intervalHeader = response.headers.get("x-live-update-seconds");
  const updateSeconds = liveUpdateSeconds(intervalHeader);
  if (!response.ok && response.status !== 304) {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new LiveUpdateError(`Live status returned HTTP ${response.status}`, intervalHeader ? updateSeconds : undefined,
      retryAfter > 0 ? retryAfter : undefined);
  }
  const result: SnapshotUpdate = { updateSeconds, etag: response.headers.get("etag") ?? undefined,
    nextUpdateAt: Date.parse(response.headers.get("x-live-next-update-at") ?? "") };
  if (response.status === 304) {
    if (!etag) throw new Error("Live status returned 304 without a previous snapshot");
    return result;
  }
  const snapshot = await response.json() as VehicleSnapshot;
  if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.vehicles)) throw new Error("Invalid live snapshot");
  result.snapshot = snapshot;
  return result;
}

type TimerHandle = ReturnType<typeof setTimeout> | number;

interface PollerOptions {
  onSnapshot(snapshot: VehicleSnapshot): void;
  onStatus(status: { failed: boolean; updateSeconds: number; retrySeconds: number }): void;
  request(signal: AbortSignal, etag?: string): Promise<SnapshotUpdate>;
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
}

/** A cancellable, non-overlapping poll loop. Visibility, connectivity and the
 * layer checkbox are owned by the viewer; this module only schedules requests.
 * It retains ETags and backs off failures up to five minutes. No extrapolation
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
  private setTimer: NonNullable<PollerOptions["setTimer"]>;
  private clearTimer: NonNullable<PollerOptions["clearTimer"]>;

  constructor(private options: PollerOptions) {
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
    // Browser timer functions must be called as globals, not with this poller
    // as their receiver (native clearTimeout otherwise throws Illegal invocation).
    this.clearTimer = options.clearTimer ?? (timer => clearTimeout(timer));
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
    const timeout = this.setTimer(() => controller.abort(new Error("Live request timed out")), 15_000);
    this.running = this.options.request(controller.signal, this.etag).then(result => {
      if (controller.signal.aborted || this.disposed) return;
      this.updateSeconds = liveUpdateSeconds(result.updateSeconds);
      // Project before accepting its ETag; a failed projection must be retried.
      if (result.snapshot) this.options.onSnapshot(result.snapshot);
      this.etag = result.etag;
      this.failures = 0;
      const normalNext = this.now() + this.updateSeconds * 1000;
      this.nextUpdateAt = Number.isFinite(result.nextUpdateAt)
        ? Math.max(this.now() + 1000, Math.min(normalNext, result.nextUpdateAt!)) : normalNext;
      this.options.onStatus({ failed: false, updateSeconds: this.updateSeconds, retrySeconds: 0 });
    }).catch(error => {
      // User pauses abort silently. An actual timeout is a refresh failure.
      if (this.disposed || (controller.signal.aborted && controller.signal.reason?.name === "AbortError")) return;
      if (error instanceof LiveUpdateError && error.updateSeconds) this.updateSeconds = error.updateSeconds;
      this.failures++;
      const retrySeconds = Math.min(300, Math.max(this.updateSeconds * 2 ** Math.min(4, this.failures - 1),
        error instanceof LiveUpdateError ? error.retryAfterSeconds ?? 0 : 0));
      this.nextUpdateAt = this.now() + retrySeconds * 1000;
      this.options.onStatus({ failed: true, updateSeconds: this.updateSeconds, retrySeconds });
    }).finally(() => {
      this.clearTimer(timeout);
      this.controller = undefined; this.running = undefined;
      this.schedule();
    });
    return this.running;
  }

  dispose() {
    this.disposed = true; this.active = false; this.cancelTimer(); this.controller?.abort();
  }

  private cancelTimer() {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
  }

  private schedule() {
    if (!this.active || this.disposed || this.running) return;
    this.cancelTimer();
    this.timer = this.setTimer(() => { this.timer = undefined; void this.refreshOnce(); }, Math.max(0, this.nextUpdateAt - this.now()));
  }
}
