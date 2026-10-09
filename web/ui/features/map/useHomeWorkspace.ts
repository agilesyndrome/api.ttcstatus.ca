import { english } from '../../../../shared/i18n/messages';
import { type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import {
  boundsOf,
  type Bounds,
  type Feature,
  type Point,
} from '../../../../shared/map/model';
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
  nearbyStops,
  readMapLink,
  revealRoutes,
  validFilters,
  validSavedStops,
  type Location,
  type Selection,
  type SidebarPanel,
} from '../../commute';
import { useAccount } from '../accounts/auth';
import { trackEvent } from '../../analytics';
import { useAccountJournal } from '../journal/useAccountJournal';
import { useAccountStops } from '../stops/useAccountStops';
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
  // Signed-out visitors keep stops in this browser; signing in moves them to
  // the account database, where the server owns durability and conflict checks.
  const [localStops, setLocalStops, savedPersistent] = usePreference<string[]>(
    'ttc:stops:v1',
    [],
    validSavedStops,
  );
  const account = useAccount();
  const accountStops = useAccountStops();
  const signedIn = Boolean(account.userId);
  const savedStops = signedIn ? accountStops.stopIds : localStops;
  function setSavedStops(update: SetStateAction<string[]>) {
    if (signedIn)
      void accountStops.change((current) =>
        typeof update === 'function' ? update(current) : update,
      );
    else setLocalStops(update);
  }
  const migratedStops = useRef<string | null>(null);
  useEffect(() => {
    const userId = account.userId;
    if (!userId || !accountStops.ready || migratedStops.current === userId) return;
    if (!localStops.length) {
      migratedStops.current = userId;
      return;
    }
    migratedStops.current = userId;
    void accountStops
      .change((current) => [...new Set([...current, ...localStops])].slice(0, 100))
      .then((saved) => {
        if (saved) setLocalStops([]);
        else migratedStops.current = null;
      });
  }, [account.userId, accountStops.ready, accountStops.change, localStops]);
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
  const [focusBounds, setFocusBounds] = useState<Bounds>();
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
      // Open on the next animation frame, never inside this effect. A map tap
      // is followed by the browser's synthesized click; committing the open
      // before that click reflows the mobile layout — sliding the panel
      // toggle under the finger — so the click lands on the toggle and
      // closes the panel the very tap just opened. One frame later the click
      // has already hit the (unchanged) map harmlessly.
      const frame = requestAnimationFrame(() => setMobilePanelOpen(true));
      return () => cancelAnimationFrame(frame);
    }
  }, [selection, panel]);
  // Scroll a fresh selection to the top only once the panel is displayed:
  // a hidden (mobile-collapsed) panel ignores scrollTo, so scrolling before
  // the open commits would leave a stale scroll position on the details.
  useEffect(() => {
    if (mobilePanelOpen && panel === 'explore' && selection)
      sidebar.current?.scrollTo({ top: 0 });
  }, [mobilePanelOpen, panel, selection]);
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
      setFocusBounds(undefined);
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
    setLocateError('');
    setFocusPoint(undefined);
    setFocusPointLevel(undefined);
    setFocusBounds(undefined);
    setPanel('explore');
    setFollowing(false);
    setResetKey((key) => key + 1);
  }
  function selectFeature(next: Feature) {
    if (data) setFilters((current) => revealRoutes(current, data.routes, next.routeIds));
    // The [selection, panel] effect below opens the mobile panel. Setting it
    // here as well would reflow the layout inside the same tap: the browser's
    // follow-up click then lands on whatever moved under the finger — the
    // panel toggle — and instantly closes the panel the tap just opened.
    pendingCar.current = undefined;
    setFocusPoint(undefined);
    setFocusPointLevel(undefined);
    setFocusBounds(undefined);
    setNotice('');
    setFollowing(false);
    setPanel('explore');
    setSelection({ kind: 'stop', id: next.id });
    if (selectedRoute && !next.routeIds.includes(selectedRoute))
      setSelectedRoute(undefined);
  }
  function selectVehicle(next: PlottedVehicle, focus = false) {
    // Opening the mobile panel is left to the [selection, panel] effect: a
    // synchronous open inside the tap handler reflows the layout before the
    // browser's synthesized click fires, so the click hits the repositioned
    // panel toggle and closes the panel this very tap opened.
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
    setFocusBounds(undefined);
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
    // Frame the location together with its two nearest stations so the zoom
    // answers "which stations are closest to me" instead of showing the whole
    // neighborhood. Out-of-area locations keep the full Toronto map in view
    // instead of panning to empty space.
    const here = gpsToMap(next.latitude, next.longitude, data.geographicTransform);
    const stations = nearbyStops(data, next)
      .slice(0, 2)
      .map((stop) => stop.feature.point);
    setFocusPoint(undefined);
    setFocusPointLevel(undefined);
    if (stations.length) {
      // Frame exactly this position and the two nearest stations. Padding
      // grows with the span (15%, at least 10 map units ≈ 140 m) instead of
      // a fixed inset, so the zoom answers "which stations are closest to
      // me" at any station density without pulling in the wider network.
      const box = boundsOf([here, ...stations], 0);
      const pad = Math.max(10, 0.15 * Math.max(box.width, box.height));
      setFocusBounds({
        x: box.x - pad,
        y: box.y - pad,
        width: box.width + 2 * pad,
        height: box.height + 2 * pad,
      });
    } else {
      setFocusBounds(undefined);
      setResetKey((key) => key + 1);
    }
  }
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState('');
  const locateRequest = useRef(0);
  useEffect(
    () => () => {
      locateRequest.current++;
    },
    [],
  );
  // One map-level control owns geolocation, so the explore panel stays
  // read-only and errors surface on the map beside the button that caused them.
  function requestLocate() {
    if (!data) return;
    if (!navigator.geolocation) {
      setLocateError(
        english('nearbyStops.locationIsUnavailableInThisBrowserYouCanSearchFor'),
      );
      return;
    }
    const current = ++locateRequest.current;
    setLocating(true);
    setLocateError('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (current !== locateRequest.current) return;
        setLocating(false);
        trackEvent('located');
        locate({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        if (current !== locateRequest.current) return;
        setLocating(false);
        setLocateError(
          error.code === 1
            ? english('nearbyStops.locationPermissionWasDeclinedYouCanStillSearchForA')
            : error.code === 3
              ? english('nearbyStops.locationTookTooLongTryAgainOrSearchForA')
              : english('nearbyStops.yourLocationCouldNotBeFoundTryAgainOrSearch'),
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 },
    );
  }
  function toggleSave() {
    if (!feature) return;
    if (!savedStops.includes(feature.id) && savedStops.length >= 100) {
      setNotice(english('workspace.your100SavedStopsAreFullRemoveAStopTo'));
      return;
    }
    trackEvent(savedStops.includes(feature.id) ? 'removed-stop' : 'saved-stop');
    setSavedStops((current) =>
      current.includes(feature.id)
        ? current.filter((id) => id !== feature.id)
        : current.length < 100
          ? [...current, feature.id]
          : current,
    );
  }
  // Covers both the toolbar launch and arriving directly on a snake route.
  useEffect(() => {
    if (snakeOpen) trackEvent('played-snake');
  }, [snakeOpen]);

  useShortcuts(shortcutsEnabled && !snakeOpen, {
    '/': () => document.querySelector<HTMLInputElement>('.search input')?.focus(),
    e: () => setPanel('explore'),
    j: () => setPanel('journal'),
    p: () => {
      trackEvent('exported-map');
      previewMap();
    },
    s: toggleSave,
    n: theme.toggle,
    r: reset,
    '?': () => setShortcutHelp(true),
  });

  return {
    data,
    error,
    retryMap,
    filters,
    setFilters,
    savedStops,
    setSavedStops,
    savedPersistent,
    savedSignedIn: signedIn,
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
    focusBounds,
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
    locating,
    locateError,
    requestLocate,
    toggleSave,
    previewMap,
    changeExportCars,
    closeExport,
    reset,
    shownRoutes,
  };
}

export type HomeWorkspaceState = ReturnType<typeof useHomeWorkspace>;
