export interface MapFilterValues {
  live: boolean;
  labels: boolean;
  overnight: boolean;
  streetcar: boolean;
  subway: boolean;
}
export interface Location {
  latitude: number;
  longitude: number;
  accuracy?: number;
}
export type Selection = { kind: 'stop' | 'route' | 'car'; id: string };
export type SidebarPanel = 'explore' | 'journal' | 'badges';
export interface MapTools {
  panel?: SidebarPanel;
}
export interface MapLink extends MapTools {
  selection?: Selection;
  contextRoute?: string;
  filters: Partial<MapFilterValues>;
}
export const DEFAULT_FILTERS: MapFilterValues = {
  live: true,
  labels: false,
  overnight: false,
  streetcar: true,
  subway: true,
};
