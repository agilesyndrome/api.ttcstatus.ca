import { english } from '../../../../shared/i18n/messages';
import { t } from '../../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type Feature, type Point } from '../../../../shared/map/model';
import { gpsToMap } from '../../../../shared/map/projection';
import { projectSnapshot, type PlottedVehicle } from '../../../../shared/map/live-status';
import { useVehicleFeed } from './useVehicleFeed';
import { useStaticMap } from './useStaticMap';
import { useMapExport } from '../export/useMapExport';
import { usePreference } from '../../hooks/usePreferences';
import { useTheme } from '../../hooks/useTheme';
import { useShortcuts } from '../../hooks/useShortcuts';
import {
  DEFAULT_FILTERS,
  mapLinkHash,
  readMapLink,
  revealRoutes,
  validFilters,
  validSavedStops,
  type Location,
  type Selection,
  type SidebarPanel,
} from '../../commute';
import {
  JOURNAL_LIMIT,
  journalEntry,
  validJournal,
} from '../../../../shared/accounts/journal';
import { useAccount } from '../accounts/auth';
import { useAccountJournal } from '../journal/useAccountJournal';
import type { SnakeVersion } from '../../snake-route';

const validBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

// One workspace owns selection and tool transitions; renderers only consume it.
export function useHomeWorkspace(initialSnakeVersion?: SnakeVersion) {
  const { data, error, retry: retryMap } = useStaticMap();
  const [filters, setFilters] = usePreference(
    'ttc:filters:v1',
    DEFAULT_FILTERS,
    validFilters,
  );
  const [savedStops, setSavedStops, savedPersistent] = usePreference<string[]>(
    'ttc:stops:v1',
    [],
    validSavedStops,
  );
  const account = useAccount();
  const accountJournal = useAccountJournal();
  const journal = accountJournal.entries;
  const setJournal = accountJournal.change;
  const [initialLink] = useState(() => readMapLink(window.location.hash));
  const [selection, setSelection] = useState<Selection | undefined>(
    initialLink.selection,
  );
  const [selectedRoute, setSelectedRoute] = useState<string | undefined>(() => {
    const link = initialLink;
    return link.selection?.kind === 'route' ? link.selection.id : link.contextRoute;
  });
  const [panel, setPanel] = useState<SidebarPanel>(initialLink.panel ?? 'explore');
  const [mobilePanelOpen, setMobilePanelOpen] = useState(
    Boolean(
      initialLink.selection || (initialLink.panel && initialLink.panel !== 'explore'),
    ),
  );
  const [following, setFollowing] = useState(false);
  const [snakeOpen, setSnakeOpen] = useState(Boolean(initialSnakeVersion));
  const [shortcutHelp, setShortcutHelp] = useState(false);
  const [shortcutsEnabled, setShortcutsEnabled] = usePreference(
    'ttc:shortcuts:v1',
    true,
    validBoolean,
  );
  const [focusPoint, setFocusPoint] = useState<Point>();
  const [focusPointLevel, setFocusPointLevel] = useState<number>();
  const [location, setLocation] = useState<Location>();
  const [notice, setNotice] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const theme = useTheme();
  const pendingCar = useRef(selection?.kind === 'car' ? selection.id : undefined);
  // Snake gets one fresh snapshot on entry, then stops polling while the game
  // owns the screen. The explorer resumes its normal poll cycle on close.
  const feed = useVehicleFeed((filters.live || snakeOpen) && Boolean(data), {
    polling: !snakeOpen,
  });
  const previous = useRef<PlottedVehicle[]>([]);
  const sidebar = useRef<HTMLDivElement>(null);
  const cars = useMemo(
    () =>
      data && feed.snapshot
        ? projectSnapshot(data, feed.snapshot, feed.now, previous.current)
        : [],
    [data, feed.snapshot, feed.now],
  );
  const feature = useMemo(() => {
    const stop =
      selection?.kind === 'stop'
        ? data?.features.find((feature) => feature.id === selection.id)
        : undefined;
    return stop ? { ...stop } : undefined; // Reselecting a bookmark focuses it again, without moving on feed refreshes.
  }, [selection, data]);
  const car =
    selection?.kind === 'car'
      ? cars.find((car) => car.vehicle.id === selection.id)
      : undefined;
  const locationPoint = useMemo(
    () =>
      data && location
        ? gpsToMap(location.latitude, location.longitude, data.geographicTransform)
        : undefined,
    [data, location],
  );
  const shownRoutes =
    data?.routes
      .filter((route) => filters.overnight || !route.overnight)
      .filter((route) =>
        /^(1|2|4|5|6)$/.test(route.number) ? filters.subway : filters.streetcar,
      ) ?? [];
  const { exportImage, exportCars, previewMap, changeExportCars, closeExport } =
    useMapExport({ data, shownRoutes, feed });
  useEffect(() => {
    previous.current = cars;
  }, [cars]);
  useEffect(() => {
    if (panel === 'explore' && selection) {
      setMobilePanelOpen(true);
      sidebar.current?.scrollTo({ top: 0 });
    }
  }, [selection, panel]);
  useEffect(() => {
    if (panel !== 'explore') setMobilePanelOpen(true);
    sidebar.current?.scrollTo({ top: 0 });
    if (panel !== 'explore') {
      setFollowing(false);
      pendingCar.current = undefined;
    }
  }, [panel]);
  useEffect(() => {
    if (account.loaded && !account.userId && panel !== 'explore') setPanel('explore');
  }, [account.loaded, account.userId, panel]);

  useEffect(() => {
    const restore = () => {
      const link = readMapLink(window.location.hash);
      setSelection(link.selection);
      setNotice('');
      setFocusPoint(undefined);
      setFocusPointLevel(undefined);
      setSelectedRoute(
        link.selection?.kind === 'route' ? link.selection.id : link.contextRoute,
      );
      setPanel(link.panel ?? 'explore');
      setFollowing(false);
      pendingCar.current = link.selection?.kind === 'car' ? link.selection.id : undefined;
      setFilters({
        ...DEFAULT_FILTERS,
        ...link.filters,
        ...(link.selection?.kind === 'car' ? { live: true } : {}),
      });
    };
    // A shared link takes precedence over local layer preferences.
    if (window.location.hash) restore();
    window.addEventListener('hashchange', restore);
    return () => window.removeEventListener('hashchange', restore);
  }, []);
  useEffect(() => {
    if (!data) return;
    const url = new URL(window.location.href);
    url.hash = mapLinkHash(selection, filters, selectedRoute, { panel });
    window.history.replaceState(null, '', url);
  }, [data, selection, filters, selectedRoute, panel]);

  useEffect(() => {
    if (!data || !selection) return;
    if (
      (selection.kind === 'stop' && !feature) ||
      (selection.kind === 'route' &&
        !data.routes.some((route) => route.id === selection.id && route.scheduled))
    ) {
      setNotice(english('workspace.thatSharedStopOrRouteIsNoLongerInThis'));
      setSelection(undefined);
      setSelectedRoute(undefined);
    } else if (feature)
      setFilters((current) => revealRoutes(current, data.routes, feature.routeIds));
  }, [data, selection, feature, setFilters]);
  useEffect(() => {
    if (!data || !selectedRoute) return;
    const route = data.routes.find(
      (route) => route.id === selectedRoute && route.scheduled,
    );
    if (!route) setSelectedRoute(undefined);
    else if (feature && !feature.routeIds.includes(selectedRoute))
      setSelectedRoute(undefined);
    else setFilters((current) => revealRoutes(current, data.routes, [route.id]));
  }, [data, selectedRoute, feature, setFilters]);
  useEffect(() => {
    if (!car || pendingCar.current !== car.vehicle.id) return;
    pendingCar.current = undefined;
    if (selectedRoute && selectedRoute !== car.vehicle.routeId)
      setSelectedRoute(undefined);
    setFilters((current) => ({
      ...revealRoutes(current, data?.routes ?? [], [car.vehicle.routeId ?? '']),
      live: true,
      overnight:
        current.overnight ||
        Boolean(
          data?.routes.find((route) => route.id === car.vehicle.routeId)?.overnight,
        ),
    }));
    // Entering a car view from a shared link follows it until another action.
    // The map centers on it without changing the zoom level.
    setFollowing(true);
  }, [car, data, selectedRoute, setFilters]);

  function reset() {
    setMobilePanelOpen(false);
    pendingCar.current = undefined;
    setSelection(undefined);
    setSelectedRoute(undefined);
    setNotice('');
    setFocusPoint(undefined);
    setFocusPointLevel(undefined);
    setPanel('explore');
    setFollowing(false);
    setResetKey((key) => key + 1);
  }
  function selectFeature(next: Feature) {
    if (data) setFilters((current) => revealRoutes(current, data.routes, next.routeIds));
    setMobilePanelOpen(true);
    pendingCar.current = undefined;
    setFocusPoint(undefined);
    setFocusPointLevel(undefined);
    setNotice('');
    setFollowing(false);
    setPanel('explore');
    setSelection({ kind: 'stop', id: next.id });
    if (selectedRoute && !next.routeIds.includes(selectedRoute))
      setSelectedRoute(undefined);
  }
  function selectVehicle(next: PlottedVehicle, focus = false) {
    setMobilePanelOpen(true);
    pendingCar.current = undefined;
    setSelection({ kind: 'car', id: next.vehicle.id });
    setNotice('');
    setPanel('explore');
    // Selecting a car follows it; any other action pans away and unfollows.
    // The map centers on it without changing the zoom level.
    setFollowing(true);
    if (focus) {
      setSelectedRoute(undefined);
      setFilters((current) => ({
        ...revealRoutes(current, data?.routes ?? [], [next.vehicle.routeId ?? '']),
        live: true,
        overnight:
          current.overnight ||
          Boolean(
            data?.routes.find((route) => route.id === next.vehicle.routeId)?.overnight,
          ),
      }));
    }
  }
  function selectRoute(id?: string) {
    pendingCar.current = undefined;
    setSelectedRoute(id);
    setSelection(id ? { kind: 'route', id } : undefined);
    setFocusPoint(undefined);
    setFocusPointLevel(undefined);
    setNotice('');
    setFollowing(false);
  }
  function surprise() {
    if (!data) return;
    const stops = data.features.filter(
      (stop) =>
        stop.id !== feature?.id &&
        stop.boardingPoints > 0 &&
        stop.routeIds.some((id) =>
          data.routes.some(
            (route) => route.id === id && (filters.overnight || !route.overnight),
          ),
        ),
    );
    if (stops.length) selectFeature(stops[Math.floor(Math.random() * stops.length)]);
  }
  function locate(next: Location) {
    if (!data) return;
    setLocation(next);
    setFollowing(false);
    // Center on the actual location even when there are no stops nearby. The
    // wider neighborhood crop keeps the map useful without zooming into a marker.
    setFocusPoint(gpsToMap(next.latitude, next.longitude, data.geographicTransform));
    setFocusPointLevel(2.5);
  }
  function toggleSave() {
    if (!feature) return;
    if (!savedStops.includes(feature.id) && savedStops.length >= 100) {
      setNotice(english('workspace.your100SavedStopsAreFullRemoveAStopTo'));
      return;
    }
    setSavedStops((current) =>
      current.includes(feature.id)
        ? current.filter((id) => id !== feature.id)
        : current.length < 100
          ? [...current, feature.id]
          : current,
    );
  }
  function collectCar() {
    if (!account.userId) {
      setPanel('journal');
      setMobilePanelOpen(true);
      return;
    }
    if (!accountJournal.ready) {
      setNotice(english('workspace.waitForYourJournalToLoadOrFinishSavingThen'));
      return;
    }
    if (
      !car ||
      journal.length >= JOURNAL_LIMIT ||
      journal.some((entry) => entry.vehicleId === car.vehicle.id)
    )
      return;
    const entry = journalEntry(car, data?.routes ?? []);
    if (!validJournal([entry])) {
      setNotice(english('workspace.thisCarSSuppliedIdentifierCannotBeSavedInThe'));
      return;
    }
    setJournal((current) =>
      current.some((item) => item.vehicleId === entry.vehicleId) ||
      current.length >= JOURNAL_LIMIT
        ? current
        : [...current, entry],
    );
    setNotice(
      english('journal.car') + car.vehicle.label + english('journal.addedToYourJournal'),
    );
  }
  useShortcuts(shortcutsEnabled && !snakeOpen, {
    '/': () => document.querySelector<HTMLInputElement>('.search input')?.focus(),
    e: () => setPanel('explore'),
    j: () => setPanel('journal'),
    p: previewMap,
    s: toggleSave,
    n: theme.toggle,
    r: reset,
    '?': () => setShortcutHelp(true),
  });

  const panelTitle =
    panel === 'explore'
      ? car
        ? `${car.vehicle.mode === 'subway' ? t('viewer.train') : t('viewer.car')} ${car.vehicle.label}`
        : (feature?.name ??
          (selection?.kind === 'car'
            ? t('workspace.carValue', { value1: selection.id })
            : selection?.kind === 'route'
              ? t('workspace.valueRouteStops', {
                  value1:
                    data?.routes.find((route) => route.id === selection.id)?.number ?? '',
                })
              : t('workspace.exploreTorontoRail')))
      : {
          journal: t('workspace.streetcarJournal'),
          badges: t('navigation.badges'),
          fleet: t('workspace.fleetTools'),
          compare: t('workspace.compareTools'),
          stops: t('workspace.stopDirectory'),
        }[panel];

  return {
    data,
    error,
    retryMap,
    filters,
    setFilters,
    savedStops,
    setSavedStops,
    savedPersistent,
    accountJournal,
    journal,
    setJournal,
    exportImage,
    exportCars,
    initialLink,
    selection,
    setSelection,
    selectedRoute,
    setSelectedRoute,
    panel,
    setPanel,
    mobilePanelOpen,
    setMobilePanelOpen,
    following,
    setFollowing,
    snakeOpen,
    setSnakeOpen,
    shortcutHelp,
    setShortcutHelp,
    shortcutsEnabled,
    setShortcutsEnabled,
    focusPoint,
    focusPointLevel,
    setFocusPoint,
    location,
    setLocation,
    notice,
    setNotice,
    resetKey,
    theme,
    pendingCar,
    feed,
    sidebar,
    cars,
    feature,
    car,
    locationPoint,
    selectFeature,
    selectVehicle,
    selectRoute,
    surprise,
    locate,
    toggleSave,
    collectCar,
    previewMap,
    changeExportCars,
    closeExport,
    reset,
    shownRoutes,
    panelTitle,
  };
}

export type HomeWorkspaceState = ReturnType<typeof useHomeWorkspace>;
