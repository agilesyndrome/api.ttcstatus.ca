/** Public transit geography. These are agency boarding locations, never device positions. */
export interface StopPosition {
  stopId: string;
  latitude: number;
  longitude: number;
  accessible: boolean | null;
}

export interface BoardingStop extends StopPosition {
  name: string;
  parentStationId: string | null;
  services: {
    patternId: string;
    routeId: string;
    directionId: 0 | 1;
    headsign: string;
  }[];
}

export interface StopDirectory {
  format: 'ttc-stop-directory';
  schemaVersion: 1;
  networkVersion: number;
  stops: (BoardingStop & { displayFeatureId: string })[];
}
