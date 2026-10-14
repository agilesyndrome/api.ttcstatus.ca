import { platform } from '../../services/platform';
import type { Bounds } from '../../../../shared/map/model';
import { saveableView, type SavedView } from '../../../../shared/map/camera';

const STORE_KEY = 'ttc:default-view:v1';
/** The cookie this view rode in before the preference store. Read once for
 * migration, then deleted: cookies travel with every same-origin request, so
 * a camera framed by "locate me" used to leak device geography to the server
 * on each one. */
const LEGACY_COOKIE = 'ttc:default-view:v1';

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

/** A stored payload reconstitutes only when every camera field is a number;
 * anything else (a stale or hand-edited value) degrades to "no saved view". */
function parseView(value: unknown): DefaultMapView | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { cx, cy, width, tools } = value as Record<string, unknown>;
  if (typeof cx !== 'number' || typeof cy !== 'number' || typeof width !== 'number')
    return undefined;
  const parsedTools = parseTools(tools);
  return { view: { cx, cy, width }, ...(parsedTools && { tools: parsedTools }) };
}

function parseStored(raw: string | null | undefined): DefaultMapView | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    return parseView(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

/** The legacy cookie's payload, or null when the device never had one (or the
 * cookie jar is unreadable). An undecodable value still returns so the cookie
 * can be deleted; parsing rejects it later. */
function readLegacyCookie(): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const entry = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${LEGACY_COOKIE}=`));
    if (!entry) return null;
    const raw = entry.slice(LEGACY_COOKIE.length + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  } catch {
    return null;
  }
}

/** Expire the legacy cookie. Best effort: a document that refuses the write
 * keeps the cookie, but nothing here ever reads it again. */
function clearLegacyCookie(): void {
  if (typeof document === 'undefined') return;
  try {
    document.cookie = `${LEGACY_COOKIE}=; max-age=0; path=/; SameSite=Lax`;
  } catch {
    // Cookie writes can fail in restricted contexts; ignore.
  }
}

/** Fill a store miss from the legacy cookie exactly once per visit: the
 * payload migrates into the preference store and the cookie is expired, so
 * the saved camera never rides a request again. */
function withLegacyMigration(raw: string | null | undefined): string | null | undefined {
  if (typeof raw === 'string') return raw;
  const legacy = readLegacyCookie();
  if (legacy === null) return raw;
  clearLegacyCookie();
  // The browser adapter writes synchronously; native resolves later. Either
  // way the payload below is already in hand for this visit.
  void platform()
    .preferences.set(STORE_KEY, legacy)
    .catch(() => {
      // Blocked or unavailable storage: the view stays session-only.
    });
  return legacy;
}

/** The visitor's default map view, per device: the platform preference store,
 * read synchronously at map init — never the user profile and never a cookie,
 * so the saved camera stays on the device and cannot reach the server (and
 * different devices keep their own views). Browser devices answer from the
 * store itself; native stores warm asynchronously, so call sites also await
 * {@link hydrateDefaultView} and re-apply the answer — the same
 * peek-then-hydrate pattern as every other preference. */
export function readDefaultView(): DefaultMapView | undefined {
  try {
    return parseStored(withLegacyMigration(platform().preferences.peek(STORE_KEY)));
  } catch {
    return undefined;
  }
}

/** The authoritative read: native stores hydrate asynchronously, so map init
 * awaits this once and re-applies the answer when it differs from the peek. */
export async function hydrateDefaultView(): Promise<DefaultMapView | undefined> {
  try {
    return parseStored(withLegacyMigration(await platform().preferences.get(STORE_KEY)));
  } catch {
    return undefined;
  }
}

export function hasDefaultView(): boolean {
  return readDefaultView() !== undefined;
}

/** Persist the camera and the current tools as the device's default. A camera
 * that fails validation is refused (the stored view stays as it was). */
export function writeDefaultView(
  camera: Bounds,
  tools: DefaultViewTools | undefined,
  bounds: Bounds,
): void {
  const saved = saveableView(camera, bounds);
  if (!saved) return;
  void platform()
    .preferences.set(STORE_KEY, JSON.stringify({ ...saved, ...(tools && { tools }) }))
    .catch(() => {
      // Blocked or unavailable storage: the view stays session-only.
    });
}

/** Tool choices ride along with a saved default: rewriting them keeps the
 * saved camera exactly as it was. No saved default, nothing to update. */
export function writeDefaultViewTools(tools: DefaultViewTools): void {
  const current = readDefaultView();
  if (!current) return;
  void platform()
    .preferences.set(STORE_KEY, JSON.stringify({ ...current.view, tools }))
    .catch(() => {
      // Blocked or unavailable storage: the previous value stands.
    });
}

export function clearDefaultView(): void {
  void platform()
    .preferences.remove(STORE_KEY)
    .catch(() => {
      // Blocked or unavailable storage: nothing persisted to remove.
    });
}

/** Whether two saved views carry the same camera and tools — hydration uses
 * it to skip re-applying a view the synchronous peek already delivered. */
export function sameDefaultView(
  a: DefaultMapView | undefined,
  b: DefaultMapView | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.view.cx === b.view.cx &&
    a.view.cy === b.view.cy &&
    a.view.width === b.view.width &&
    a.tools?.streetcar === b.tools?.streetcar &&
    a.tools?.subway === b.tools?.subway &&
    a.tools?.live === b.tools?.live &&
    a.tools?.serviceOverlay === b.tools?.serviceOverlay
  );
}
