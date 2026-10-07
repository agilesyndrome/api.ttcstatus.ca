// The snake board builder lives in shared/map so the map-generator Worker can
// publish it as a map artifact alongside the schematic. Browser code (the game,
// tests and stories) still imports this module through the old path.
export * from '../../../../shared/map/game-map';
