import { useEffect, useMemo, useRef, useState } from 'react';
import { english } from '../../../../shared/i18n/messages';
import { projectSnapshot, type PlottedVehicle } from '../../../../shared/map/live-status';
import { DEFAULT_FILTERS, validFilters } from '../../commute';
import { usePreference } from '../../hooks/usePreferences';
import { useTheme } from '../../hooks/useTheme';
import { useShortcuts } from '../../hooks/useShortcuts';
import { useScreenActive } from '../../services/platform/react';
import { useRoute } from '../../services/navigation/react';
import { snakeVersionForPath, type SnakeVersion } from '../../snake-route';
import { useAccountJournal } from '../journal/useAccountJournal';
import { useMapExport } from '../export/useMapExport';
import { trackEvent } from '../../analytics';
import { useVehicleFeed } from './useVehicleFeed';
import { useStaticMap } from './useStaticMap';
import { useSavedStops } from './workspace/useSavedStops';
import { useSelection } from './workspace/useSelection';
import { useLocation } from './workspace/useLocation';

const validBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

/** Compose owners; no device or HTTP implementation belongs in the workspace. */
export function useHomeWorkspace(initialSnakeVersion?: SnakeVersion) {
  const map = useStaticMap();
  const { data } = map;
  const [filters, setFilters] = usePreference(
    'ttc:filters:v1',
    DEFAULT_FILTERS,
    validFilters,
  );
  const saved = useSavedStops();
  const accountJournal = useAccountJournal();
  const [snakeOpen, setSnakeOpen] = useState(Boolean(initialSnakeVersion));
  const feed = useVehicleFeed((filters.live || snakeOpen) && Boolean(data), {
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
    setJournal: accountJournal.change,
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
  };
}
export type HomeWorkspaceState = ReturnType<typeof useHomeWorkspace>;
