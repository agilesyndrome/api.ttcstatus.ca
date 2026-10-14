import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { english } from '../../../../shared/i18n/messages';
import { projectSnapshot, type PlottedVehicle } from '../../../../shared/map/live-status';
import { DEFAULT_FILTERS, validFilters } from '../../commute';
import { usePreference } from '../../hooks/usePreferences';
import { useTheme } from '../../hooks/useTheme';
import { useShortcuts } from '../../hooks/useShortcuts';
import { useScreenActive } from '../../services/platform/react';
import { useRoute } from '../../services/navigation/react';
import { currentRoute } from '../../services/navigation/history';
import { snakeVersionForPath, type SnakeVersion } from '../../snake-route';
import { useAccountJournal } from '../journal/useAccountJournal';
import { clearPendingJournal, readPendingJournal } from '../journal/pendingJournal';
import { useMapExport } from '../export/useMapExport';
import { trackEvent } from '../../analytics';
import {
  hasDefaultView,
  hydrateDefaultView,
  readDefaultView,
  writeDefaultViewTools,
  type DefaultMapView,
} from './default-view';
import { useVehicleFeed } from './useVehicleFeed';
import { useStaticMap } from './useStaticMap';
import { useSavedStops } from './workspace/useSavedStops';
import { useSelection } from './workspace/useSelection';
import { useLocation } from './workspace/useLocation';
import type { TransitMapControls } from './types';

const validBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

/** Compose owners; no device or HTTP implementation belongs in the workspace. */
export function useHomeWorkspace(initialSnakeVersion?: SnakeVersion) {
  const map = useStaticMap();
  const { data } = map;
  // The imperative camera seam: the Save/Reset Default Map View tools read
  // the current view and command the landing view through it.
  const mapControls = useRef<TransitMapControls | null>(null);
  // The device's saved default (the preference store, read synchronously).
  // Its tools apply at mount unless the URL carries a share link — links win
  // over every local choice. Native stores hydrate asynchronously, so the
  // hydration answer re-applies the tools once it lands.
  const [hydratedDefault, setHydratedDefault] = useState<DefaultMapView | undefined>();
  const savedDefault = useMemo(
    () => readDefaultView() ?? hydratedDefault,
    [hydratedDefault],
  );
  useEffect(() => {
    let cancelled = false;
    void hydrateDefaultView().then((next) => {
      if (!cancelled) setHydratedDefault(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const [filters, setFilters] = usePreference(
    'ttc:filters:v1',
    DEFAULT_FILTERS,
    validFilters,
  );
  const saved = useSavedStops();
  const accountJournal = useAccountJournal();
  const [journalTarget, setJournalTarget] = useState<string>();
  const [journalDraftNumber, setJournalDraftNumber] = useState<string>();
  const [snakeOpen, setSnakeOpen] = useState(Boolean(initialSnakeVersion));
  const feed = useVehicleFeed(filters.live && Boolean(data), {
    polling: !snakeOpen,
  });
  const previous = useRef<PlottedVehicle[]>([]);
  const cars = useMemo(
    () =>
      data && feed.snapshot
        ? projectSnapshot(data, feed.snapshot, feed.now, previous.current)
        : [],
    [data, feed.snapshot, feed.now],
  );
  useEffect(() => {
    previous.current = cars;
  }, [cars]);
  const selection = useSelection(data, cars, filters, setFilters);
  useEffect(() => {
    if (selection.panel !== 'journal') {
      setJournalTarget(undefined);
      setJournalDraftNumber(undefined);
    }
  }, [selection.panel]);
  useEffect(() => {
    if (!accountJournal.userId || !accountJournal.ready) return;
    const pending = readPendingJournal();
    if (!pending) return;
    clearPendingJournal();
    const saved = accountJournal.entries.some(
      (entry) => entry.vehicleId === pending.vehicleId,
    );
    setJournalTarget(saved ? pending.vehicleId : undefined);
    setJournalDraftNumber(saved ? undefined : pending.label);
    selection.setPanel('journal');
  }, [accountJournal.userId, accountJournal.ready, accountJournal.entries]);
  // Older saved preferences and links could hide both rail layers. The
  // three-choice control always has a visible, representable selection.
  useEffect(() => {
    if (!filters.streetcar && !filters.subway)
      setFilters((current) => ({ ...current, streetcar: true, subway: true }));
  }, [filters.streetcar, filters.subway, setFilters]);
  // The saved default's tools apply at mount, before first paint, so the map
  // opens with them (a share link in the URL wins over every local choice).
  useLayoutEffect(() => {
    if (!savedDefault?.tools) return;
    if (new URL(currentRoute(), 'https://ttcstatus.ca').hash) return;
    setFilters((current) => ({ ...current, ...savedDefault.tools }));
  }, [savedDefault, setFilters]);
  // While a saved default exists, its tools stay current: the camera only
  // moves when Save/Update is pressed, but the tools always track the
  // visitor's latest choices.
  useEffect(() => {
    if (hasDefaultView())
      writeDefaultViewTools({
        streetcar: filters.streetcar,
        subway: filters.subway,
        live: filters.live,
        serviceOverlay: Boolean(filters.serviceOverlay),
      });
  }, [filters.streetcar, filters.subway, filters.live, filters.serviceOverlay]);
  const location = useLocation({ data, ...selection });
  const shownRoutes =
    data?.routes
      .filter((route) => filters.overnight || !route.overnight)
      .filter((route) =>
        /^(1|2|4|5|6)$/.test(route.number) ? filters.subway : filters.streetcar,
      ) ?? [];
  const exports = useMapExport({ data, shownRoutes, feed });
  const theme = useTheme();
  const [shortcutHelp, setShortcutHelp] = useState(false);
  const [shortcutsEnabled, setShortcutsEnabled] = usePreference(
    'ttc:shortcuts:v1',
    true,
    validBoolean,
  );
  const active = useScreenActive();
  const route = useRoute();
  useEffect(() => {
    if (!active) {
      setSnakeOpen(false);
      setShortcutHelp(false);
      exports.closeExport();
    } else if (
      snakeVersionForPath(new URL(route, 'https://ttcstatus.ca').pathname) !== undefined
    )
      setSnakeOpen(true);
    // Transient overlays follow route activity; retained map/camera state does not reset.
  }, [active, route]);
  useEffect(() => {
    if (snakeOpen) trackEvent('played-snake');
  }, [snakeOpen]);
  function reset() {
    selection.reset();
    location.clearLocateError();
  }
  function toggleSave() {
    const feature = selection.feature;
    if (!feature) return;
    if (!saved.savedStops.includes(feature.id) && saved.savedStops.length >= 100) {
      selection.setNotice(english('workspace.your100SavedStopsAreFullRemoveAStopTo'));
      return;
    }
    trackEvent(saved.savedStops.includes(feature.id) ? 'removed-stop' : 'saved-stop');
    saved.setSavedStops((current) =>
      current.includes(feature.id)
        ? current.filter((id) => id !== feature.id)
        : [...current, feature.id],
    );
  }
  function openCarJournal(car: PlottedVehicle) {
    if (!accountJournal.userId || car.vehicle.mode === 'subway') return;
    const id = car.vehicle.id;
    const saved = accountJournal.entries.some((entry) => entry.vehicleId === id);
    setJournalTarget(saved ? id : undefined);
    setJournalDraftNumber(saved ? undefined : car.vehicle.label);
    selection.setPanel('journal');
  }
  useShortcuts(active && shortcutsEnabled && !snakeOpen, {
    '/': () => document.querySelector<HTMLInputElement>('.search input')?.focus(),
    e: () => selection.setPanel('explore'),
    j: () => selection.setPanel('journal'),
    p: () => {
      trackEvent('exported-map');
      exports.previewMap();
    },
    s: toggleSave,
    n: theme.toggle,
    r: reset,
    '?': () => setShortcutHelp(true),
  });
  return {
    ...map,
    retryMap: map.retry,
    ...saved,
    ...selection,
    ...location,
    ...exports,
    filters,
    setFilters,
    accountJournal,
    journal: accountJournal.entries,
    journalTarget,
    journalDraftNumber,
    setJournal: accountJournal.change,
    openCarJournal,
    snakeOpen,
    setSnakeOpen,
    shortcutHelp,
    setShortcutHelp,
    shortcutsEnabled,
    setShortcutsEnabled,
    theme,
    feed,
    cars,
    shownRoutes,
    toggleSave,
    reset,
    mapControls,
  };
}
export type HomeWorkspaceState = ReturnType<typeof useHomeWorkspace>;
