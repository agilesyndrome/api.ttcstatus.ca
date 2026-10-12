import { projectToLocalMetres } from '../map/geometry';
import type { Location } from './types';

const CELL_METRES = 500;
const EARTH_METRES = 6_371_000;
const key = (x: number, y: number) => `${x}:${y}`;

/** A device-only candidate index. Cell keys are never API parameters or telemetry. */
export class LocalSpatialIndex<T extends Location> {
  private cells = new Map<string, T[]>();

  constructor(private points: T[]) {
    for (const point of points) {
      const [x, y] = projectToLocalMetres([point.latitude, point.longitude]);
      const cell = key(Math.floor(x / CELL_METRES), Math.floor(y / CELL_METRES));
      const bucket = this.cells.get(cell) ?? [];
      bucket.push(point);
      this.cells.set(cell, bucket);
    }
  }

  /** Include every cell intersecting the geographic radius, including neighbouring
   * quadrants. Exact Haversine ranking happens after this conservative lookup. */
  within(location: Location, radiusMetres: number): T[] {
    if (
      !Number.isFinite(location.latitude) ||
      !Number.isFinite(location.longitude) ||
      Math.abs(location.latitude) > 90 ||
      Math.abs(location.longitude) > 180 ||
      !(radiusMetres > 0) ||
      !Number.isFinite(radiusMetres)
    )
      return [];
    const radians = Math.PI / 180;
    const angle = radiusMetres / EARTH_METRES;
    const latitudeDelta = angle / radians;
    const ratio = Math.sin(angle) / Math.cos(location.latitude * radians);
    // Toronto's planar grid does not wrap at the date line or cover polar caps.
    // Falling back to the bounded directory preserves correctness outside Toronto.
    if (Math.abs(location.latitude) + latitudeDelta >= 90 || Math.abs(ratio) >= 1)
      return this.points;
    const longitudeDelta = Math.asin(Math.abs(ratio)) / radians;
    if (Math.abs(location.longitude) + longitudeDelta >= 180) return this.points;
    const [left, bottom] = projectToLocalMetres([
      location.latitude - latitudeDelta,
      location.longitude - longitudeDelta,
    ]);
    const [right, top] = projectToLocalMetres([
      location.latitude + latitudeDelta,
      location.longitude + longitudeDelta,
    ]);
    const found: T[] = [];
    for (
      let x = Math.floor(left / CELL_METRES);
      x <= Math.floor(right / CELL_METRES);
      x++
    ) {
      for (
        let y = Math.floor(bottom / CELL_METRES);
        y <= Math.floor(top / CELL_METRES);
        y++
      ) {
        found.push(...(this.cells.get(key(x, y)) ?? []));
      }
    }
    return found;
  }
}
