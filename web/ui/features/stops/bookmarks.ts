import { validSavedStops } from '../../commute';

export const BOOKMARK_BACKUP_BYTES = 64_000;

export function bookmarkBackup(ids: string[], now = new Date()) {
  if (!validSavedStops(ids)) throw new Error('Saved stops are invalid.');
  return JSON.stringify(
    {
      format: 'ttc-saved-stops',
      version: 1,
      exportedAt: now.toISOString(),
      stopIds: ids,
    },
    null,
    2,
  );
}

export function readBookmarkBackup(contents: string): string[] {
  if (new TextEncoder().encode(contents).length > BOOKMARK_BACKUP_BYTES)
    throw new Error('Choose a saved-stop backup smaller than 64 KB.');
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error('This file is not valid JSON. Choose a saved-stop backup.');
  }
  if (!value || typeof value !== 'object')
    throw new Error('This is not a saved-stop backup.');
  const backup = value as Record<string, unknown>;
  if (
    backup.format !== 'ttc-saved-stops' ||
    backup.version !== 1 ||
    !validSavedStops(backup.stopIds)
  )
    throw new Error(
      'This is not a supported saved-stop backup. It must contain up to 100 unique stop IDs.',
    );
  return backup.stopIds;
}

export function mergeBookmarks(current: string[], incoming: string[]) {
  if (!validSavedStops(current) || !validSavedStops(incoming))
    throw new Error('Saved stops are invalid.');
  const ids = [...new Set([...current, ...incoming])];
  if (ids.length > 100)
    throw new Error(
      `Restoring would exceed 100 saved stops by ${ids.length - 100}. Remove some saved stops and try again.`,
    );
  return {
    ids,
    added: ids.length - current.length,
    existing: incoming.length - (ids.length - current.length),
  };
}
