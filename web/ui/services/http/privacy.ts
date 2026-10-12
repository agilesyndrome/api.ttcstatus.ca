import { hasUnsupportedApiQuery } from '../../../../shared/http/api-queries';
import { validJournal } from '../../../../shared/accounts/journal';
import { validSavedStops } from '../../../../shared/accounts/saved-stops';
import { validUsername } from '../../../../shared/accounts/profile';

/** Catch accidental device geography before a request leaves the device. Public
 * GTFS geography in authenticated operator tools is outside this user-data seam. */
export function assertLocationFreeRequest(path: string, init: RequestInit) {
  const url = new URL(path, 'https://ttcstatus.invalid');
  if (hasUnsupportedApiQuery(url)) throw new TypeError('Unsupported API query parameter');
  const fields: Record<string, string[]> = {
    '/api/v1/me/stops': ['stopIds', 'revision'],
    '/api/v1/me/journal': ['entries', 'revision'],
    '/api/v1/me/profile': ['username', 'publicBadges'],
    '/api/v1/event': ['action'],
  };
  const allowed = fields[url.pathname];
  if (!allowed || init.body === undefined || init.body === null) return;
  if (typeof init.body !== 'string')
    throw new TypeError('User data requires a JSON body');
  const value: unknown = JSON.parse(init.body);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((field) => !allowed.includes(field))
  ) {
    throw new TypeError('Unsupported user-data field');
  }
  const body = value as Record<string, unknown>;
  if (
    (url.pathname.endsWith('/journal') && !validJournal(body.entries)) ||
    (url.pathname.endsWith('/stops') && !validSavedStops(body.stopIds)) ||
    (url.pathname.endsWith('/profile') &&
      (!validUsername(body.username) || typeof body.publicBadges !== 'boolean')) ||
    (url.pathname === '/api/v1/event' && typeof body.action !== 'string')
  ) {
    throw new TypeError('Invalid user data');
  }
}
