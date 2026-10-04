import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: npm run map:depot -- [map.json]

Print an offline route board from a local map bundle.
Defaults to data/fixtures/streetcarmap.json. No live service data is fetched.
Stops are display clusters; patterns are those retained in the input bundle.`);
} else {
  try {
    if (args.length > 1) throw new Error('Expected at most one local map filename.');
    const input = args[0] ?? 'data/fixtures/streetcarmap.json';
    const map = JSON.parse(await readFile(input, 'utf8'));
    for (const key of ['routes', 'patterns', 'stops']) {
      if (!Array.isArray(map?.[key])) throw new Error(`Map is missing its ${key} array.`);
    }

    const clean = (value) => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
    const rows = [...map.routes]
      .sort((a, b) =>
        String(a.shortName ?? a.id).localeCompare(String(b.shortName ?? b.id), 'en', {
          numeric: true,
        }),
      )
      .map((route) => [
        clean(route.shortName ?? route.id),
        clean(route.longName),
        String(map.stops.filter((stop) => stop.routeIds?.includes(route.id)).length),
        String(map.patterns.filter((pattern) => pattern.routeId === route.id).length),
      ]);
    const table = [['ROUTE', 'NAME', 'STOP CLUSTERS', 'PATTERNS'], ...rows];
    const widths = table[0].map((_, column) =>
      Math.max(...table.map((row) => row[column].length)),
    );

    console.log(`
          ___________________________
         | TTC | [] [] [] [] [] | [] |
         |_____|_______________|____|
            O O               O O
    ===================================
             THE OFFLINE DEPOT

Source: ${clean(input)}
Generated: ${clean(map.generatedAt ?? 'unknown')}
Snapshot only — not current service or departures.
`);
    for (const row of table) {
      console.log(
        row
          .map((cell, column) =>
            column < 2 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]),
          )
          .join('  ')
          .trimEnd(),
      );
    }
    console.log(`\n${rows.length} routes. All aboard — mind the closing doors!`);
  } catch (error) {
    console.error(`Depot board: ${error.message}`);
    process.exitCode = 1;
  }
}
