import { english } from '../i18n/messages';
import type { PlottedVehicle } from '../map/live-status';
import type { Route } from '../map/model';

export const JOURNAL_LIMIT = 500;
export interface JournalEntry {
  vehicleId: string;
  label: string;
  recordedAt: string;
  note: string;
  /** Older entries without a status are treated as seen. */
  status?: 'seen' | 'ridden';
  routeId?: string;
  routeNumber?: string;
  routeName?: string;
  overnight?: boolean;
}
const text = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.length <= maximum;
/** Deliberately whitelist keys: coordinates and arbitrary imported fields never persist. */
export function validJournal(value: unknown): value is JournalEntry[] {
  if (!Array.isArray(value) || value.length > JOURNAL_LIMIT) return false;
  const ids = new Set<string>();
  return value.every((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Object.keys(entry).some(
        (key) =>
          ![
            'vehicleId',
            'label',
            'recordedAt',
            'note',
            'status',
            'routeId',
            'routeNumber',
            'routeName',
            'overnight',
          ].includes(key),
      )
    )
      return false;
    if (
      !text(entry.vehicleId, 200) ||
      !entry.vehicleId ||
      ids.has(entry.vehicleId) ||
      !text(entry.label, 200) ||
      !entry.label ||
      !text(entry.note, 1000)
    )
      return false;
    if (
      !text(entry.recordedAt, 40) ||
      !/^\d{4}-\d{2}-\d{2}T/.test(entry.recordedAt) ||
      !Number.isFinite(Date.parse(entry.recordedAt)) ||
      new Date(entry.recordedAt).toISOString() !== entry.recordedAt
    )
      return false;
    for (const key of ['routeId', 'routeNumber', 'routeName'])
      if (entry[key] !== undefined && !text(entry[key], 200)) return false;
    if (entry.overnight !== undefined && typeof entry.overnight !== 'boolean')
      return false;
    if (entry.status !== undefined && !['seen', 'ridden'].includes(entry.status))
      return false;
    ids.add(entry.vehicleId);
    return true;
  });
}
export function journalEntry(
  car: PlottedVehicle,
  routes: Route[],
  now = new Date(),
): JournalEntry {
  const route = routes.find((route) => route.id === car.vehicle.routeId);
  return {
    vehicleId: car.vehicle.id,
    label: car.vehicle.label,
    recordedAt: now.toISOString(),
    note: '',
    status: 'seen',
    ...(car.vehicle.routeId ? { routeId: car.vehicle.routeId } : {}),
    ...(route
      ? { routeNumber: route.number, routeName: route.name, overnight: route.overnight }
      : {}),
  };
}
export function journalBadges(entries: JournalEntry[]) {
  const routes = new Set(
    entries.flatMap((entry) => (entry.routeId ? [entry.routeId] : [])),
  );
  return [
    {
      name: english('journal.firstCatch'),
      icon: '✦',
      earned: entries.length >= 1,
      progress: Math.min(entries.length, 1),
      target: 1,
      description: english('journal.addYourFirstStreetcar'),
    },
    {
      name: english('journal.highFive'),
      icon: 'Ⅴ',
      earned: entries.length >= 5,
      progress: Math.min(entries.length, 5),
      target: 5,
      description: english('journal.collectFiveDifferentStreetcars'),
    },
    {
      name: english('journal.streetcarSociety'),
      icon: '✧',
      earned: entries.length >= 20,
      progress: Math.min(entries.length, 20),
      target: 20,
      description: english('journal.collectTwentyDifferentStreetcars'),
    },
    {
      name: english('journal.routeRover'),
      icon: '↗',
      earned: routes.size >= 3,
      progress: Math.min(routes.size, 3),
      target: 3,
      description: english('journal.collectCarsAssignedToThreeDifferentRoutes'),
    },
    {
      name: english('journal.blueNightCollector'),
      icon: '☾',
      earned: entries.some((entry) => entry.overnight),
      progress: Number(entries.some((entry) => entry.overnight)),
      target: 1,
      description: english('journal.collectACarAssignedToAnOvernightRoute'),
    },
  ];
}
