import {
  array,
  epoch,
  nullable,
  number,
  object,
  ref,
  revision,
  string,
  timestamp,
  version,
} from './schema';

export const liveSchemas = {
  LiveVehicle: object(
    {
      id: string,
      label: string,
      latitude: number,
      longitude: number,
      observedAt: nullable(timestamp),
      mode: { enum: ['streetcar', 'subway'] },
      positionKind: { enum: ['gps', 'next-station'] },
      nextStopName: string,
      arrivalAt: timestamp,
      routeId: string,
      tripId: string,
      bearing: number,
      speedMetresPerSecond: number,
    },
    ['id', 'label', 'latitude', 'longitude', 'observedAt'],
  ),
  SubwayPrediction: object({
    id: string,
    label: string,
    routeId: string,
    tripId: string,
    observedAt: nullable(timestamp),
    stops: array(object({ stopId: string, sequence: revision, arrivalAt: timestamp })),
  }),
  VehicleSnapshot: object(
    {
      schemaVersion: version,
      fetchedAt: timestamp,
      feedTimestamp: nullable(timestamp),
      source: string,
      attribution: string,
      vehicles: array(ref('LiveVehicle')),
      invalidPositions: revision,
      surfaceStatus: { enum: ['available', 'unavailable'] },
      subwayStatus: { enum: ['available', 'unavailable'] },
      subwaySource: string,
      subwayPredictions: array(ref('SubwayPrediction')),
    },
    [
      'schemaVersion',
      'fetchedAt',
      'feedTimestamp',
      'source',
      'attribution',
      'vehicles',
      'invalidPositions',
    ],
  ),
  Coverage: object({
    from: epoch,
    to: epoch,
    mode: { enum: ['streetcar', 'subway'] },
    kind: { enum: ['observable', 'outage', 'no-reports'] },
  }),
  ServiceState: object({
    stopId: string,
    directionId: { enum: [0, 1] },
    state: { enum: ['fresh', 'due', 'void', 'unmonitored', 'collecting'] },
    lastTouchAt: nullable(epoch),
    minutesSince: nullable(number),
    medianHeadwayOwnSeconds: nullable(number),
    irregularity: nullable(number),
    expectedWaitSeconds: nullable(number),
    dryness: nullable(number),
    backToBack: revision,
    routeIds: array(string),
    coverage: nullable(
      object({
        kind: { enum: ['observable', 'outage', 'no-reports'] },
        unmonitoredSeconds: number,
        since: nullable(epoch),
      }),
    ),
  }),
  // No ServiceStops schema: the endpoint is deleted (docs/optimize-overlay.md
  // E3S3) and the public stops payload lives as the CDN-published tick
  // document, which is not part of this API surface. ServiceState stays —
  // the shared per-stop vocabulary.
  ServiceWave: object({
    schemaVersion: version,
    windowStart: epoch,
    windowEnd: epoch,
    coverage: array(ref('Coverage')),
    routes: array(
      object({
        routeId: string,
        directionId: { enum: [0, 1] },
        patternStopIds: array(string),
        touches: array(
          object({
            stopIndex: revision,
            dt: epoch,
            vehicleId: string,
            directionId: { enum: [0, 1] },
            mode: { enum: ['streetcar', 'subway'] },
          }),
        ),
      }),
    ),
  }),
  ServiceHistory: object(
    {
      schemaVersion: version,
      from: epoch,
      to: epoch,
      summaries: array(
        object({
          stopId: string,
          n: revision,
          meanHeadwaySeconds: nullable(number),
          irregularity: nullable(number),
          maxGapSeconds: nullable(number),
          backToBack: revision,
          distinctVehicles: revision,
          routeIds: array(string),
          coverageRatio: number,
          medianApproxSeconds: nullable(number),
          p90ApproxSeconds: nullable(number),
        }),
      ),
      bucketSeries: array(
        object({
          stopId: string,
          buckets: array(
            object({
              bucketStart: epoch,
              n: revision,
              maxGapSeconds: number,
              backToBack: revision,
            }),
          ),
        }),
      ),
    },
    ['schemaVersion', 'from', 'to', 'summaries'],
  ),
};
