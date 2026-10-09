import type { ReactNode, RefObject } from 'react';
import type { Bounds, Feature, Point, ViewerData } from '../../../../shared/map/model';
import type { PlottedVehicle } from '../../../../shared/map/live-status';
import type { TrackClosure } from './TrackClosures';

export interface TransitMapControls {
  zoomBy(factor: number, clientPoint?: Point): void;
  followPoint(point: Point, width?: number): void;
  cancelGesture(): void;
  /** The camera's current view width in map units (zoom level for callers). */
  cameraWidth(): number;
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
  /** Closed or obstructed segments, drawn over the tracks (game and app share this). */
  closures?: TrackClosure[];
  /** Camera width limits in map units, for callers whose zoom should be sized
   * by something on the map (the game sizes its zoom by streetcar length)
   * instead of by the map's own bounds. */
  zoomLimits?: { minWidth?: number; maxWidth?: number };
  /** Show the zoom/fit control overlay. The explorer hides it (gestures and
   * keyboard remain); the driving game keeps it as in-viewport HUD. */
  mapControls?: boolean;
  onInteract?(): void;
  /** Fires instead of onInteract for zoom gestures, so zooming can keep following. */
  onZoomInteract?(): void;
  overlay?: ReactNode | ((scale: number) => ReactNode);
  mapTools?: ReactNode;
  driving?: boolean;
  mapId?: string;
  controlsRef?: RefObject<TransitMapControls | null>;
  onSelectFeature(feature: Feature): void;
  onSelectVehicle(car: PlottedVehicle): void;
}
