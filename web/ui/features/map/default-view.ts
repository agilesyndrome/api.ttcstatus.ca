import type { Bounds } from '../../../../shared/map/model';
import { saveableView, type SavedView } from '../../../../shared/map/camera';

const COOKIE = 'ttc:default-view:v1';
const ONE_YEAR = 60 * 60 * 24 * 365;
const ATTRIBUTES = `max-age=${ONE_YEAR}; path=/; SameSite=Lax`;

/** The Explore panel's two map tools ride inside a saved default: the rail
 * layers (streetcar/subway — the control always leaves one on) and the live
 * map mode (live + serviceOverlay: off / vehicles / service). */
export interface DefaultViewTools {
  streetcar: boolean;
  subway: boolean;
  live: boolean;
  serviceOverlay: boolean;
}

/** The device's default map opening: where the camera lands plus the tools
 * it opens with. */
export interface DefaultMapView {
  view: SavedView;
  tools?: DefaultViewTools;
}

/** Tools apply whole or not at all — a partial tool record is dropped rather
 * than half-applied over the visitor's stored layer preferences. */
function parseTools(value: unknown): DefaultViewTools | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { streetcar, subway, live, serviceOverlay } = value as Record<string, unknown>;
  if (
    typeof streetcar !== 'boolean' ||
    typeof subway !== 'boolean' ||
    typeof live !== 'boolean' ||
    typeof serviceOverlay !== 'boolean'
  )
    return undefined;
  return { streetcar, subway, live, serviceOverlay };
}

/** The visitor's default map view, per device: a plain browser cookie, read
 * synchronously at map init — never the user profile, so the map opens to the
 * saved view with no remote round-trip (and different devices keep their own
 * views). */
export function readDefaultView(): DefaultMapView | undefined {
  if (typeof document === 'undefined') return undefined;
  const entry = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`));
  if (!entry) return undefined;
  try {
    const value: unknown = JSON.parse(decodeURIComponent(entry.slice(COOKIE.length + 1)));
    if (!value || typeof value !== 'object') return undefined;
    const { cx, cy, width, tools } = value as Record<string, unknown>;
    if (typeof cx !== 'number' || typeof cy !== 'number' || typeof width !== 'number')
      return undefined;
    const parsedTools = parseTools(tools);
    return { view: { cx, cy, width }, ...(parsedTools && { tools: parsedTools }) };
  } catch {
    return undefined;
  }
}

export function hasDefaultView(): boolean {
  return readDefaultView() !== undefined;
}

/** Persist the camera and the current tools as the device's default. A camera
 * that fails validation is refused (the cookie stays as it was). */
export function writeDefaultView(
  camera: Bounds,
  tools: DefaultViewTools | undefined,
  bounds: Bounds,
): void {
  const saved = saveableView(camera, bounds);
  if (!saved) return;
  document.cookie = `${COOKIE}=${encodeURIComponent(
    JSON.stringify({ ...saved, ...(tools && { tools }) }),
  )}; ${ATTRIBUTES}`;
}

/** Tool choices ride along with a saved default: rewriting them keeps the
 * saved camera exactly as it was. No saved default, nothing to update. */
export function writeDefaultViewTools(tools: DefaultViewTools): void {
  const current = readDefaultView();
  if (!current) return;
  document.cookie = `${COOKIE}=${encodeURIComponent(
    JSON.stringify({ ...current.view, tools }),
  )}; ${ATTRIBUTES}`;
}

export function clearDefaultView(): void {
  document.cookie = `${COOKIE}=; max-age=0; path=/; SameSite=Lax`;
}
