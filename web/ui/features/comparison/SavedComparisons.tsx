import { english } from '../../../../shared/i18n/messages';
import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
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
  useLanguage();
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
      setMessage(english('savedComparisons.comparisonSavedOpenItBelowWheneverYouNeedIt'));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : english('savedComparisons.unableToSaveThisComparison'),
      );
    }
  }
  return (
    <section
      className="saved-comparisons"
      aria-label={t('savedComparisons.savedComparisons')}
    >
      <div className="section-heading">
        <h2>{t('savedComparisons.myComparisons')}</h2>
        <small>{entries.length}/20</small>
      </div>
      <p className="helper">
        {t('savedComparisons.keepACommuteOrFavouritePairOfStopsReadyFor')}
      </p>
      <form
        className="tool-form"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div className="form-control">
          <label htmlFor={id}>{t('savedComparisons.comparisonNameOptional')}</label>
          <input
            id={id}
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('savedComparisons.eGMorningCommute')}
          />
        </div>
        <button
          className="action-button"
          disabled={!from || !to || from.id === to.id || saved || entries.length >= 20}
        >
          {saved
            ? t('savedComparisons.comparisonAlreadySaved')
            : entries.length >= 20
              ? t('savedComparisons.20ComparisonsSaved')
              : t('savedComparisons.saveThisComparison')}
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
                  {start?.name ?? t('savedComparisons.unavailableStart')} →{' '}
                  {end?.name ?? t('savedComparisons.unavailableDestination')}
                </small>
                <small>
                  {!start || !end
                    ? t('savedComparisons.aStopIsNoLongerInThisMap')
                    : entry.overnight
                      ? t('savedComparisons.includesOvernightConnections')
                      : t('savedComparisons.daytimeConnections')}
                </small>
              </button>
              <button
                className="remove-stop"
                aria-label={t('savedComparisons.removeComparisonValue', {
                  value1: entry.name,
                })}
                onClick={() => {
                  setEntries((current) =>
                    current.filter(
                      (item) => comparisonKey(item) !== comparisonKey(entry),
                    ),
                  );
                  setRemoved(entry);
                  setMessage(t('savedComparisons.removedValue', { value1: entry.name }));
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
          {t(message)}
        </p>
      )}
      {removed && (
        <button
          className="text-button"
          onClick={() => {
            try {
              setEntries(saveComparison(entries, removed));
              setRemoved(undefined);
              setMessage(english('savedComparisons.comparisonRestored'));
            } catch (error) {
              setMessage(
                error instanceof Error
                  ? error.message
                  : english('savedComparisons.unableToRestoreComparison'),
              );
            }
          }}
        >
          {t('savedComparisons.undoRemoval')}
        </button>
      )}
      <p className="microcopy">
        {persistent
          ? t('savedComparisons.savedInThisBrowser')
          : t('savedComparisons.browserStorageUnavailableSavedForThisVisit')}{' '}
        {t('savedComparisons.theseAreStopComparisonsServiceTimesAndTransfersAreNot')}
      </p>
    </section>
  );
}
