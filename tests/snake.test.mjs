import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const compiled = await build({ stdin: { contents: `export * from './web/ui/snake/engine'; export { demoData } from './web/ui/stories/fixtures'; export { buildViewerData } from './web/map/model';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm' });
const { SnakeEngine, gameMissions, demoData, buildViewerData } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const edge = (id, a, b, sourcePoints, routeIds = ['501']) => ({ id, a, b, sourcePoints, points: sourcePoints.map(([x,y]) => [x+50,150-y]), routeIds, infrastructureIds: [], lengthMetres: Math.hypot(sourcePoints[1][0]-sourcePoints[0][0],sourcePoints[1][1]-sourcePoints[0][1]), sourceDistances: [0, Math.hypot(sourcePoints[1][0]-sourcePoints[0][0],sourcePoints[1][1]-sourcePoints[0][1])] });
const network = { ...demoData, edges: [edge('in', 'a', 'b', [[0,0],[100,0]]), edge('straight', 'b', 'c', [[100,0],[300,0]]), edge('left', 'b', 'd', [[100,0],[100,200]]), edge('right', 'b', 'e', [[100,0],[100,-200]])] };
const car = (id, edgeId = 'queen-edge', distance = 180, extra = {}) => ({ vehicle: { id, label: id }, match: { edgeId, distanceAlongMetres: distance, direction: 1 }, stale: false, ...extra });
function started(data = demoData, mode = 'arcade') {
  const engine = new SnakeEngine(data); engine.start(mode, [], undefined, () => .4);
  engine.position = { edgeId: data.edges[0].id, direction: 1, distance: 100 };
  engine.trail = []; engine.travelled = 0;
  return engine;
}
function drive(engine, seconds, cars = []) { for (let i = 0; i < seconds * 10; i++) engine.tick(.1, cars); }

test('arcade eats an actual fresh on-track car once, and retains its identity across snapshot updates', () => {
  const engine = started(); const cars = [car('4400'), car('stale','queen-edge',110,{stale:true}), car('off', 'queen-edge',110,{match:undefined})];
  drive(engine, 1.2, cars);
  assert.equal(engine.count, 2); assert.deepEqual([...engine.collected], ['4400']); assert.equal(engine.status, 'running');
  drive(engine, 1, [car('4400','queen-edge',200)]);
  assert.equal(engine.count, 2);
});

test('purist collision ends the game without growing; stale/off-track and opposite virtual rails cannot kill the player', () => {
  const engine = started(demoData, 'purist'); drive(engine, 4, [car('4400')]);
  assert.equal(engine.status, 'over'); assert.equal(engine.count, 1); assert.match(engine.message, /4400/);
  const safe = started(demoData, 'purist');
  drive(safe, 4, [car('stale','queen-edge',110,{stale:true}), car('off','queen-edge',110,{match:undefined}), { ...car('opposite','queen-edge',120), match: { ...car('opposite').match, distanceAlongMetres: 120, direction: -1 } }]);
  assert.equal(safe.status, 'running'); assert.equal(safe.count, 1);
});

test('arcade swept movement cannot tunnel through food at 2000 km/h, and motion uses metres rather than compressed pixels', () => {
  const compressed = { ...demoData, geographicTransform: { ...demoData.geographicTransform, scaleX: .1, scaleY: .1 }, edges: demoData.edges.map(edge => ({ ...edge, points: edge.points.map(([x,y]) => [x*.1,y*.1]) })) };
  const engine = started(compressed); engine.speed = 2000; engine.tick(.1, [car('fast','queen-edge',145)]);
  assert.equal(engine.count, 2); assert.ok(Math.abs(engine.position.distance - (100 + 2000/3.6*.1)) < .001);
});

test('pause freezes movement, speed limits apply by mode and brakes can stop the train', () => {
  const engine = started(demoData,'purist'); engine.pause(); engine.tick(.1,[],1); assert.equal(engine.position.distance,100);
  engine.pause(); engine.tick(.1,[],1); assert.equal(engine.speed,50);
  for(let i=0;i<10;i++) engine.tick(.1,[],-1);
  assert.equal(engine.speed,0); const atRest = engine.position.distance; drive(engine,1); assert.equal(engine.position.distance,atRest);
});

test('manual turnout choices and keyboard turn intents override automatic corridor continuity', () => {
  const engine = started(network); engine.position.distance = 80;
  assert.deepEqual(engine.choices().map(choice => choice.turn),['left','straight','right']);
  engine.queue('left'); drive(engine,.6); assert.equal(engine.position.edgeId,'left');
  const direct = started(network); direct.position.distance = 80; direct.queue('right'); drive(direct,.6); assert.equal(direct.position.edgeId,'right');
  const automatic = started(network); automatic.position.distance = 80; drive(automatic,.6); assert.equal(automatic.position.edgeId,'straight');
});

test('switch warning looks past degree-two geometry nodes and queued steering survives them', () => {
  const data = { ...network, edges: [edge('before','z','a',[[-100,0],[0,0]]), ...network.edges] };
  const engine = started(data); engine.position.distance=80;
  assert.equal(engine.upcoming().distance,120);
  engine.queue('left'); drive(engine,2.5); assert.equal(engine.position.edgeId,'left');
});

test('disconnected crossings stay disconnected; terminal turnbacks do not collide with an outbound tail', () => {
  const data = { ...demoData, edges: [edge('first','a','b',[[0,0],[200,0]]),edge('cross','c','d',[[100,-100],[100,100]])] };
  const engine = started(data); engine.count=3; engine.position.distance=120;
  drive(engine,5);
  assert.equal(engine.position.edgeId,'first'); assert.equal(engine.status,'running'); assert.equal(engine.position.direction,-1);
});

test('old tail samples kill an arcade run but never grow or kill a purist run', () => {
  const arcade = started(); arcade.count=4; arcade.travelled=100;
  arcade.trail=[{...arcade.pose(),travelled:10}]; arcade.tick(.01,[]);
  assert.equal(arcade.status,'over'); assert.match(arcade.message,/own train/);
  const purist=started(demoData,'purist'); purist.travelled=100; purist.trail=[{...purist.pose(),travelled:10}]; purist.tick(.01,[]);
  assert.equal(purist.status,'running'); assert.equal(purist.count,1);
});

test('missions follow ordered directed paths, award a terminal bonus and reverse on the same rails', () => {
  const refs=[{edgeId:'in',direction:1},{edgeId:'left',direction:1}];
  const mission={id:'mission',routeId:'501',label:'501 test',headsign:'Left terminal',refs};
  const engine=started(network); engine.start('arcade',[],mission,()=>0); engine.position={edgeId:'in',direction:1,distance:80}; engine.missionIndex=0;
  drive(engine,4.5); assert.equal(engine.position.edgeId,'left'); assert.equal(engine.position.direction,-1); assert.equal(engine.trips,1); assert.equal(engine.count,2);
  assert.deepEqual(engine.missionRefs,[{edgeId:'left',direction:-1},{edgeId:'in',direction:-1}]);
  const purist=started(network); purist.start('purist',[],mission,()=>0); purist.position={edgeId:'left',direction:1,distance:190}; purist.missionIndex=1; drive(purist,1);
  assert.equal(purist.trips,1); assert.equal(purist.count,1);
});

test('production viewer retains route paths and offers only connected actual service missions', async () => {
  const source=JSON.parse(await readFile('streetcar-schematic.json','utf8')); const data=buildViewerData(source);
  assert.deepEqual(data.paths[0].edgeRefs,source.paths[0].edgeRefs);
  const missions=gameMissions(data); assert.ok(missions.length>10); assert.ok(missions.some(mission=>mission.routeId==='501'));
  const disconnected={...network, patterns:[{routeId:'501',pathId:'bad',headsign:'Bad',stopIds:[]}],paths:[{id:'bad',routeIds:['501'],edgeRefs:[{edgeId:'in',direction:1},{edgeId:'left',direction:-1}]}]};
  assert.deepEqual(gameMissions(disconnected),[]);
});

test('legacy archive keeps the original simulation and art intact, with scoped links and PWA start URL', async () => {
  const html=await readFile('public/snake/v1/index.html','utf8'); const manifest=JSON.parse(await readFile('public/snake/v1/site.webmanifest','utf8'));
  assert.match(html,/src="\/snake\/v1\/game.js"/); assert.match(html,/href="\/snake\/v1\/styles.css"/);
  assert.equal(manifest.start_url,'/snake/v1/'); assert.equal(manifest.scope,'/snake/v1/');
  assert.ok(manifest.icons.every(icon=>icon.src.startsWith('/snake/v1/')));
  const js=await readFile('public/snake/v1/game.js','utf8'); assert.match(js,/MISSION_DEFS/); assert.match(js,/ttcSnakeResume/);
});

test('next-stop guidance follows the chosen switch over real graph nodes and never invents a connector', () => {
  const data={...network, features:[
    {...demoData.features[0],id:'forward',name:'Forward stop',edgeId:'straight',distanceAlongMetres:50},
    {...demoData.features[1],id:'turning',name:'Left stop',edgeId:'left',distanceAlongMetres:80},
  ]};
  const engine=started(data); engine.position.distance=70;
  assert.deepEqual(engine.nextStop(),{name:'Forward stop',metres:80});
  engine.queue('left'); assert.deepEqual(engine.nextStop(),{name:'Left stop',metres:110});
  engine.queue('right'); assert.equal(engine.nextStop(),undefined);
});
