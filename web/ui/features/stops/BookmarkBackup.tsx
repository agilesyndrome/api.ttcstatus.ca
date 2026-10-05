import { english } from '../../../../shared/i18n/messages';
import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ViewerData } from '../../../../shared/map/model';
import { downloadFile } from '../export/download';
import {
  BOOKMARK_BACKUP_BYTES,
  bookmarkBackup,
  mergeBookmarks,
  readBookmarkBackup,
} from './bookmarks';

interface Props {
  data: ViewerData;
  ids: string[];
  onRestore(ids: string[]): void;
}

export function BookmarkBackup({ data, ids, onRestore }: Props) {
  useLanguage();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const [incoming, setIncoming] = useState<string[]>();
  const [message, setMessage] = useState('');
  const [reading, setReading] = useState(false);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const added = incoming?.filter((id) => !ids.includes(id)).length ?? 0;
  const unknown =
    incoming?.filter((id) => !data.features.some((feature) => feature.id === id))
      .length ?? 0;
  async function read(file?: File) {
    if (!file) return;
    const current = ++request.current;
    setReading(true);
    setIncoming(undefined);
    setMessage('');
    try {
      if (file.size > BOOKMARK_BACKUP_BYTES)
        throw new Error(english('bookmarkBackup.chooseASavedStopBackupSmallerThan64Kb'));
      const stops = readBookmarkBackup(await file.text());
      if (request.current === current) setIncoming(stops);
    } catch (error) {
      if (request.current === current)
        setMessage(
          error instanceof Error
            ? error.message
            : english('bookmarkBackup.unableToReadThisBackup'),
        );
    } finally {
      if (request.current === current) {
        setReading(false);
        if (input.current) input.current.value = '';
      }
    }
  }
  function restore() {
    if (!incoming) return;
    try {
      const merged = mergeBookmarks(ids, incoming);
      onRestore(merged.ids);
      setIncoming(undefined);
      setMessage(
        t('bookmarkBackup.valueSavedValueRestoredYourExistingStopsWereKept', {
          value1: merged.added,
          value2: merged.added === 1 ? 'stop' : 'stops',
        }),
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : english('bookmarkBackup.unableToRestoreThisBackup'),
      );
    }
  }
  return (
    <details className="bookmark-backup">
      <summary>{t('bookmarkBackup.backUpOrRestoreSavedStops')}</summary>
      <p className="microcopy">
        {t('bookmarkBackup.downloadAFileToKeepYourBookmarksOrMoveThem')}
      </p>
      <div className="comparison-actions">
        <button
          className="action-button"
          disabled={!ids.length}
          onClick={() => {
            try {
              downloadFile(
                bookmarkBackup(ids),
                'ttc-saved-stops.json',
                'application/json',
              );
              setMessage(english('bookmarkBackup.savedStopBackupDownloaded'));
            } catch {
              setMessage(
                english('bookmarkBackup.unableToDownloadTheBackupInThisBrowser'),
              );
            }
          }}
        >
          {t('bookmarkBackup.downloadSavedStops')}
        </button>
        <button
          className="action-button"
          disabled={reading}
          onClick={() => input.current?.click()}
        >
          {reading
            ? t('bookmarkBackup.readingBackup')
            : t('bookmarkBackup.chooseBackupFile')}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        aria-label={t('bookmarkBackup.savedStopBackupFile')}
        onChange={(event) => void read(event.target.files?.[0])}
      />
      {incoming && (
        <div className="tip" aria-labelledby={`${id}-preview`}>
          <strong id={`${id}-preview`}>{t('bookmarkBackup.restorePreview')}</strong>
          <p>
            {added} {t('bookmarkBackup.newStops')} {incoming.length - added}{' '}
            {t('bookmarkBackup.alreadySaved')}
          </p>
          {unknown > 0 && (
            <p>
              {unknown} {t('bookmarkBackup.stopsAreNoLongerInThisMapTheirBookmarksWill')}
            </p>
          )}
          {ids.length + added > 100 && (
            <p>{t('bookmarkBackup.theseStopsWouldExceedThe100StopLimitRemoveSome')}</p>
          )}
          <div className="comparison-actions">
            <button
              className="action-button"
              disabled={!added || ids.length + added > 100}
              onClick={restore}
            >
              {t('bookmarkBackup.add')} {added} {t('bookmarkBackup.saved')}{' '}
              {added === 1 ? t('commute.stop') : t('commute.stops')}
            </button>
            <button className="text-button" onClick={() => setIncoming(undefined)}>
              {t('bookmarkBackup.cancelRestore')}
            </button>
          </div>
        </div>
      )}
      {message && (
        <p role="status" className="helper">
          {t(message)}
        </p>
      )}
    </details>
  );
}
