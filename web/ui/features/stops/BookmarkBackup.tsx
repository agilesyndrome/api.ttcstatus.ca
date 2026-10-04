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
        throw new Error('Choose a saved-stop backup smaller than 64 KB.');
      const stops = readBookmarkBackup(await file.text());
      if (request.current === current) setIncoming(stops);
    } catch (error) {
      if (request.current === current)
        setMessage(
          error instanceof Error ? error.message : 'Unable to read this backup.',
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
        `${merged.added} saved ${merged.added === 1 ? 'stop' : 'stops'} restored. Your existing stops were kept.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to restore this backup.',
      );
    }
  }
  return (
    <details className="bookmark-backup">
      <summary>Back up or restore saved stops</summary>
      <p className="microcopy">
        Download a file to keep your bookmarks or move them to another browser. Restoring
        adds stops to your current list.
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
              setMessage('Saved-stop backup downloaded.');
            } catch {
              setMessage('Unable to download the backup in this browser.');
            }
          }}
        >
          Download saved stops
        </button>
        <button
          className="action-button"
          disabled={reading}
          onClick={() => input.current?.click()}
        >
          {reading ? 'Reading backup…' : 'Choose backup file'}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        aria-label="Saved-stop backup file"
        onChange={(event) => void read(event.target.files?.[0])}
      />
      {incoming && (
        <div className="tip" aria-labelledby={`${id}-preview`}>
          <strong id={`${id}-preview`}>Restore preview</strong>
          <p>
            {added} new stops · {incoming.length - added} already saved.
          </p>
          {unknown > 0 && (
            <p>
              {unknown} stops are no longer in this map. Their bookmarks will be kept so
              you can remove them or use a future map.
            </p>
          )}
          {ids.length + added > 100 && (
            <p>
              These stops would exceed the 100-stop limit. Remove some bookmarks first.
            </p>
          )}
          <div className="comparison-actions">
            <button
              className="action-button"
              disabled={!added || ids.length + added > 100}
              onClick={restore}
            >
              Add {added} saved {added === 1 ? 'stop' : 'stops'}
            </button>
            <button className="text-button" onClick={() => setIncoming(undefined)}>
              Cancel restore
            </button>
          </div>
        </div>
      )}
      {message && (
        <p role="status" className="helper">
          {message}
        </p>
      )}
    </details>
  );
}
