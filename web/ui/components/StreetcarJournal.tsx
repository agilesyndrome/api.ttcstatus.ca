import { useId, useMemo, useRef, useState } from 'react';
import type { PlottedVehicle } from '../../map/live-status';
import { downloadFile } from '../download';
import { JOURNAL_LIMIT, journalBackup, journalBadges, mergeJournal, readJournalBackup, type JournalEntry } from '../journal';
interface Props { entries: JournalEntry[]; persistent: boolean; cars: PlottedVehicle[]; active: boolean; loaded?: boolean; failed?: boolean; onChange(update: (entries: JournalEntry[]) => JournalEntry[]): void; onSelect(car: PlottedVehicle): void; onFleet(): void }
export function StreetcarJournal({ entries, persistent, cars, active, loaded = true, failed = false, onChange, onSelect, onFleet }: Props) {
  const id = useId();
  const latest = useRef(entries); latest.current = entries;
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<string>();
  const [note, setNote] = useState('');
  const [removing, setRemoving] = useState<string>();
  const [page, setPage] = useState(0);
  const badges = journalBadges(entries);
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter(entry => [entry.label, entry.vehicleId, entry.routeNumber, entry.routeName, entry.note].join(' ').toLowerCase().includes(needle))
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || a.vehicleId.localeCompare(b.vehicleId, undefined, { numeric: true }));
  }, [entries, query]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(results.length / 10) - 1));
  async function restore(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('This file is too large. Choose a journal backup under 2 MB.');
      const incoming = readJournalBackup(await file.text());
      const result = mergeJournal(latest.current, incoming);
      onChange(() => result.entries);
      setMessage(result.added + (result.added === 1 ? ' new car restored.' : ' new cars restored.') + ' Existing notes were kept.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to read this journal backup.'); }
    if (input.current) input.current.value = '';
  }
  return <section className="streetcar-journal"><p className="eyebrow">Your rolling collection</p><h1>Streetcar journal.</h1><p className="helper">Collect streetcar numbers, keep ride notes and earn badges. Add a car from the map or Fleet.</p>
    <div className="journal-summary"><strong>{entries.length}</strong><span>{entries.length === 1 ? 'unique streetcar' : 'unique streetcars'} collected</span><small>{badges.filter(badge => badge.earned).length} / {badges.length} badges unlocked</small></div>
    <details className="journal-achievements"><summary>Explore your collection badges</summary><div className="journal-badges" aria-label="Collection badges">{badges.map(badge => <div key={badge.name} className={'journal-badge' + (badge.earned ? ' earned' : '')}><span aria-hidden="true">{badge.icon}</span><div><strong>{badge.name}</strong><small>{badge.description}</small><small>{badge.earned ? 'Unlocked' : badge.progress + ' / ' + badge.target}</small></div></div>)}</div>
    <p className="microcopy">Badges reflect your manually saved collection. An overnight assignment earns Blue Night collector at any time of day.</p></details>
    <button className="action-button export-fleet" onClick={onFleet}>Find a streetcar in Fleet →</button>
    {!persistent && <p className="tip" role="status">Browser storage is unavailable. Your journal lasts for this tab; download a backup to keep it.</p>}
    <p className="microcopy">Saved only in this browser, up to {JOURNAL_LIMIT} different cars. No GPS coordinates are recorded. Notes and dates are included in backups.</p>
    <div className="comparison-actions journal-backups"><button className="action-button" disabled={!entries.length} onClick={() => downloadFile(journalBackup(entries), 'ttc-streetcar-journal.json', 'application/json')}>Back up journal</button><button className="action-button" onClick={() => input.current?.click()}>Restore backup</button><input ref={input} type="file" accept=".json,application/json" aria-label="Journal backup file" className="sr-only" onChange={event => { void restore(event.target.files?.[0]); }} /></div>
    {message && <p className="tip" role="status">{message}</p>}
    <div className="tool-form"><div className="form-control"><label htmlFor={id + '-search'}>Search your journal</label><input id={id + '-search'} type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="Car, route or note" /></div></div>
    <p className="fleet-count" role="status">{results.length} {results.length === 1 ? 'collected car' : 'collected cars'} found</p>
    {!entries.length && <p className="tip">Your first catch is waiting. Choose a streetcar and select “Add to journal”.</p>}
    {Boolean(entries.length) && !results.length && <p className="helper">No collected cars match that search.</p>}
    <div className="journal-entries">{results.slice(currentPage * 10, currentPage * 10 + 10).map(entry => {
      const live = active && loaded ? cars.find(car => car.vehicle.id === entry.vehicleId) : undefined;
      return <article className="journal-entry" key={entry.vehicleId} aria-label={'Collected car ' + entry.label}><div className="section-heading"><h2>Car {entry.label}</h2><span className={'report-tag' + (!live || live.stale ? ' stale' : '')}>{!active ? 'Live paused' : !loaded ? failed ? 'Unavailable' : 'Awaiting feed' : live ? live.stale ? 'Stale report' : 'In live feed' : 'Not in snapshot'}</span></div>
        <p className="microcopy">{entry.routeNumber ? entry.routeNumber + ' ' + entry.routeName : 'Route not supplied'} · Saved {new Date(entry.recordedAt).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })}</p>
        {editing === entry.vehicleId ? <form className="tool-form" onSubmit={event => { event.preventDefault(); onChange(current => current.map(item => item.vehicleId === entry.vehicleId ? { ...item, note } : item)); setEditing(undefined); }}><div className="form-control"><label htmlFor={id + '-note'}>Note for car {entry.label}</label><textarea id={id + '-note'} autoFocus maxLength={1000} rows={3} value={note} onChange={event => setNote(event.target.value)} /></div><div className="comparison-actions"><button className="action-button" type="submit">Save note</button><button className="action-button" type="button" onClick={() => setEditing(undefined)}>Cancel editing</button></div></form> : <>{entry.note && <p className="journal-note">{entry.note}</p>}<div className="comparison-actions"><button className="action-button" onClick={() => { setEditing(entry.vehicleId); setNote(entry.note); setRemoving(undefined); }}>Edit note</button>{live && <button className="action-button" onClick={() => onSelect(live)}>View on map</button>}<button className="text-button" onClick={() => { setRemoving(entry.vehicleId); setEditing(undefined); }}>Remove</button></div></>}
        {removing === entry.vehicleId && <div className="journal-confirm"><p>Remove car {entry.label} and its note?</p><div className="comparison-actions"><button className="action-button" onClick={() => { onChange(current => current.filter(item => item.vehicleId !== entry.vehicleId)); setRemoving(undefined); }}>Confirm removal</button><button className="action-button" onClick={() => setRemoving(undefined)}>Keep car</button></div></div>}
      </article>;
    })}</div>
    {results.length > 10 && <div className="fleet-pagination"><button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous cars</button><span>Page {currentPage + 1} of {Math.ceil(results.length / 10)}</span><button disabled={(currentPage + 1) * 10 >= results.length} onClick={() => setPage(currentPage + 1)}>Next cars</button></div>}
  </section>;
}
