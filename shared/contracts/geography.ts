import {
  array,
  boolean,
  nullable,
  number,
  object,
  ref,
  revision,
  string,
  version,
} from './schema';

export const geographySchemas = {
  Point: { ...array(number), minItems: 2, maxItems: 2 },
  StopPosition: object({
    stopId: string,
    latitude: { ...number, minimum: -90, maximum: 90 },
    longitude: { ...number, minimum: -180, maximum: 180 },
    accessible: nullable(boolean),
  }),
  StopService: object({
    patternId: string,
    routeId: string,
    directionId: { enum: [0, 1] },
    headsign: string,
  }),
  BoardingStop: {
    allOf: [
      ref('StopPosition'),
      object({
        name: string,
        parentStationId: nullable(string),
        services: array(ref('StopService')),
        displayFeatureId: string,
      }),
    ],
  },
  StopDirectory: object({
    format: { const: 'ttc-stop-directory' },
    schemaVersion: version,
    networkVersion: revision,
    stops: array(ref('BoardingStop')),
  }),
  GeographicTransform: object({
    version,
    rotationDegrees: number,
    xAxis: ref('WarpAxis'),
    yAxis: ref('WarpAxis'),
    minX: number,
    maxY: number,
    scaleX: number,
    scaleY: number,
    offsetX: number,
    offsetY: number,
    projection: object({
      latitude: number,
      longitude: number,
      metresPerLatitudeDegree: number,
      metresPerLongitudeDegree: number,
    }),
  }),
  WarpAxis: object({ lower: number, upper: number, outerScale: number }),
};
