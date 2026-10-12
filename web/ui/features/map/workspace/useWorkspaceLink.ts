import { useEffect, type Dispatch, type SetStateAction, type RefObject } from 'react';
import type { Bounds, Point, ViewerData } from '../../../../../shared/map/model';
import {
  DEFAULT_FILTERS,
  readMapLink,
  mapLinkHash,
  type Selection,
  type SidebarPanel,
  type MapFilterValues,
} from '../../../commute';
import {
  currentRoute,
  replaceMapHash,
  subscribeRoute,
} from '../../../services/navigation/history';

type Setter<T> = Dispatch<SetStateAction<T>>;
interface Options {
  data?: ViewerData;
  selection?: Selection;
  setSelection: Setter<Selection | undefined>;
  selectedRoute?: string;
  setSelectedRoute: Setter<string | undefined>;
  panel: SidebarPanel;
  setPanel: Setter<SidebarPanel>;
  filters: MapFilterValues;
  setFilters: Setter<MapFilterValues>;
  setNotice: Setter<string>;
  setFocusPoint: Setter<Point | undefined>;
  setFocusPointLevel: Setter<number | undefined>;
  setFocusBounds: Setter<Bounds | undefined>;
  setFollowing: Setter<boolean>;
  pendingCar: RefObject<string | undefined>;
}

export function useWorkspaceLink({
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
}: Options) {
  useEffect(() => {
    const restore = () => {
      const link = readMapLink(new URL(currentRoute(), 'https://ttcstatus.ca').hash);
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
    if (new URL(currentRoute(), 'https://ttcstatus.ca').hash) restore();
    return subscribeRoute(() => {
      const path = new URL(currentRoute(), 'https://ttcstatus.ca').pathname;
      if (path === '/' || path === '/snake' || path === '/snake/v2') restore();
    });
  }, []);
  useEffect(() => {
    if (!data) return;
    replaceMapHash(mapLinkHash(selection, filters, selectedRoute, { panel }));
  }, [data, selection, filters, selectedRoute, panel]);
}
