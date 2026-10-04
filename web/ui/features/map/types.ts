import type { ReactNode, RefObject } from 'react';
import type { Bounds, Feature, Point, ViewerData } from '../../../../shared/map/model';
import type { PlottedVehicle } from '../../../../shared/map/live-status';

export interface TransitMapControls {
  zoomBy(factor: number, clientPoint?: Point): void;
  cancelGesture(): void;
}
export interface TransitMapProps {
  data: ViewerData;
  cars?: PlottedVehicle[];
  selectedRoute?: string;
  selectedFeature?: Feature;
  focusPoint?: Point;
  showLabels?: boolean;
  includeOvernight?: boolean;
  showStreetcar?: boolean;
  showSubway?: boolean;
  resetKey?: number;
  savedStopIds?: string[];
  locationPoint?: Point;
  selectedVehicleId?: string;
  focusBounds?: Bounds;
  comparisonStops?: { from?: Feature; to?: Feature };
  pickingLabel?: string;
  onInteract?(): void;
  onExport?(): void;
  overlay?: ReactNode | ((scale: number) => ReactNode);
  mapTools?: ReactNode;
  driving?: boolean;
  mapId?: string;
  controlsRef?: RefObject<TransitMapControls | null>;
  onSelectFeature(feature: Feature): void;
  onSelectVehicle(car: PlottedVehicle): void;
}
