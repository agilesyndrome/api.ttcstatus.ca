import type { Bounds } from '../../../../shared/map/model';
import { saveableView, type SavedView } from '../../../../shared/map/camera';

const COOKIE = 'ttc:default-view:v1';
const ONE_YEAR = 60 * 60 * 24 * 365;
const ATTRIBUTES = `max-age=${ONE_YEAR}; path=/; SameSite=Lax`;

/** The visitor's default map view, per device: a plain browser cookie, read
 * synchronously at map init — never the user profile, so the map opens to the
 * saved view with no remote round-trip (and different devices keep their own
 * views). */

export function readDefaultView(): SavedView | undefined {
  if (typeof document === 'undefined') return undefined;
  const entry = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`));
  if (!entry) return undefined;
  try {
    const value: unknown = JSON.parse(decodeURIComponent(entry.slice(COOKIE.length + 1)));
    if (!value || typeof value !== 'object') return undefined;
    const { cx, cy, width } = value as Record<string, unknown>;
    if (typeof cx !== 'number' || typeof cy !== 'number' || typeof width !== 'number')
      return undefined;
    return { cx, cy, width };
  } catch {
    return undefined;
  }
}

export function hasDefaultView(): boolean {
  return readDefaultView() !== undefined;
}

/** Persist the camera as the device's default view. A camera that fails
 * validation is refused (the cookie stays as it was). */
export function writeDefaultView(camera: Bounds, bounds: Bounds): void {
  const saved = saveableView(camera, bounds);
  if (!saved) return;
  document.cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify(saved))}; ${ATTRIBUTES}`;
}

export function clearDefaultView(): void {
  document.cookie = `${COOKIE}=; max-age=0; path=/; SameSite=Lax`;
}
