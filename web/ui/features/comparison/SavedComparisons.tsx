import { useId, useState } from 'react';
import type { ViewerData } from '../../../../shared/map/model';
import { usePreference } from '../../hooks/usePreferences';
import {
  comparisonKey,
  saveComparison,
  validSavedComparisons,
  type SavedComparison,
} from './saved-comparisons';

interface Props {
  data: ViewerData;
  fromId?: string;
  toId?: string;
  overnight: boolean;
  onChoose(entry: SavedComparison): void;
}

export function SavedComparisons({ data, fromId, toId, overnight, onChoose }: Props) {
  const id = useId();
  const [entries, setEntries, persistent] = usePreference<SavedComparison[]>(
    'ttc:comparisons:v1',
    [],
    validSavedComparisons,
  );
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [removed, setRemoved] = useState<SavedComparison>();
  const from = data.features.find(
    (feature) => feature.id === fromId && feature.boardingPoints > 0,
  );
  const to = data.features.find(
    (feature) => feature.id === toId && feature.boardingPoints > 0,
  );
  const saved = entries.some((entry) => entry.fromId === fromId && entry.toId === toId);
  function save() {
    if (!from || !to) return;
    try {
      const entry = {
        name: name.trim() || `${from.name} → ${to.name}`.slice(0, 60),
        fromId: from.id,
        toId: to.id,
        overnight,
      };
      setEntries(saveComparison(entries, entry));
      setName('');
      setMessage('Comparison saved. Open it below whenever you need it.');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to save this comparison.',
      );
    }
  }
  return (
    <section className="saved-comparisons" aria-label="Saved comparisons">
      <div className="section-heading">
        <h2>★ My comparisons</h2>
        <small>{entries.length}/20</small>
      </div>
      <p className="helper">
        Keep a commute or favourite pair of stops ready for next time.
      </p>
      <form
        className="tool-form"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div className="form-control">
          <label htmlFor={id}>Comparison name (optional)</label>
          <input
            id={id}
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Morning commute"
          />
        </div>
        <button
          className="action-button"
          disabled={!from || !to || from.id === to.id || saved || entries.length >= 20}
        >
          {saved
            ? 'Comparison already saved'
            : entries.length >= 20
              ? '20 comparisons saved'
              : 'Save this comparison'}
        </button>
      </form>
      <ul className="compact-list">
        {entries.map((entry) => {
          const start = data.features.find(
            (feature) => feature.id === entry.fromId && feature.boardingPoints > 0,
          );
          const end = data.features.find(
            (feature) => feature.id === entry.toId && feature.boardingPoints > 0,
          );
          return (
            <li key={comparisonKey(entry)}>
              <button
                className="list-choice"
                disabled={!start || !end}
                onClick={() => onChoose(entry)}
              >
                <strong>{entry.name}</strong>
                <small>
                  {start?.name ?? 'Unavailable start'} →{' '}
                  {end?.name ?? 'Unavailable destination'}
                </small>
                <small>
                  {!start || !end
                    ? 'A stop is no longer in this map.'
                    : entry.overnight
                      ? 'Includes overnight connections'
                      : 'Daytime connections'}
                </small>
              </button>
              <button
                className="remove-stop"
                aria-label={`Remove comparison ${entry.name}`}
                onClick={() => {
                  setEntries((current) =>
                    current.filter(
                      (item) => comparisonKey(item) !== comparisonKey(entry),
                    ),
                  );
                  setRemoved(entry);
                  setMessage(`Removed ${entry.name}.`);
                }}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
      {message && (
        <p className="helper" role="status">
          {message}
        </p>
      )}
      {removed && (
        <button
          className="text-button"
          onClick={() => {
            try {
              setEntries(saveComparison(entries, removed));
              setRemoved(undefined);
              setMessage('Comparison restored.');
            } catch (error) {
              setMessage(
                error instanceof Error ? error.message : 'Unable to restore comparison.',
              );
            }
          }}
        >
          Undo removal
        </button>
      )}
      <p className="microcopy">
        {persistent
          ? 'Saved in this browser.'
          : 'Browser storage unavailable; saved for this visit.'}{' '}
        These are stop comparisons; service times and transfers are not included.
      </p>
    </section>
  );
}
