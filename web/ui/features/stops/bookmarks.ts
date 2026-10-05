import { english } from '../../../../shared/i18n/messages';
import { t } from '../../i18n';
import { validSavedStops } from '../../commute';

export const BOOKMARK_BACKUP_BYTES = 64_000;

export function bookmarkBackup(ids: string[], now = new Date()) {
  if (!validSavedStops(ids)) throw new Error(english('bookmarks.savedStopsAreInvalid'));
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
    throw new Error(english('bookmarkBackup.chooseASavedStopBackupSmallerThan64Kb'));
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error(english('bookmarks.thisFileIsNotValidJsonChooseASavedStop'));
  }
  if (!value || typeof value !== 'object')
    throw new Error(english('bookmarks.thisIsNotASavedStopBackup'));
  const backup = value as Record<string, unknown>;
  if (
    backup.format !== 'ttc-saved-stops' ||
    backup.version !== 1 ||
    !validSavedStops(backup.stopIds)
  )
    throw new Error(english('bookmarks.thisIsNotASupportedSavedStopBackupItMust'));
  return backup.stopIds;
}

export function mergeBookmarks(current: string[], incoming: string[]) {
  if (!validSavedStops(current) || !validSavedStops(incoming))
    throw new Error(english('bookmarks.savedStopsAreInvalid'));
  const ids = [...new Set([...current, ...incoming])];
  if (ids.length > 100)
    throw new Error(
      t('bookmarks.restoringWouldExceed100SavedStopsByValueRemoveSome', {
        value1: ids.length - 100,
      }),
    );
  return {
    ids,
    added: ids.length - current.length,
    existing: incoming.length - (ids.length - current.length),
  };
}
