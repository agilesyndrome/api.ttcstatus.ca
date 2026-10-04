export interface RouteRecord {
  routeId: string;
  shortName: string;
  longName: string;
  routeType: number;
  color: string;
  textColor: string;
  rowHash: string;
}

export interface PatternRecord {
  patternId: string;
  routeId: string;
  directionId: number;
  shapeId: string;
  headsign: string;
  representativeTripId: string;
  tripCount: number;
  rowHash: string;
}

export interface ShapeRecord {
  shapeId: string;
  points: Array<[number, number]>; // [lat, lon]
  rowHash: string;
}

export interface StopRecord {
  stopId: string;
  name: string;
  lat: number;
  lon: number;
  locationType: number;
  parentStation: string;
  wheelchairBoarding: number;
  rowHash: string;
}

export interface PatternStopRecord {
  patternId: string;
  stopId: string;
  sequence: number;
  rowHash: string;
}
