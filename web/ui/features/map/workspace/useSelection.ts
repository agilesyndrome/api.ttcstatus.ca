import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { english } from '../../../../../shared/i18n/messages';
import type { Bounds, Feature, Point, ViewerData } from '../../../../../shared/map/model';
import type { PlottedVehicle } from '../../../../../shared/map/live-status';
import {
  readMapLink,
  revealRoutes,
  type Selection,
  type SidebarPanel,
  type MapFilterValues,
} from '../../../commute';
import { currentRoute } from '../../../services/navigation/history';
import { useAccount } from '../../accounts/auth';
import { useWorkspaceLink } from './useWorkspaceLink';

export function useSelection(
  data: ViewerData | undefined,
  cars: PlottedVehicle[],
  filters: MapFilterValues,
  setFilters: Dispatch<SetStateAction<MapFilterValues>>,
) {
  const account = useAccount();
  const [initialLink] = useState(() =>
    readMapLink(new URL(currentRoute(), 'https://ttcstatus.ca').hash),
  );
  const [selection, setSelection] = useState<Selection | undefined>(
    initialLink.selection,
  );
  const [selectedRoute, setSelectedRoute] = useState<string | undefined>(() => {
    const link = initialLink;
    return link.selection?.kind === 'route' ? link.selection.id : link.contextRoute;
  });
  const [panel, setPanel] = useState<SidebarPanel>(initialLink.panel ?? 'explore');
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [following, setFollowing] = useState(false);
  const [focusPoint, setFocusPoint] = useState<Point>();
  const [focusPointLevel, setFocusPointLevel] = useState<number>();
  const [focusBounds, setFocusBounds] = useState<Bounds>();
  const [notice, setNotice] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const pendingCar = useRef(selection?.kind === 'car' ? selection.id : undefined);
  const sidebar = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    if (!selection || panel !== 'explore') return;
    const frame = requestAnimationFrame(() => setMobilePanelOpen(false));
    return () => cancelAnimationFrame(frame);
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
    if (
      account.loaded &&
      !account.userId &&
      panel !== 'explore' &&
      panel !== 'route-pulse'
    )
      setPanel('explore');
  }, [account.loaded, account.userId, panel]);

  useWorkspaceLink({
    data,
    selection,
    setSelection,
    selectedRoute,
    setSelectedRoute,
    panel,
    setPanel,
    filters,
    setFilters,
    setNotice,
    setFocusPoint,
    setFocusPointLevel,
    setFocusBounds,
    setFollowing,
    pendingCar,
  });
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
    setFocusBounds(undefined);
    setPanel('explore');
    setFollowing(false);
    setResetKey((key) => key + 1);
  }
  function selectFeature(next: Feature) {
    if (data) setFilters((current) => revealRoutes(current, data.routes, next.routeIds));
    // A selection closes the phone menu on the next frame and reveals its details card.
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
  return {
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
    focusPoint,
    setFocusPoint,
    focusPointLevel,
    setFocusPointLevel,
    focusBounds,
    setFocusBounds,
    notice,
    setNotice,
    resetKey,
    setResetKey,
    pendingCar,
    sidebar,
    feature,
    car,
    reset,
    selectFeature,
    selectVehicle,
    selectRoute,
    surprise,
  };
}
