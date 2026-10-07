import type { ReactNode, RefObject } from 'react';
import type { Bounds, Feature, Point, ViewerData } from '../../../../shared/map/model';
import type { PlottedVehicle } from '../../../../shared/map/live-status';

export interface TransitMapControls {
  zoomBy(factor: number, clientPoint?: Point): void;
  followPoint(point: Point, width?: number): void;
  cancelGesture(): void;
}
export interface TransitMapProps {
  data: ViewerData;
  cars?: PlottedVehicle[];
  selectedRoute?: string;
  selectedFeature?: Feature;
  focusPoint?: Point;
  /** Relative map scale for a focus point; 2.5 shows a neighborhood, 5 is detail view. */
  focusPointLevel?: number;
  /** Keep the current zoom and center on this point, e.g. while following a car. */
  followPoint?: Point;
  showLabels?: boolean;
  /** Hide ordinary stop markers for lightweight game/map presentations. */
  showStops?: boolean;
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
  /** Fires instead of onInteract for zoom gestures, so zooming can keep following. */
  onZoomInteract?(): void;
  onExport?(): void;
  overlay?: ReactNode | ((scale: number) => ReactNode);
  mapTools?: ReactNode;
  driving?: boolean;
  mapId?: string;
  controlsRef?: RefObject<TransitMapControls | null>;
  onSelectFeature(feature: Feature): void;
  onSelectVehicle(car: PlottedVehicle): void;
}
