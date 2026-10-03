/** One runtime setting controls both upstream caching and browser refreshes.
 * Set REALTIME_UPDATE_SECONDS in Wrangler (or the local preview environment). */
export const DEFAULT_LIVE_UPDATE_SECONDS = 30;
export const MIN_LIVE_UPDATE_SECONDS = 30;
export const MAX_LIVE_UPDATE_SECONDS = 300;

export function liveUpdateSeconds(value?: string | number | null): number {
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= MIN_LIVE_UPDATE_SECONDS && seconds <= MAX_LIVE_UPDATE_SECONDS
    ? seconds : DEFAULT_LIVE_UPDATE_SECONDS;
}
