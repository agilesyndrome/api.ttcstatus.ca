import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

// Audits every switch on the derived snake board against the playability
// contract in docs/snake-intersection-review.md:
//   * short branch names ("Bathurst", never generated descriptive sentences)
//   * the [Left] button always goes left on screen (label matches geometry)
//   * one visible direction is one choice: no identical twin branches
//   * no four-option switches (duplicate-rail artifacts or u-turn padding)
//   * no night routes (3xx) on switch labels; labels read "501 Queen"
// Genuine same-side forks with clearly different angles (e.g. a hard left and
// a slight left) are printed for information: they are distinct real branches,
// and simplifying them is a track-data decision.
const compiled = await build({
  stdin: {
    contents: `export { buildViewerData } from './shared/map/model'; export { buildSnakeMap } from './shared/map/game-map'; export { SnakeEngine } from './web/ui/features/snake/engine';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
});
const { buildViewerData, buildSnakeMap, SnakeEngine } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);

const map = JSON.parse(await readFile('data/fixtures/streetcar-schematic.json', 'utf8'));
const { data } = buildSnakeMap(buildViewerData(map));
const engine = new SnakeEngine(data, {});

const routeNumbers = new Map(data.routes.map((route) => [route.id, route.number]));
const infraNames = new Map(data.infrastructure.map((item) => [item.id, item.name]));
const describe = (choice) => {
  const branch = data.edges.find((edge) => edge.id === choice.edgeId);
  const routes = (branch?.routeIds ?? [])
    .map((id) => routeNumbers.get(id) ?? id)
    .join('/');
  const names = (branch?.infrastructureIds ?? [])
    .map((id) => infraNames.get(id) ?? id)
    .join(', ');
  return {
    turn: choice.turn,
    angle: Math.round(choice.angle),
    label: choice.label,
    routes,
    names,
  };
};

let switches = 0;
const fourOptions = [];
const twins = [];
const nightRoutes = [];
const verboseNames = [];
const mismatches = [];
const sameSideForks = [];

for (const edge of data.edges) {
  for (const direction of [1, -1]) {
    const choices = engine.choices({ edgeId: edge.id, direction, distance: 0 });
    if (choices.length <= 1) continue;
    switches++;
    const node = direction === 1 ? edge.a : edge.b;
    const approach = `${edge.id} ${direction === 1 ? 'a->b' : 'b->a'} at ${node}`;
    const described = choices.map(describe);
    const where = (issue) => `${issue}: ${approach}`;

    // One visible direction is one choice; a four-option switch is a turnout
    // artifact, not a fork a child can read at arcade speed.
    if (choices.length >= 4) fourOptions.push(where(`${choices.length} options`));

    // Coincident duplicate rails must have been merged into one choice.
    for (let i = 1; i < choices.length; i++)
      if (Math.abs(choices[i].angle - choices[i - 1].angle) < 2.5)
        twins.push(
          where(
            `twin branches at ${Math.round(choices[i].angle)}° (${described[i].label})`,
          ),
        );

    // The label's direction must match the map-space angle the driver sees.
    for (const choice of choices) {
      const expected =
        Math.abs(choice.angle) >= 168
          ? 'uturn'
          : choice.angle < -24.1
            ? 'left'
            : choice.angle > 24.1
              ? 'right'
              : 'straight';
      if (choice.turn !== expected)
        mismatches.push(where(`label ${choice.turn} but geometry ${expected}`));

      const place = choice.label.replace(/^\[[^\]]*\]\s*/, '').replace(/^[←→↑↩]\s*/, '');
      if (/\b3\d\d\b/.test(choice.label))
        nightRoutes.push(where(`night route in "${choice.label}"`));
      if (place.split(/\s+/).filter(Boolean).length > 3 || /generated/i.test(place))
        verboseNames.push(where(`verbose name "${choice.label}"`));
    }

    // Informational: real branches that share a side but diverge by angle.
    const counts = {};
    for (const choice of choices) counts[choice.turn] = (counts[choice.turn] ?? 0) + 1;
    const shared = Object.entries(counts).filter(([, count]) => count > 1);
    if (shared.length)
      sameSideForks.push(
        `${approach}: ${shared.map(([turn, count]) => `${count}x ${turn}`).join(', ')}`,
      );
  }
}

assert.equal(fourOptions.length, 0, 'four-option switches are bad track design');
assert.equal(twins.length, 0, 'identical twin branches must merge into one choice');
assert.equal(nightRoutes.length, 0, 'night routes never appear on switch labels');
assert.equal(verboseNames.length, 0, 'switch names stay short');
assert.equal(mismatches.length, 0, 'a [Left] label always turns left on screen');

console.log(
  `Snake intersection checks passed: ${switches} switch approaches, ` +
    `${fourOptions.length} four-option turnouts, ${twins.length} twin branches, ` +
    `${nightRoutes.length} night-route labels, ${verboseNames.length} verbose names, ` +
    `${mismatches.length} direction mismatches.`,
);
if (sameSideForks.length) {
  console.log(
    `Informational: ${sameSideForks.length} genuine same-side forks (distinct angles, simplification is a track-data decision):`,
  );
  for (const fork of sameSideForks) console.log(`  ${fork}`);
}
