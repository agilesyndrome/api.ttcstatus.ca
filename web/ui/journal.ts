import type { PlottedVehicle } from '../map/live-status';
import type { Route } from '../map/model';

export const JOURNAL_LIMIT = 500;
export interface JournalEntry {
  vehicleId: string; label: string; recordedAt: string; note: string;
  routeId?: string; routeNumber?: string; routeName?: string; overnight?: boolean;
}
const text = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.length <= maximum;
/** Deliberately whitelist keys: coordinates and arbitrary imported fields never persist. */
export function validJournal(value: unknown): value is JournalEntry[] {
  if (!Array.isArray(value) || value.length > JOURNAL_LIMIT) return false;
  const ids = new Set<string>();
  return value.every(entry => {
    if (!entry || typeof entry !== 'object' || Object.keys(entry).some(key => !['vehicleId', 'label', 'recordedAt', 'note', 'routeId', 'routeNumber', 'routeName', 'overnight'].includes(key))) return false;
    if (!text(entry.vehicleId, 200) || !entry.vehicleId || ids.has(entry.vehicleId) || !text(entry.label, 200) || !entry.label || !text(entry.note, 1000)) return false;
    if (!text(entry.recordedAt, 40) || !/^\d{4}-\d{2}-\d{2}T/.test(entry.recordedAt) || !Number.isFinite(Date.parse(entry.recordedAt)) || new Date(entry.recordedAt).toISOString() !== entry.recordedAt) return false;
    for (const key of ['routeId', 'routeNumber', 'routeName']) if (entry[key] !== undefined && !text(entry[key], 200)) return false;
    if (entry.overnight !== undefined && typeof entry.overnight !== 'boolean') return false;
    ids.add(entry.vehicleId); return true;
  });
}
export function journalEntry(car: PlottedVehicle, routes: Route[], now = new Date()): JournalEntry {
  const route = routes.find(route => route.id === car.vehicle.routeId);
  return { vehicleId: car.vehicle.id, label: car.vehicle.label, recordedAt: now.toISOString(), note: '',
    ...(car.vehicle.routeId ? { routeId: car.vehicle.routeId } : {}),
    ...(route ? { routeNumber: route.number, routeName: route.name, overnight: route.overnight } : {}) };
}
export function journalBadges(entries: JournalEntry[]) {
  const routes = new Set(entries.flatMap(entry => entry.routeId ? [entry.routeId] : []));
  return [
    { name: 'First catch', icon: '✦', earned: entries.length >= 1, progress: Math.min(entries.length, 1), target: 1, description: 'Add your first streetcar.' },
    { name: 'High five', icon: 'Ⅴ', earned: entries.length >= 5, progress: Math.min(entries.length, 5), target: 5, description: 'Collect five different streetcars.' },
    { name: 'Streetcar society', icon: '✧', earned: entries.length >= 20, progress: Math.min(entries.length, 20), target: 20, description: 'Collect twenty different streetcars.' },
    { name: 'Route rover', icon: '↗', earned: routes.size >= 3, progress: Math.min(routes.size, 3), target: 3, description: 'Collect cars assigned to three different routes.' },
    { name: 'Blue Night collector', icon: '☾', earned: entries.some(entry => entry.overnight), progress: Number(entries.some(entry => entry.overnight)), target: 1, description: 'Collect a car assigned to an overnight route.' },
  ];
}
export function journalBackup(entries: JournalEntry[]): string {
  return JSON.stringify({ format: 'ttc-streetcar-journal', version: 1, entries }, null, 2) + '\n';
}
export function readJournalBackup(contents: string): JournalEntry[] {
  if (contents.length > 2_000_000) throw new Error('This file is too large. Choose a journal backup under 2 MB.');
  let data: unknown;
  try { data = JSON.parse(contents); } catch { throw new Error('This is not a valid JSON journal backup.'); }
  const backup = data as { format?: unknown; version?: unknown; entries?: unknown } | null;
  if (!backup || backup.format !== 'ttc-streetcar-journal' || backup.version !== 1 || !validJournal(backup.entries)) throw new Error('Choose a valid version 1 TTC streetcar journal backup.');
  return backup.entries;
}
/** Existing notes win; importing never overwrites or silently drops a car. */
export function mergeJournal(current: JournalEntry[], incoming: JournalEntry[]) {
  const ids = new Set(current.map(entry => entry.vehicleId));
  const additions = incoming.filter(entry => !ids.has(entry.vehicleId));
  if (current.length + additions.length > JOURNAL_LIMIT) throw new Error('This import would exceed the 500-car journal limit. Remove some entries first.');
  return { entries: [...current, ...additions], added: additions.length };
}
