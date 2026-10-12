import type { Feature, ViewerSource } from './model';
import type { StopDirectory } from '../transit/stop-directory';

/** Index original records once; display grouping supplies identity, never location. */
export function buildStopDirectory(
  source: ViewerSource,
  features: Feature[],
): StopDirectory | undefined {
  if (
    source.networkVersion === undefined ||
    !source.stops.some((stop) => stop.boardingStops)
  )
    return;
  const boarding = new Map(
    source.stops.flatMap((stop) =>
      (stop.boardingStops ?? []).map((record) => [record.stopId, record] as const),
    ),
  );
  const displayed = new Map<string, string>();
  for (const feature of features) {
    for (const id of feature.stopIds ?? []) {
      // An agency record has one canonical directory entry even if a decorative
      // terminal label repeats its visual identity. Feature order is deterministic.
      if (!displayed.has(id)) displayed.set(id, feature.id);
    }
  }
  return {
    format: 'ttc-stop-directory',
    schemaVersion: 1,
    networkVersion: source.networkVersion,
    stops: [...displayed]
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([id, displayFeatureId]) => {
        const record = boarding.get(id);
        return record ? [{ ...record, displayFeatureId }] : [];
      }),
  };
}
