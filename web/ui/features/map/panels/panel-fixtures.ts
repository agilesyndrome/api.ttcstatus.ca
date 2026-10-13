import { journalEntry, type JournalEntry } from '../../../../../shared/accounts/journal';
import { projectSnapshot } from '../../../../../shared/map/live-status';
import { DEFAULT_FILTERS } from '../../../commute';
import { demoData, demoSnapshot } from '../../../stories/fixtures';
import type { Account } from '../../accounts/auth';
import type { HomeWorkspaceState } from '../useHomeWorkspace';

const cars = projectSnapshot(demoData, demoSnapshot, Date.parse(demoSnapshot.fetchedAt));
const entries = cars.map((car) =>
  journalEntry(car, demoData.routes, new Date(demoSnapshot.fetchedAt)),
);
const expandedEntries: JournalEntry[] = Array.from({ length: 6 }, (_, index) => ({
  ...entries[0],
  vehicleId: String(4400 + index),
  label: String(4400 + index),
  routeId: demoData.routes[index % demoData.routes.length].id,
  routeNumber: demoData.routes[index % demoData.routes.length].number,
  routeName: demoData.routes[index % demoData.routes.length].name,
  status: index % 2 ? 'ridden' : 'seen',
  note: index === 0 ? 'A little ride along Queen.' : '',
}));

const feed = {
  snapshot: demoSnapshot,
  failed: false,
  active: true,
  updateSeconds: 30,
  retrySeconds: 0,
  now: Date.parse(demoSnapshot.fetchedAt),
};

function makeWorkspace(panel: 'explore' | 'journal' | 'badges' | 'sla') {
  const journal = panel === 'badges' ? expandedEntries : entries;
  return {
    data: demoData,
    filters: DEFAULT_FILTERS,
    setFilters() {},
    savedStops: ['queen'],
    setSavedStops() {},
    selection: undefined,
    setSelection() {},
    selectedRoute: undefined,
    setSelectedRoute() {},
    setMobilePanelOpen() {},
    following: false,
    setFollowing() {},
    setFocusPoint() {},
    location: undefined,
    setLocation() {},
    notice: '',
    pendingCar: { current: undefined },
    feed,
    cars,
    feature: undefined,
    car: undefined,
    selectFeature() {},
    selectVehicle() {},
    selectRoute() {},
    surprise() {},
    toggleSave() {},
    previewMap() {},
    shownRoutes: demoData.routes,
    panel,
    accountJournal: {
      userId: 'storybook-user',
      entries: journal,
      change: async () => true,
      ready: true,
      saving: false,
      error: '',
    },
    journal,
    setJournal() {},
  } as unknown as HomeWorkspaceState;
}

export const exploreWorkspace = makeWorkspace('explore');
export const journalWorkspace = makeWorkspace('journal');
export const badgesWorkspace = makeWorkspace('badges');
export const slaWorkspace = makeWorkspace('sla');

export const storyAccount: Account = {
  enabled: true,
  loaded: true,
  userId: 'storybook-user',
  error: '',
  retry() {},
  signIn() {},
  signUp() {},
  request: async () => new Response(),
  saveLanguage: async () => {},
};
