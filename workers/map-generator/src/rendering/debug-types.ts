export type RenderPoint = [number, number];
export interface RenderRoute {
  id: string;
  shortName?: string;
  longName?: string;
  color?: string;
}
interface RenderPath {
  id: string;
  kind?: string;
  routeIds?: string[];
  points: RenderPoint[];
}
interface RenderInfrastructure {
  id: string;
  name?: string;
  kind?: string;
  points: RenderPoint[];
}
interface RenderStop {
  id: string;
  name?: string;
  x: number;
  y: number;
}

export interface DebugMapBundle {
  schemaVersion?: number;
  mode?: string;
  style?: string;
  generatorVersion?: string;
  generatedAt?: string;
  display: { width: number; height: number };
  routes?: RenderRoute[];
  paths?: RenderPath[];
  infrastructure?: RenderInfrastructure[];
  stops?: RenderStop[];
  graph?: {
    nodes: { id: string; x: number; y: number; edgeIds: string[] }[];
    edges: {
      id: string;
      routeIds: string[];
      infrastructureIds: string[];
      points: RenderPoint[];
    }[];
  };
  context?: {
    labels: { text: string; kind: string; angle: number; point: RenderPoint }[];
    shoreline: RenderPoint[];
    north: { angle: number };
  };
}
