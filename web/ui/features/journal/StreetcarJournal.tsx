import { english } from '../../../../shared/i18n/messages';
import { t, getLocale } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { useId, useMemo, useState } from 'react';
import type { PlottedVehicle } from '../../../../shared/map/live-status';
import type { Route } from '../../../../shared/map/model';
import {
  JOURNAL_LIMIT,
  journalEntry,
  type JournalEntry,
} from '../../../../shared/accounts/journal';
interface Props {
  entries: JournalEntry[];
  cars: PlottedVehicle[];
  routes: Route[];
  active: boolean;
  loaded?: boolean;
  failed?: boolean;
  onChange(update: (entries: JournalEntry[]) => JournalEntry[]): void | Promise<boolean>;
  onSelect(car: PlottedVehicle): void;
}
export function StreetcarJournal({
  entries,
  cars,
  routes,
  active,
  loaded = true,
  failed = false,
  onChange,
  onSelect,
}: Props) {
  useLanguage();
  const id = useId();
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<string>();
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<'seen' | 'ridden'>('seen');
  const [newCar, setNewCar] = useState('');
  const [newNote, setNewNote] = useState('');
  const [newStatus, setNewStatus] = useState<'seen' | 'ridden'>('seen');
  const [removing, setRemoving] = useState<string>();
  const [page, setPage] = useState(0);
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries
      .filter((entry) =>
        [entry.label, entry.vehicleId, entry.routeNumber, entry.routeName, entry.note]
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
      .sort(
        (a, b) =>
          b.recordedAt.localeCompare(a.recordedAt) ||
          a.vehicleId.localeCompare(b.vehicleId, undefined, { numeric: true }),
      );
  }, [entries, query]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(results.length / 10) - 1));
  return (
    <section className="streetcar-journal">
      <p className="eyebrow">{t('journal.yourRollingCollection')}</p>
      <h1>{t('journal.streetcarJournal')}</h1>
      <p className="helper">{t('journal.markCarsSeenOrRiddenAndKeepPrivateNotesAdd')}</p>
      <form
        className="tool-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const vehicleId = newCar.trim();
          if (!vehicleId) return;
          if (entries.some((entry) => entry.vehicleId === vehicleId)) {
            setMessage(english('journal.thisCarIsAlreadyInYourJournalEditItsEntry'));
            setQuery(vehicleId);
            return;
          }
          if (entries.length >= JOURNAL_LIMIT) {
            setMessage(english('journal.yourJournalIsFullRemoveACarBeforeAddingAnother'));
            return;
          }
          // Typing the number of a car currently in the feed keeps its route
          // with the entry, so collections from the journal tab still count
          // toward route badges the way collecting from the map used to.
          const live =
            active && loaded
              ? cars.find(
                  (car) =>
                    !car.stale &&
                    car.match &&
                    (car.vehicle.id === vehicleId || car.vehicle.label === vehicleId),
                )
              : undefined;
          const entry: JournalEntry = live
            ? { ...journalEntry(live, routes), status: newStatus, note: newNote }
            : {
                vehicleId,
                label: vehicleId,
                recordedAt: new Date().toISOString(),
                status: newStatus,
                note: newNote,
              };
          if ((await onChange((current) => [...current, entry])) === false) return;
          setNewCar('');
          setNewNote('');
          setQuery('');
          setMessage(t('journal.added', { car: vehicleId }));
        }}
      >
        <div className="form-control">
          <label htmlFor={id + '-car'}>{t('journal.streetcarNumber')}</label>
          <input
            id={id + '-car'}
            required
            maxLength={200}
            value={newCar}
            onChange={(event) => setNewCar(event.target.value)}
            placeholder="e.g. 4400"
          />
        </div>
        <div className="form-control">
          <label htmlFor={id + '-new-status'}>{t('journal.yourExperience')}</label>
          <select
            id={id + '-new-status'}
            value={newStatus}
            onChange={(event) => setNewStatus(event.target.value as 'seen' | 'ridden')}
          >
            <option value="seen">{t('journal.seen')}</option>
            <option value="ridden">{t('journal.ridden')}</option>
          </select>
        </div>
        <div className="form-control">
          <label htmlFor={id + '-new-note'}>{t('journal.privateNoteOptional')}</label>
          <textarea
            id={id + '-new-note'}
            maxLength={1000}
            rows={2}
            value={newNote}
            onChange={(event) => setNewNote(event.target.value)}
          />
        </div>
        <button className="action-button" type="submit">
          {t('journal.addCarToJournal')}
        </button>
      </form>
      <div className="journal-summary">
        <strong>{entries.length}</strong>
        <span>
          {entries.length === 1
            ? t('journal.uniqueStreetcar')
            : t('journal.uniqueStreetcars')}{' '}
          {t('journal.collected')}
        </span>
      </div>
      <p className="microcopy">
        {t('journal.savedPrivatelyToYourAccount')}
        {t('journal.upTo')} {JOURNAL_LIMIT}{' '}
        {t('journal.differentCarsNoGpsCoordinatesAreRecordedNotesAndDates')}
      </p>
      {message && (
        <p className="tip" role="status">
          {t(message)}
        </p>
      )}
      <div className="tool-form">
        <div className="form-control">
          <label htmlFor={id + '-search'}>{t('journal.searchYourJournal')}</label>
          <input
            id={id + '-search'}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder={t('journal.carRouteOrNote')}
          />
        </div>
      </div>
      <p className="fleet-count" role="status">
        {results.length}{' '}
        {results.length === 1 ? t('journal.collectedCar') : t('journal.collectedCars')}{' '}
        {t('journal.found')}
      </p>
      {!entries.length && (
        <p className="tip">
          {t('journal.yourFirstCatchIsWaitingChooseAStreetcarAndSelect')}
        </p>
      )}
      {Boolean(entries.length) && !results.length && (
        <p className="helper">{t('journal.noCollectedCarsMatchThatSearch')}</p>
      )}
      <div className="journal-entries">
        {results.slice(currentPage * 10, currentPage * 10 + 10).map((entry) => {
          const live =
            active && loaded
              ? cars.find((car) => car.vehicle.id === entry.vehicleId)
              : undefined;
          return (
            <article
              className="journal-entry"
              key={entry.vehicleId}
              aria-label={t('journal.collectedCar2') + entry.label}
            >
              <div className="section-heading">
                <h2>
                  {t('viewer.car')} {entry.label}
                </h2>
                <span className={'report-tag' + (!live || live.stale ? ' stale' : '')}>
                  {!active
                    ? t('journal.livePaused')
                    : !loaded
                      ? failed
                        ? t('journal.unavailable')
                        : t('journal.awaitingFeed')
                      : live
                        ? live.stale
                          ? t('journal.staleReport')
                          : t('journal.inLiveFeed')
                        : t('journal.notInSnapshot')}
                </span>
              </div>
              <p className="microcopy">
                {entry.routeNumber
                  ? entry.routeNumber + ' ' + entry.routeName
                  : t('header.routeNotSupplied')}{' '}
                · {entry.status === 'ridden' ? t('journal.ridden') : t('journal.seen')}{' '}
                {t('journal.saved')}{' '}
                {new Date(entry.recordedAt).toLocaleDateString(getLocale(), {
                  timeZone: 'America/Toronto',
                })}
              </p>
              {editing === entry.vehicleId ? (
                <form
                  className="tool-form"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const saved = await onChange((current) =>
                      current.map((item) =>
                        item.vehicleId === entry.vehicleId
                          ? { ...item, note, status }
                          : item,
                      ),
                    );
                    if (saved !== false) setEditing(undefined);
                  }}
                >
                  <div className="form-control">
                    <label htmlFor={id + '-status'}>{t('journal.yourExperience')}</label>
                    <select
                      id={id + '-status'}
                      value={status}
                      onChange={(event) =>
                        setStatus(event.target.value as 'seen' | 'ridden')
                      }
                    >
                      <option value="seen">{t('journal.seen')}</option>
                      <option value="ridden">{t('journal.ridden')}</option>
                    </select>
                  </div>
                  <div className="form-control">
                    <label htmlFor={id + '-note'}>
                      {t('journal.noteForCar')} {entry.label}
                    </label>
                    <textarea
                      id={id + '-note'}
                      autoFocus
                      maxLength={1000}
                      rows={3}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                    />
                  </div>
                  <div className="comparison-actions">
                    <button className="action-button" type="submit">
                      {t('journal.saveNote')}
                    </button>
                    <button
                      className="action-button"
                      type="button"
                      onClick={() => setEditing(undefined)}
                    >
                      {t('journal.cancelEditing')}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  {entry.note && <p className="journal-note">{entry.note}</p>}
                  <div className="comparison-actions">
                    {entry.status !== 'ridden' && (
                      <button
                        className="action-button"
                        onClick={() =>
                          onChange((current) =>
                            current.map((item) =>
                              item.vehicleId === entry.vehicleId
                                ? { ...item, status: 'ridden' }
                                : item,
                            ),
                          )
                        }
                      >
                        {t('journal.markRidden')}
                      </button>
                    )}
                    <button
                      className="action-button"
                      onClick={() => {
                        setEditing(entry.vehicleId);
                        setNote(entry.note);
                        setStatus(entry.status ?? 'seen');
                        setRemoving(undefined);
                      }}
                    >
                      {t('journal.editNote')}
                    </button>
                    {live && (
                      <button className="action-button" onClick={() => onSelect(live)}>
                        {t('journal.viewOnMap')}
                      </button>
                    )}
                    <button
                      className="text-button"
                      onClick={() => {
                        setRemoving(entry.vehicleId);
                        setEditing(undefined);
                      }}
                    >
                      {t('journal.remove')}
                    </button>
                  </div>
                </>
              )}
              {removing === entry.vehicleId && (
                <div className="journal-confirm">
                  <p>
                    {t('journal.removeCar')} {entry.label} {t('journal.andItsNote')}
                  </p>
                  <div className="comparison-actions">
                    <button
                      className="action-button"
                      onClick={() => {
                        onChange((current) =>
                          current.filter((item) => item.vehicleId !== entry.vehicleId),
                        );
                        setRemoving(undefined);
                      }}
                    >
                      {t('journal.confirmRemoval')}
                    </button>
                    <button
                      className="action-button"
                      onClick={() => setRemoving(undefined)}
                    >
                      {t('journal.keepCar')}
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {results.length > 10 && (
        <div className="fleet-pagination">
          <button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>
            {t('journal.previousCars')}
          </button>
          <span>
            {t('fleetExplorer.page')} {currentPage + 1} {t('fleetExplorer.of')}{' '}
            {Math.ceil(results.length / 10)}
          </span>
          <button
            disabled={(currentPage + 1) * 10 >= results.length}
            onClick={() => setPage(currentPage + 1)}
          >
            {t('journal.nextCars')}
          </button>
        </div>
      )}
    </section>
  );
}
