/*
 * TTC Streetcar Snake
 * -------------------
 * Game runtime for the canvas world, track graph, train simulation, rendering,
 * input, audio, persistence, and the start/resume UI.
 *
 * High-level map:
 *   1. World model and geometry data
 *   2. Geometry helpers and cached paths
 *   3. Game state and persistence
 *   4. Stops, missions, pickups, and events
 *   5. Track movement and switching
 *   6. Collision and disruption simulation
 *   7. Camera and rendering
 *   8. Input and UI lifecycle
 */

(() => {
  "use strict";

  // -------------------------------------------------------------------------
  // World model
  // -------------------------------------------------------------------------
  // The track graph is hand-simplified from TTC's 2026 streetcar map and
  // projected from latitude/longitude into metres. It is intentionally not a
  // survey-grade GIS model: the goal is recognizable topology + physical scale.

  const CAR_LENGTH_M = 30.20;
  const CAR_WIDTH_M = 2.54;
  const COUPLER_GAP_M = 1.50;
  const CAR_SPACING_M = CAR_LENGTH_M + COUPLER_GAP_M;
  // The map stores a street corridor centreline. Render each travel direction
  // on its own virtual rail so terminal turnbacks do not drive straight through
  // the inbound consist.
  const TRACK_LANE_OFFSET_M = 3.2;
  const REALISTIC_GOVERNOR_KPH = 50;
  const ARCADE_GOVERNOR_KPH = 2000; // Arcade: geography is now optional.
  const FLEXITY_RATED_MAX_KPH = 70;
  const MODE_START_SPEED_KPH = {
    realistic: 50,
    arcade: 180,
  };
  const PICKUP_COUNT = 8;
  const OPENING_PICKUP_SECONDS_AHEAD = 6.5;
  const OPENING_ASSIST_REFRESH_MS = 9000;
  const REF_LAT = 43.6500;
  const REF_LON = -79.3900;
  const METERS_PER_DEG_LAT = 111320;
  const METERS_PER_DEG_LON = METERS_PER_DEG_LAT * Math.cos(REF_LAT * Math.PI / 180);

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const mini = document.getElementById("minimap");
  const mctx = mini.getContext("2d");
  const carsStat = document.getElementById("carsStat");
  const joinedStat = document.getElementById("joinedStat");
  const bestStat = document.getElementById("bestStat");
  const lengthStat = document.getElementById("lengthStat");
  const speedStat = document.getElementById("speedStat");
  const locationHud = document.getElementById("locationHud");
  const tip = document.getElementById("tip");
  const overlay = document.getElementById("overlay");
  const startBtn = document.getElementById("startBtn");
  const resumeBtn = document.getElementById("resumeBtn");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayHero = document.getElementById("overlayHero");
  const overlayLead = document.getElementById("overlayLead");
  const overlayRules = document.getElementById("overlayRules");
  const overlayStatus = document.getElementById("overlayStatus");
  const overlayExtra = document.getElementById("overlayExtra");
  const overlayJoke = document.getElementById("overlayJoke");
  const aboutBtn = document.getElementById("aboutBtn");
  const aboutPanel = document.getElementById("aboutPanel");
  const missionHud = document.getElementById("missionHud");
  const missionRoute = document.getElementById("missionRoute");
  const missionText = document.getElementById("missionText");
  const switchPanel = document.getElementById("switchPanel");
  const switchMeta = document.getElementById("switchMeta");
  const switchChoices = document.getElementById("switchChoices");
  const eventBanner = document.getElementById("eventBanner");
  const gameModeSelect = document.getElementById("gameModeSelect");
  const operatorModeSelect = document.getElementById("operatorModeSelect");
  const accelerator = document.getElementById("accelerator");
  const brake = document.getElementById("brake");
  const muteSounds = document.getElementById("muteSounds");

  let dpr = 1;
  let W = 0;
  let H = 0;
  let mW = 0;
  let mH = 0;

  // Resize both canvases and reset their drawing scale for the device pixel ratio.
  function resizeCanvas(canvasElement, width, height, context, setCssSize = true) {
    canvasElement.width = Math.round(width * dpr);
    canvasElement.height = Math.round(height * dpr);
    if (setCssSize) {
      canvasElement.style.width = width + "px";
      canvasElement.style.height = height + "px";
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth;
    H = innerHeight;
    resizeCanvas(canvas, W, H, ctx);

    const mr = mini.getBoundingClientRect();
    mW = mr.width;
    mH = mr.height;
    resizeCanvas(mini, mW, mH, mctx, false);
  }
  addEventListener("resize", resize);
  resize();

  function project(lat, lon) {
    // A flat map is enough here: Toronto is small compared with the planet.
    return {
      x: (lon - REF_LON) * METERS_PER_DEG_LON,
      y: (REF_LAT - lat) * METERS_PER_DEG_LAT,
    };
  }

  const nodes = new Map();
  const edges = [];
  const adjacency = new Map();

  // Add a named point to the track graph.
  function N(id, label, lat, lon, type = "junction") {
    const p = project(lat, lon);
    const n = { id, label, lat, lon, type, x: p.x, y: p.y };
    nodes.set(id, n);
    adjacency.set(id, []);
    return n;
  }

  // Add a track segment and connect it to both endpoint lists.
  function E(id, aId, bId, tags = [], via = []) {
    const a = nodes.get(aId);
    const b = nodes.get(bId);
    const pts = [
      [a.lat, a.lon],
      ...via,
      [b.lat, b.lon],
    ].map(([lat, lon]) => project(lat, lon));
    const { cum, len } = measurePath(pts);

    const edge = { id, a: aId, b: bId, tags, pts, cum, len };
    edges.push(edge);
    adjacency.get(aId).push(edge);
    adjacency.get(bId).push(edge);
    return edge;
  }

  // Store distance at every point so later movement can use a single distance value.
  function measurePath(points) {
    const cum = [0];
    let len = 0;
    for (let i = 1; i < points.length; i++) {
      len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      cum.push(len);
    }
    return { cum, len };
  }

  // Queen / Queensway / Lake Shore West.
  N("longBranch", "Long Branch Loop", 43.5912, -79.5448, "loop");
  N("humber", "Humber Loop", 43.6370, -79.4915, "loop");
  N("roncyHub", "Queen / Roncesvalles", 43.6393, -79.4462);
  N("queenDufferin", "Queen / Dufferin", 43.6436, -79.4274);
  N("queenBathurst", "Queen / Bathurst", 43.6468, -79.4042);
  N("queenSpadina", "Queen / Spadina", 43.6488, -79.3957);
  N("queenYork", "Queen / York", 43.6512, -79.3838);
  N("queenYonge", "Queen / Yonge", 43.6526, -79.3790);
  N("queenChurch", "Queen / Church", 43.6535, -79.3752);
  N("queenParliament", "Queen / Parliament", 43.6563, -79.3642);
  N("queenBroadview", "Queen / Broadview", 43.6581, -79.3508);
  N("queenLeslie", "Queen / Leslie", 43.6627, -79.3326);
  N("queenCoxwell", "Queen / Coxwell", 43.6666, -79.3165);
  N("queenKingston", "Queen / Kingston", 43.6688, -79.3069);
  N("neville", "Neville Park Loop", 43.6736, -79.2812, "loop");

  E("lakeShoreWest", "longBranch", "humber", ["501", "507", "508"], [
    [43.5960, -79.5340], [43.6040, -79.5200], [43.6145, -79.5050],
    [43.6250, -79.4945], [43.6330, -79.4910],
  ]);
  E("queensway", "humber", "roncyHub", ["501", "508"], [
    [43.6388, -79.4790], [43.6393, -79.4650], [43.6390, -79.4540],
  ]);
  E("queen1", "roncyHub", "queenDufferin", ["501"]);
  E("queen2", "queenDufferin", "queenBathurst", ["501"]);
  E("queen3", "queenBathurst", "queenSpadina", ["501"]);
  E("queen4", "queenSpadina", "queenYork", ["501"]);
  E("queen5", "queenYork", "queenYonge", ["501"]);
  E("queen6", "queenYonge", "queenChurch", ["501"]);
  E("queen7", "queenChurch", "queenParliament", ["501"]);
  E("queen8", "queenParliament", "queenBroadview", ["501"]);
  E("queen9", "queenBroadview", "queenLeslie", ["501"]);
  E("queen10", "queenLeslie", "queenCoxwell", ["501"]);
  E("queen11", "queenCoxwell", "queenKingston", ["501", "503"]);
  E("queen12", "queenKingston", "neville", ["501", "503"], [[43.6710, -79.2960]]);

  // King + Distillery / Cherry.
  N("kingDufferin", "King / Dufferin", 43.6401, -79.4270);
  N("kingBathurst", "King / Bathurst", 43.6430, -79.4027);
  N("kingSpadina", "King / Spadina", 43.6450, -79.3950);
  N("kingYork", "King / York", 43.6467, -79.3835);
  N("kingYonge", "King / Yonge", 43.6488, -79.3778);
  N("kingChurch", "King / Church", 43.6498, -79.3737);
  N("kingParliament", "King / Parliament", 43.6523, -79.3636);
  N("kingSumach", "King / Sumach", 43.6530, -79.3568);
  N("distillery", "Distillery Loop", 43.6505, -79.3592, "loop");

  E("king1", "roncyHub", "kingDufferin", ["504", "508"]);
  E("king2", "kingDufferin", "kingBathurst", ["504", "508"]);
  E("king3", "kingBathurst", "kingSpadina", ["504", "508"]);
  E("king4", "kingSpadina", "kingYork", ["504", "508"]);
  E("king5", "kingYork", "kingYonge", ["504", "508"]);
  E("king6", "kingYonge", "kingChurch", ["504", "508"]);
  E("king7", "kingChurch", "kingParliament", ["504"]);
  E("king8", "kingParliament", "kingSumach", ["504"]);
  E("cherry", "kingSumach", "distillery", ["504A"], [[43.6510, -79.3553]]);

  // Roncesvalles + Dundas.
  N("roncyDundas", "Dundas / Roncesvalles", 43.6518, -79.4496);
  N("dundasWest", "Dundas West Station", 43.6566, -79.4523, "station");
  N("dundasOssington", "Dundas / Ossington", 43.64935, -79.42072);
  N("dundasBathurst", "Dundas / Bathurst", 43.6517, -79.4062);
  N("dundasSpadina", "Dundas / Spadina", 43.6532, -79.3980);
  N("dundasYonge", "Dundas / Yonge", 43.6561, -79.3802);
  N("dundasChurch", "Dundas / Church", 43.6570, -79.3762);
  N("dundasParliament", "Dundas / Parliament", 43.6606, -79.3680);
  N("dundasBroadview", "Dundas / Broadview", 43.6632, -79.3570);

  E("roncySouth", "roncyHub", "roncyDundas", ["504"], [[43.6450, -79.4480]]);
  E("roncyNorth", "roncyDundas", "dundasWest", ["504", "505"]);
  E("dundas1w", "dundasWest", "dundasOssington", ["505"], [
    [43.6540, -79.4440], [43.6515, -79.4300],
  ]);
  E("dundas1e", "dundasOssington", "dundasBathurst", ["505"], [
    [43.6508, -79.4160],
  ]);
  E("dundas2", "dundasBathurst", "dundasSpadina", ["505"]);
  E("dundas3", "dundasSpadina", "dundasYonge", ["505"]);
  E("dundas4", "dundasYonge", "dundasChurch", ["505"]);
  E("dundas5", "dundasChurch", "dundasParliament", ["505"]);
  E("dundas6", "dundasParliament", "dundasBroadview", ["505"]);

  // College / Carlton / Gerrard + Main Street.
  N("highPark", "High Park Loop", 43.6542, -79.4560, "loop");
  N("collegeOssington", "College / Ossington", 43.65436, -79.42275);
  N("collegeBathurst", "College / Bathurst", 43.6564, -79.4072);
  N("collegeSpadina", "College / Spadina", 43.6577, -79.3992);
  N("collegeYonge", "College / Yonge", 43.6617, -79.3832);
  N("carltonChurch", "Carlton / Church", 43.6625, -79.3771);
  N("gerrardParliament", "Gerrard / Parliament", 43.6632, -79.3690);
  N("gerrardBroadview", "Gerrard / Broadview", 43.6660, -79.3529);
  N("gerrardCoxwell", "Gerrard / Coxwell", 43.6726, -79.3190);
  N("gerrardMain", "Gerrard / Main", 43.6815, -79.3011);
  N("mainStation", "Main Street Station", 43.6891, -79.3010, "station");

  E("highParkConn", "highPark", "roncyDundas", ["506"], [[43.6530, -79.4540]]);
  E("collegeWestW", "roncyDundas", "collegeOssington", ["506"], [
    [43.6540, -79.4400],
  ]);
  E("collegeWestE", "collegeOssington", "collegeBathurst", ["506"], [
    [43.6560, -79.4140],
  ]);

  // Ossington Avenue retains streetcar track between College and Dundas.
  // It carries no regular route here, but TTC still uses it for diversions.
  E("ossingtonDiversion", "dundasOssington", "collegeOssington", ["track", "diversion"]);

  E("college1", "collegeBathurst", "collegeSpadina", ["506"]);
  E("college2", "collegeSpadina", "collegeYonge", ["506"]);
  E("carlton", "collegeYonge", "carltonChurch", ["506"]);
  E("gerrard1", "carltonChurch", "gerrardParliament", ["506"]);
  E("gerrard2", "gerrardParliament", "gerrardBroadview", ["506"]);
  E("gerrard3", "gerrardBroadview", "gerrardCoxwell", ["506"], [
    [43.6681, -79.3440], [43.6700, -79.3330],
  ]);
  E("gerrard4", "gerrardCoxwell", "gerrardMain", ["506"], [[43.6770, -79.3090]]);
  E("mainTrack", "gerrardMain", "mainStation", ["506"]);

  // Broadview surface connection.
  N("kingBroadview", "King / Broadview", 43.6544, -79.3547);
  N("broadviewStation", "Broadview Station", 43.6769, -79.3588, "station");
  E("kingToBroadview", "kingSumach", "kingBroadview", ["504B"]);
  E("broadviewQK", "kingBroadview", "queenBroadview", ["504B"]);
  E("broadviewQD", "queenBroadview", "dundasBroadview", ["504B", "505"]);
  E("broadviewDG", "dundasBroadview", "gerrardBroadview", ["504B", "505"]);
  E("broadviewNorth", "gerrardBroadview", "broadviewStation", ["504B", "505"]);

  // Kingston Road to Bingham.
  N("bingham", "Bingham Loop", 43.6800, -79.2894, "loop");
  E("kingston", "queenKingston", "bingham", ["503"], [
    [43.6710, -79.3040], [43.6742, -79.2990], [43.6772, -79.2940],
  ]);

  // Coxwell is useful diversion / carhouse-access trackage.
  E("coxwell", "queenCoxwell", "gerrardCoxwell", ["track"]);

  // St Clair, Bathurst, and Hillcrest / Harvey Shop.
  N("gunns", "Gunns Loop", 43.6738, -79.4664, "loop");
  N("stClairLansdowne", "St Clair / Lansdowne", 43.6754, -79.4501);
  N("stClairBathurst", "St Clair / Bathurst", 43.6828, -79.4177);
  N("stClairYonge", "St Clair Station", 43.6882, -79.3944, "station");
  N("bathurstStation", "Bathurst Station", 43.6662, -79.4110, "station");
  N("bathurstDavenport", "Bathurst / Davenport", 43.6743, -79.4140);
  N("harvey", "Harvey Shop / Hillcrest", 43.6753, -79.4146, "carhouse");

  E("stclair1", "gunns", "stClairLansdowne", ["512"]);
  E("stclair2", "stClairLansdowne", "stClairBathurst", ["512"], [[43.6790, -79.4350]]);
  E("stclair3", "stClairBathurst", "stClairYonge", ["512"], [[43.6860, -79.4050]]);
  E("bathurstNorth", "stClairBathurst", "bathurstDavenport", ["511"]);
  E("bathurstStationN", "bathurstDavenport", "bathurstStation", ["511"]);
  E("bathurstCollege", "bathurstStation", "collegeBathurst", ["511"]);
  E("bathurstDundas", "collegeBathurst", "dundasBathurst", ["511"]);
  E("bathurstQueen", "dundasBathurst", "queenBathurst", ["511"]);
  E("bathurstKing", "queenBathurst", "kingBathurst", ["511"]);
  E("hillcrestSpur", "bathurstDavenport", "harvey", ["yard"]);

  // Spadina.
  N("spadinaStation", "Spadina Station", 43.6678, -79.4039, "station");
  N("spadinaQQ", "Spadina / Queens Quay", 43.6380, -79.3914);
  E("spadina1", "spadinaStation", "collegeSpadina", ["510"]);
  E("spadina2", "collegeSpadina", "dundasSpadina", ["510"]);
  E("spadina3", "dundasSpadina", "queenSpadina", ["510"]);
  E("spadina4", "queenSpadina", "kingSpadina", ["510"]);
  E("spadina5", "kingSpadina", "spadinaQQ", ["510"], [[43.6410, -79.3930]]);

  // Harbourfront / Fleet / Union / Dufferin Gate.
  N("bathurstFleet", "Bathurst / Fleet", 43.6370, -79.4006);
  N("exhibition", "Exhibition Loop", 43.6352, -79.4165, "loop");
  N("dufferinGate", "Dufferin Gate Loop", 43.6348, -79.4264, "loop");
  N("queensQuayBay", "Queens Quay Station", 43.6413, -79.3779, "station");
  N("union", "Union Station Loop", 43.6452, -79.3807, "station");

  E("bathurstFleetConn", "kingBathurst", "bathurstFleet", ["511"], [[43.6402, -79.4017]]);
  E("fleetWest", "bathurstFleet", "exhibition", ["509", "511"]);
  E("exhDufferin", "exhibition", "dufferinGate", ["track"], [[43.6345, -79.4210]]);
  E("dufferinSouth", "kingDufferin", "dufferinGate", ["track"]);
  E("qqWest", "exhibition", "spadinaQQ", ["509"], [
    [43.6360, -79.4100], [43.6370, -79.4010], [43.6378, -79.3950],
  ]);
  E("qqEast", "spadinaQQ", "queensQuayBay", ["509", "510"], [[43.6392, -79.3845]]);
  E("bayTunnel", "queensQuayBay", "union", ["509", "510"]);

  // Downtown diversion / special-work grid represented on TTC's streetcar map.
  N("richmondYork", "Richmond / York", 43.6504, -79.3840);
  N("richmondChurch", "Richmond / Church", 43.6527, -79.3747);
  N("adelaideSpadina", "Adelaide / Spadina", 43.6439, -79.3945);
  N("adelaideYork", "Adelaide / York", 43.6460, -79.3833);
  N("adelaideChurch", "Adelaide / Church", 43.6483, -79.3738);
  N("wellingtonYork", "Wellington / York", 43.6446, -79.3827);
  N("wellingtonChurch", "Wellington / Church", 43.6468, -79.3730);

  E("yorkQueenRichmond", "queenYork", "richmondYork", ["diversion"]);
  E("yorkRichmondAdelaide", "richmondYork", "adelaideYork", ["diversion"]);
  E("yorkAdelaideKing", "adelaideYork", "kingYork", ["diversion"]);
  E("spadinaAdelaide", "kingSpadina", "adelaideSpadina", ["diversion"]);
  E("adelaide1", "adelaideSpadina", "adelaideYork", ["diversion"]);
  E("adelaide2", "adelaideYork", "adelaideChurch", ["diversion"]);
  E("churchAdelaideWellington", "adelaideChurch", "wellingtonChurch", ["diversion"]);
  E("churchWellingtonKing", "wellingtonChurch", "kingChurch", ["diversion"]);
  E("churchKingQueen", "kingChurch", "queenChurch", ["diversion"]);
  E("richmondChurchQueen", "richmondChurch", "queenChurch", ["diversion"]);
  E("richmondYorkChurch", "richmondYork", "richmondChurch", ["diversion"]);
  E("wellingtonYorkChurch", "wellingtonYork", "wellingtonChurch", ["diversion"]);
  E("yorkKingWellington", "kingYork", "wellingtonYork", ["diversion"]);

  // Carhouses / barns. Yard ladders are compressed into single playable spurs.
  N("roncyCarhouse", "Roncesvalles Carhouse", 43.6380, -79.4469, "carhouse");
  N("russell", "Russell Carhouse", 43.6643, -79.3246, "carhouse");
  N("leslieBarns", "Leslie Barns", 43.6530, -79.3272, "carhouse");
  N("leslieLakeShore", "Leslie / Lake Shore", 43.6580, -79.3290);

  E("roncyYard", "roncyHub", "roncyCarhouse", ["yard"]);
  E("russellYard", "queenLeslie", "russell", ["yard"], [[43.6638, -79.3290]]);
  E("leslieTrack", "queenLeslie", "leslieLakeShore", ["yard"]);
  E("leslieYard", "leslieLakeShore", "leslieBarns", ["yard"]);

  // Derived terminal audit. All explicit loops/stations/carhouses plus every
  // degree-1 endpoint are eligible for protected same-edge reversals.
  const TURNBACK_TERMINALS = [...nodes.values()]
    .filter((node) =>
      ["loop", "station", "carhouse"].includes(node.type) ||
      (adjacency.get(node.id) || []).length === 1
    )
    .map((node) => node.id);

  // Route missions use current TTC terminal pairs, while the track geometry
  // remains deliberately simplified for playability.
  const MISSION_DEFS = [
    { route: "501", name: "QUEEN", a: "humber", b: "neville", aEdge: "queensway", bEdge: "queen12" },
    { route: "504A", name: "KING", a: "dundasWest", b: "distillery", aEdge: "roncyNorth", bEdge: "cherry" },
    { route: "504B", name: "KING", a: "dufferinGate", b: "broadviewStation", aEdge: "dufferinSouth", bEdge: "broadviewNorth" },
    { route: "505", name: "DUNDAS", a: "dundasWest", b: "broadviewStation", aEdge: "roncyNorth", bEdge: "broadviewNorth" },
    { route: "506", name: "CARLTON", a: "highPark", b: "mainStation", aEdge: "highParkConn", bEdge: "mainTrack" },
    { route: "509", name: "HARBOURFRONT", a: "exhibition", b: "union", aEdge: "qqWest", bEdge: "bayTunnel" },
    { route: "510A", name: "SPADINA", a: "spadinaStation", b: "union", aEdge: "spadina1", bEdge: "bayTunnel" },
    { route: "511", name: "BATHURST", a: "bathurstStation", b: "exhibition", aEdge: "bathurstCollege", bEdge: "fleetWest" },
    { route: "512", name: "ST CLAIR", a: "gunns", b: "stClairYonge", aEdge: "stclair1", bEdge: "stclair3" },
  ];

  const ROAD_MARKERS = [
    // East-west corridors.
    ["ST CLAIR AVE W", 43.6802, -79.4460, 0, 1],
    ["ST CLAIR AVE W", 43.6851, -79.4080, 0, 2],
    ["COLLEGE ST", 43.6569, -79.4110, 0, 1],
    ["CARLTON ST", 43.6621, -79.3810, 0, 1],
    ["GERRARD ST E", 43.6687, -79.3430, 0, 1],
    ["DUNDAS ST W", 43.6526, -79.4220, 0, 1],
    ["DUNDAS ST W", 43.6554, -79.3890, 0, 2],
    ["QUEEN ST W", 43.6465, -79.4140, 0, 1],
    ["QUEEN ST W", 43.6506, -79.3870, 0, 2],
    ["QUEEN ST E", 43.6590, -79.3480, 0, 1],
    ["KING ST W", 43.6422, -79.4140, 0, 1],
    ["KING ST W", 43.6462, -79.3870, 0, 2],
    ["KING ST E", 43.6522, -79.3620, 0, 1],
    ["QUEENS QUAY W", 43.6382, -79.3950, 0, 1],
    ["LAKE SHORE BLVD W", 43.6070, -79.5160, 0, 1],
    ["THE QUEENSWAY", 43.6385, -79.4720, 0, 1],
    ["KINGSTON RD", 43.6750, -79.2990, 0, 1],

    // North-south corridors.
    ["RONCESVALLES AVE", 43.6450, -79.4485, -Math.PI / 2, 1],
    ["DUFFERIN ST", 43.6392, -79.4270, -Math.PI / 2, 2],
    ["OSSINGTON AVE", 43.6520, -79.4217, -Math.PI / 2, 2],
    ["BATHURST ST", 43.6570, -79.4085, -Math.PI / 2, 1],
    ["SPADINA AVE", 43.6510, -79.3970, -Math.PI / 2, 1],
    ["YORK ST", 43.6485, -79.3837, -Math.PI / 2, 2],
    ["CHURCH ST", 43.6540, -79.3748, -Math.PI / 2, 2],
    ["PARLIAMENT ST", 43.6570, -79.3660, -Math.PI / 2, 2],
    ["BROADVIEW AVE", 43.6665, -79.3560, -Math.PI / 2, 1],
    ["COXWELL AVE", 43.6692, -79.3175, -Math.PI / 2, 2],
    ["LESLIE ST", 43.6598, -79.3310, -Math.PI / 2, 1],
  ].map(([label, lat, lon, angle, priority]) => ({
    label,
    ...project(lat, lon),
    angle,
    priority,
  }));

  const WATER_LABELS = [
    ["LAKE ONTARIO", 43.6230, -79.3900],
  ].map(([label, lat, lon]) => ({ label, ...project(lat, lon) }));

  // Geographic streetcar-stop seed data. Directional/platform records are
  // snapped and deduplicated onto the game's simplified rail geometry below.
  // Source snapshot: Toronto streetcar stop GeoJSON; current TTC 2026 route
  // pages / City stop data are used as naming and network sanity checks.
  const STREETCAR_STOP_RAW = [["Dundas St West at Bloor St West",43.656442,-79.452572,["504"]],["Dundas St West at Dundas West Outer Platform",43.656768,-79.453253,["505"]],["Edna Ave at Dundas St West",43.657134,-79.453027,["504","505"]],["King St West at Strachan Ave",43.641936,-79.412095,["504"]],["Exhibition Loop at Manitoba Dr",43.636511,-79.41471,["509"]],["Exhibition Loop",43.636331,-79.415373,["511"]],["Humber Loop at The Queensway",43.631002,-79.47873,["501"]],["Queens Quay Loop at Lower Spadina Ave",43.638419,-79.39184,["510"]],["Queen St East at Kingston Rd",43.667029,-79.312948,["501"]],["Main St at Danforth Ave",43.688037,-79.301635,["506"]],["Main St at Gerrard St East",43.684182,-79.300207,["506"]],["Parliament St at Carlton St",43.663906,-79.36772,["506"]],["Parliament St at Gerrard St East",43.662048,-79.367169,["506"]],["Fleet St at Bathurst St",43.63647,-79.400131,["509","511"]],["Front St East at Berkeley St",43.651396,-79.363737,["504"]],["Gerrard St East at Blackburn St",43.664667,-79.355383,["506"]],["Queen St West at Soho St",43.649465,-79.393288,["501"]],["Queen St East at Jones Ave",43.662783,-79.332569,["501"]],["Queen St East at Emdaabiimok Ave",43.666193,-79.316789,["501"]],["Gerrard St East at Norwood Rd",43.683463,-79.302731,["506"]],["King St West at Spencer Ave",43.638134,-79.430997,["504"]],["King St West at Tecumseth St",43.643488,-79.405049,["504"]],["Gerrard St East at Bowmore Rd",43.677874,-79.315075,["506"]],["Gerrard St East at Marjory Ave",43.668855,-79.337448,["506"]],["Roncesvalles Ave at Fermanagh Ave",43.646167,-79.448917,["504"]],["College St at Spadina Ave",43.657863,-79.400435,["506"]],["Carlton St at Church St",43.661975,-79.37919,["506"]],["Queens Quay West at Bathurst St East Side Billy Bishop Airport",43.636048,-79.397767,["509"]],["College St at Dufferin St",43.652635,-79.432423,["506"]],["Dundas St East at River St",43.661284,-79.358,["501","505"]],["Dundas St West at Dufferin St",43.649587,-79.431565,["505"]],["Bathurst St at Queen St West",43.647375,-79.404131,["511"]],["Queen St East at Carroll St",43.658422,-79.352103,["504"]],["Lake Shore Blvd West at Thirty Seventh St",43.593334,-79.538348,["501"]],["Queen St West at O'Hara Ave",43.641174,-79.434064,["501"]],["Roncesvalles Ave at Boustead Ave South Side",43.653079,-79.45167,["504"]],["Gerrard St East at Prust Ave",43.670451,-79.330316,["506"]],["Spadina Ave at Dundas St West North Side",43.653388,-79.398172,["510"]],["King St East at River St",43.657079,-79.35597,["504"]],["Queen St East at Greenwood Ave",43.664452,-79.325179,["501"]],["Dundas St West at Sorauren Ave",43.651198,-79.445012,["505","506"]],["Gerrard St East at Glenmount Park Rd",43.682547,-79.306185,["506"]],["Dundas St West at Spadina Ave",43.653064,-79.397708,["505"]],["Roncesvalles Ave at Boustead Ave North Side",43.653173,-79.451549,["504"]],["Opposite 2111 Lake Shore Blvd West",43.628942,-79.478392,["501"]],["Lake Shore Blvd West at Twenty Eighth St",43.595685,-79.527699,["501"]],["Lake Shore Blvd West at Tenth St",43.600155,-79.508496,["501"]],["Queen St East at Sarah Ashbridge Ave",43.667893,-79.309305,["501"]],["Gerrard St East at Kingsmount Park Rd",43.67986,-79.312662,["506"]],["Spadina Ave at Sullivan St North Side",43.651288,-79.397326,["510"]],["Queens Quay West at Dan Leckie Way West Side",43.636492,-79.397299,["509"]],["Queen St East at Parliament St",43.655473,-79.364679,["501"]],["Lake Shore Blvd West at Third St",43.601881,-79.500644,["501"]],["Dundas St West at Sheridan Ave",43.649721,-79.433841,["505"]],["King St East at Parliament St",43.65291,-79.363021,["504"]],["King St West at Dowling Ave",43.636552,-79.438719,["504"]],["College St at Bathurst St",43.656336,-79.407836,["506"]],["Dundas St West at Dovercourt Rd",43.649365,-79.424889,["505"]],["College St at McCaul St",43.659061,-79.393721,["506"]],["St Clair Ave West at Avenue Rd East Side",43.686666,-79.400882,["512"]],["Queens Quay/Ferry Docks Station",43.641806,-79.377186,["509","510"]],["College St at Bathurst St",43.65657,-79.407339,["506"]],["King St East at Ontario St",43.651864,-79.365876,["504"]],["Lake Shore Blvd West at Twenty Second St",43.597338,-79.521251,["501"]],["Dundas St West at Lansdowne Ave",43.650111,-79.440135,["505"]],["St Clair Ave West at Avenue Rd West Side",43.686535,-79.402103,["512"]],["Queen St West at Spadina Ave",43.648886,-79.396062,["501"]],["College St at Brock Ave",43.651699,-79.436456,["506"]],["Carlton St at Ontario St",43.663821,-79.370401,["506"]],["King St East at Sackville St",43.6543,-79.360379,["504"]],["Lake Shore Blvd West at Thirty First St",43.595155,-79.530407,["501"]],["Lake Shore Blvd West at Thirtieth St",43.595472,-79.52966,["501"]],["Queen St East at Jones Ave",43.662578,-79.332925,["501"]],["Queen St East at Brooklyn Ave",43.662069,-79.335808,["501"]],["Long Branch Loop",43.591811,-79.544124,["501"]],["College St at Dufferin St",43.652456,-79.43266,["506"]],["King St West at Wilson Park Rd",43.636938,-79.442453,["504"]],["King St East at Sumach St",43.65528,-79.358705,["504"]],["Lake Shore Blvd West at Fifteenth St",43.598973,-79.513857,["501"]],["Carlton St at Sherbourne St",43.66307,-79.373237,["506"]],["Queen St East at Pape Ave",43.661429,-79.338074,["501"]],["King St East at Sherbourne St",43.651347,-79.368135,["504"]],["Broadview Ave at Dundas St East",43.662248,-79.351175,["501","504"]],["Gerrard St East at Ashdale Ave",43.67239,-79.321719,["506"]],["2155 Lake Shore Blvd West",43.625705,-79.479741,["501"]],["Queen St West at University Ave - Osgoode Station",43.65097,-79.386257,["501"]],["Spadina Ave at Sullivan St",43.651021,-79.397338,["510"]],["Dundas St West at Brock Ave",43.649938,-79.4355,["505"]],["Queens Quay West at Lower Spadina Ave East Side",43.637757,-79.391176,["509","510"]],["Queens Quay West at Lower Spadina Ave West Side",43.637528,-79.392624,["509"]],["Queen St West at Dunn Ave",43.640919,-79.434664,["501"]],["Queen St West at Shaw St",43.64456,-79.416511,["501"]],["Lake Shore Blvd West at Superior Ave",43.615096,-79.48869,["501"]],["Lake Shore Blvd West at Mimico Ave",43.613542,-79.489314,["501"]],["Dundas St West at Brock Ave",43.649826,-79.435721,["505"]],["Bathurst St at Dundas St West - Toronto Western Hospital",43.652475,-79.406185,["511"]],["St Clair Ave West at Deer Park Cres East Side",43.687341,-79.397451,["512"]],["College St at Ossington Ave",43.654255,-79.42294,["506"]],["King St West at Sudbury St",43.641064,-79.417183,["504"]],["Dundas St West at Sorauren Ave",43.651247,-79.445756,["505","506"]],["Dundas St West at Bay St",43.655845,-79.383493,["505"]],["Spadina Ave at Harbord St North Side",43.663544,-79.402228,["510"]],["King St West at Niagara St",43.642987,-79.407539,["504"]],["Queen St East at Carlaw Ave",43.660953,-79.340208,["501"]],["Dundas St West at Gladstone Ave",43.649633,-79.429626,["505"]],["Carlton St at Parliament St",43.664144,-79.36819,["506"]],["Dundas St West at Beverley St",43.653887,-79.393724,["505"]],["Bathurst St at Fort York Blvd",43.638684,-79.400466,["511"]],["Dundas St West at Dovercourt Rd",43.649513,-79.424553,["505"]],["King St West at Tecumseth St",43.643296,-79.405362,["504"]],["King St West at Strachan Ave",43.642127,-79.411783,["504"]],["College St at Crawford St",43.65523,-79.418874,["506"]],["Gerrard St East at Sackville St",43.662685,-79.363903,["506"]],["Gerrard St East at Woodbine Ave",43.680919,-79.310592,["506"]],["Dundas St East at Sherbourne St",43.65822,-79.371303,["505"]],["Queen St East at Pape Ave",43.66166,-79.337625,["501"]],["Gerrard St East at Sumach St",43.663061,-79.361596,["506"]],["Dundas St East at Sherbourne St",43.658406,-79.370878,["505"]],["Carlton St at Sherbourne St",43.663289,-79.372902,["506"]],["College St at Beverley St",43.658547,-79.396368,["506"]],["Dundas St East at Ontario St",43.658752,-79.368653,["505"]],["Broadview Ave at Danforth Ave",43.676342,-79.359041,["504","505"]],["Dundas St West at Bay St",43.655582,-79.384014,["505"]],["College St at Borden St",43.657064,-79.405017,["506"]],["Dundas St West at Rusholme Rd",43.649553,-79.426473,["505"]],["Dundas St West at Howard Park Ave",43.652232,-79.448522,["505"]],["Lake Shore Blvd West at Twenty Seventh St",43.596328,-79.525043,["501"]],["Howard Park Ave at Indian Rd",43.650555,-79.455063,["506"]],["Gerrard St East at Sumach St",43.66327,-79.361269,["506"]],["Dundas St West at Lansdowne Ave",43.650206,-79.43948,["505"]],["King St West at Niagara St",43.642809,-79.40776,["504"]],["Queen St East at Greenwood Ave",43.664281,-79.325493,["501"]],["College St at Havelock St",43.653051,-79.429269,["506"]],["Dundas St East at Church St",43.656583,-79.376993,["505"]],["Spadina Ave at Nassau St South Side",43.655393,-79.399077,["510"]],["Gerrard St East at Pape Ave",43.668233,-79.340247,["506"]],["Dundas St East at Jarvis St",43.656947,-79.374706,["505"]],["Queen St East at Silver Birch Ave",43.673262,-79.28497,["501"]],["College St at University Ave - Queen's Park Station",43.659697,-79.390773,["506"]],["Gerrard St East at Sackville St",43.662508,-79.364115,["506"]],["Gerrard St East at Jones Ave",43.669327,-79.335419,["506"]],["Spadina Ave at College St South Side",43.657372,-79.399868,["510"]],["Lake Shore Blvd West at Seventh St",43.600638,-79.505392,["501"]],["The Queensway at South Kingsway",43.635656,-79.473392,["501"]],["Queen St East at Boulton Ave",43.65966,-79.346553,["501"]],["Queen St East at Alton Ave",43.66388,-79.327688,["501"]],["Queen St West at Tecumseth St",43.646569,-79.406716,["501"]],["Broadview Ave at Wolfrey Ave",43.674457,-79.357342,["504","505"]],["Queen St East at Broadview Ave",43.658746,-79.35006,["504"]],["Bathurst St at College St",43.656244,-79.407513,["511"]],["Dundas St East at Church St",43.656371,-79.377358,["505"]],["Gerrard St East at Woodbine Ave",43.680644,-79.310829,["506"]],["Broadview Ave at Queen St East North Side",43.659461,-79.349975,["504"]],["Carlton St at Yonge St - College Station",43.66144,-79.382912,["506"]],["Gerrard St East at Woodfield Rd",43.671677,-79.324168,["506"]],["Humber Loop at The Queensway",43.631194,-79.478505,["501"]],["Queen St East at Carlaw Ave",43.661142,-79.339954,["501"]],["Queen St West at Augusta Ave",43.648153,-79.399534,["501"]],["Dundas St West at Bathurst St - Toronto Western Hospital",43.652163,-79.406259,["505"]],["Dundas St West at Ossington Ave",43.64927,-79.420944,["505"]],["Lake Shore Blvd West at Hillside Ave",43.611265,-79.490136,["501"]],["Broadview Ave at Millbrook Cres",43.671897,-79.354734,["504","505"]],["Spadina Ave at Willcocks St",43.66145,-79.401512,["510"]],["Gerrard St East at Carlaw Ave",43.667491,-79.342998,["506"]],["Gerrard St East at Coxwell Ave",43.672761,-79.319529,["506"]],["Queen St West at Sorauren Ave",43.639824,-79.440785,["501"]],["Queen St East at Logan Ave",43.660394,-79.342681,["501"]],["Richmond St West at Yonge St - Queen Station",43.651654,-79.379372,["501"]],["Main St at Danforth Ave",43.688299,-79.302006,["506"]],["Dundas St West at Yonge St - TMU Station",43.65619,-79.38119,["505"]],["Broadview Ave at Mountstephen St",43.663942,-79.35187,["504","505"]],["Queen St West at Niagara St",43.645898,-79.410006,["501"]],["Gerrard St East at Broadview Ave",43.665376,-79.352906,["506"]],["Queens Quay West at Dan Leckie Way East Side",43.636798,-79.396172,["509"]],["Carlton St at Church St",43.661721,-79.379621,["506"]],["College St at Dovercourt Rd",43.653692,-79.426251,["506"]],["Queen St East at Coxwell Ave",43.666427,-79.316446,["501"]],["Broadview Ave at Queen St East",43.659107,-79.350021,["504"]],["Queen St East at Neville Park Blvd",43.673911,-79.281723,["501"]],["Dundas St East at Parliament St",43.65951,-79.365882,["501","505"]],["Broadview Ave at Langley Ave-Hennick Bridgepoint Hospital",43.668079,-79.353319,["504","505"]],["Lake Shore Blvd West at Fifth St",43.601388,-79.502863,["501"]],["The Queensway at Parkside Dr",43.639665,-79.453923,["501"]],["Bathurst St at Dundas St West - Toronto Western Hospital",43.652178,-79.405874,["511"]],["Gerrard St East at Greenwood Ave",43.671001,-79.327856,["506"]],["King St West at Dufferin St",43.639085,-79.427001,["504"]],["Queen St East at Woodbine Ave",43.668635,-79.305945,["501"]],["Parliament St at Front St East",43.65167,-79.362867,["504"]],["Queen St East at Neville Park Blvd",43.673616,-79.282531,["501"]],["Queen St East at Lockwood Rd",43.668108,-79.308924,["501"]],["Bathurst St at Nassau St - Toronto Western Hospital",43.654353,-79.406946,["511"]],["Dufferin St at Springhurst Ave",43.635014,-79.425934,["504"]],["Erindale Ave at Broadview Ave",43.677531,-79.358416,["505"]],["Gerrard St East at Golfview Ave",43.682091,-79.308289,["506"]],["Fleet St at Bathurst St West Side",43.63642,-79.400545,["509","511"]],["Gerrard St East at Beaton Ave",43.67629,-79.316879,["506"]],["Queen St East at Leslie St",43.663143,-79.330376,["501"]],["Dundas St West at Bathurst St - Toronto Western Hospital",43.652424,-79.405874,["505"]],["Queen St West at Bathurst St",43.647084,-79.40418,["501"]],["Howard Park Ave at Parkside Dr",43.649162,-79.457476,["506"]],["Dundas St West at Grace St",43.650777,-79.413806,["505"]],["Dundas St West at Denison Ave",43.652113,-79.402165,["505"]],["King St West at Dufferin St",43.638819,-79.427487,["504"]],["Gerrard St East at Broadview Ave",43.665547,-79.352365,["506"]],["Queen St East at Sherbourne St",43.654424,-79.369555,["501"]],["Queen St East at Silver Birch Ave",43.673035,-79.285343,["501"]],["College St at Borden St",43.656855,-79.405276,["506"]],["Gerrard St East at Coxwell Ave",43.675659,-79.319842,["506"]],["Queen St West at Triller Ave",43.639319,-79.44338,["501"]],["Gerrard St East at Kingsmount Park Rd",43.679449,-79.312986,["506"]],["Lake Shore Blvd West at Long Branch Ave",43.594303,-79.53413,["501"]],["Lake Shore Blvd West at Twenty Second St",43.597116,-79.521413,["501"]],["Carlton St at Jarvis St",43.662511,-79.376575,["506"]],["College St at Yonge St - College Station",43.661259,-79.383245,["506"]],["Gerrard St East at Leslie St",43.669663,-79.333264,["506"]],["Broadview Ave at Langley Ave-Hennick Bridgepoint Hospital",43.667664,-79.353308,["504","505"]],["Dundas St West at Sterling Rd",43.650684,-79.442777,["505","506"]],["Gerrard St East at Jones Ave",43.669085,-79.33578,["506"]],["College St at St George St",43.658801,-79.395745,["506"]],["Lake Shore Blvd West at Tenth St",43.599877,-79.508796,["501"]],["Dundas St West at Roncesvalles Ave",43.653685,-79.451357,["505"]],["King St West at Jefferson Ave",43.640065,-79.422082,["504"]],["Dundas St West at Howard Park Ave",43.651921,-79.447458,["505","506"]],["Spadina Ave at Harbord St South Side",43.662648,-79.401984,["510"]],["King St West at Dunn Ave",43.637837,-79.433063,["504"]],["Lake Shore Blvd West at Royal York Rd",43.60382,-79.493033,["501"]],["Queen St West at Strachan Ave",43.645241,-79.413308,["501"]],["Spadina Ave at King St West North Side",43.645998,-79.395149,["510"]],["King St West at Portland St",43.644527,-79.39994,["504"]],["High Park Loop",43.647681,-79.458045,["506"]],["Queen St West at Lansdowne Ave",43.640685,-79.436463,["501"]],["Bathurst St at Queen St West",43.647066,-79.4039,["511"]],["King St West at Shaw St",43.641309,-79.415217,["504"]],["Parliament St at Shuter St",43.656843,-79.364855,["501"]],["King St West at Dunn Ave",43.637647,-79.433376,["504"]],["College St at Bay St",43.660672,-79.386165,["506"]],["King St West at Atlantic Ave",43.640051,-79.421415,["504"]],["Bathurst St at King St West",43.644139,-79.402833,["511"]],["Lake Shore Blvd West at Thirteenth St",43.599214,-79.51196,["501"]],["Lake Shore Blvd West at Superior Ave",43.614817,-79.488619,["501"]],["Lake Shore Blvd West at Long Branch Ave",43.594693,-79.53303,["501"]],["Lake Shore Blvd West at Burlington St",43.617446,-79.48738,["501"]],["Lake Shore Blvd West at Legion Rd",43.620622,-79.483163,["501"]],["Lake Shore Blvd West at Legion Rd",43.620372,-79.483407,["501"]],["Queen St East at Sherbourne St",43.654602,-79.369316,["501"]],["St Clair Ave West at Tweedsmuir Ave West Side",43.684089,-79.41371,["512"]],["St Clair Ave West at Deer Park Cres West Side",43.687185,-79.398655,["512"]],["St Clair Ave West at Dunvegan Rd West Side",43.685864,-79.40547,["512"]],["King St West at Spencer Ave",43.63831,-79.430761,["504"]],["Queen St West at Abell St",43.642976,-79.424466,["501"]],["Spadina Ave at Sussex Ave",43.664513,-79.40261,["510"]],["College St at Queen's Park - Queen's Park Station",43.659999,-79.390138,["506"]],["Bathurst St at Bloor St West",43.665012,-79.411065,["511"]],["Dundas St East at Parliament St",43.659283,-79.366291,["505"]],["Carlton St at Jarvis St",43.662306,-79.376843,["506"]],["Gerrard St East at Golfview Ave",43.681652,-79.30886,["506"]],["Dundas St West at Spadina Ave",43.652776,-79.398341,["505"]],["Spadina Ave at Queens Quay West North Side",43.638141,-79.39201,["510"]],["Dufferin Gate Loop",43.634401,-79.425872,["504"]],["Dufferin St at Liberty St",43.637414,-79.426893,["504"]],["Spadina Ave at Willcocks St",43.661123,-79.401263,["510"]],["Broadview Ave at Gerrard St East",43.665274,-79.352444,["504","505"]],["The Queensway at Ellis Ave East Side",43.637929,-79.465682,["501"]],["Gerrard St East at River St",43.663559,-79.359334,["506"]],["Queen St West at John St",43.649759,-79.391191,["501"]],["Dundas St West at Shaw St",43.649703,-79.418489,["505"]],["Church St at Richmond St East",43.652637,-79.375624,["501"]],["College St at Euclid Ave",43.655597,-79.41145,["506"]],["Dundas St West at Dufferin St",43.649675,-79.431314,["505"]],["Lake Shore Blvd West at First St",43.60214,-79.498592,["501"]],["Dundas St West at Chestnut St",43.655136,-79.386129,["505"]],["St Clair Ave West at Russell Hill Rd West Side",43.685262,-79.408389,["512"]],["Lake Shore Blvd West at Twenty Ninth St",43.595809,-79.528185,["501"]],["Lake Shore Blvd West at Symons St",43.608629,-79.490452,["501"]],["Broadview Ave at Danforth Ave",43.676051,-79.358601,["505"]],["Queen St West at Gladstone Ave",43.642608,-79.427,["501"]],["Spadina Ave at Nassau St",43.655658,-79.399071,["510"]],["King St West at Peter St",43.646161,-79.39201,["504"]],["Bathurst St at Ulster St",43.659869,-79.409188,["511"]],["Dundas St West at Roncesvalles Ave East Side",43.65348,-79.451258,["505"]],["Spadina Ave at Bremner Blvd",43.640814,-79.393172,["510"]],["Gerrard St East at Bowmore Rd",43.67819,-79.314912,["506"]],["Queen St East at Carroll St",43.658204,-79.352454,["504"]],["Queen St East at Empire Ave",43.660216,-79.344102,["501"]],["Dundas St West at Denison Ave",43.651939,-79.40236,["505"]],["Dundas St East at River St",43.661093,-79.358286,["501","505"]],["Spadina Ave at College St North Side",43.658504,-79.400214,["510"]],["Bathurst St at Queens Quay West North Side Billy Bishop Airport",43.636011,-79.398844,["509"]],["College St at Augusta Ave",43.65724,-79.403252,["506"]],["Parliament St at Queen St East",43.655756,-79.364606,["501"]],["Lake Shore Blvd West at Islington Ave",43.600896,-79.505092,["501"]],["Lake Shore Blvd West at Park Lawn Rd West Side",43.622602,-79.481558,["501"]],["Dundas St East at Yonge St - TMU Station",43.656426,-79.380755,["505"]],["Queen St West at John St",43.649947,-79.390954,["501"]],["Queen St East at Logan Ave",43.660599,-79.342373,["501"]],["Spadina Ave at Front St West",43.642934,-79.394028,["510"]],["Gerrard St East at Greenwood Ave",43.670802,-79.328156,["506"]],["Queen St East at Glen Manor Dr",43.671698,-79.292442,["501"]],["Queen St West at Peter St",43.64922,-79.393771,["501"]],["Gerrard St East at Parliament St",43.662071,-79.3667,["506"]],["Dundas St West at Grace St",43.650581,-79.41422,["505"]],["Spadina Ave at Sussex Ave South Side",43.664224,-79.402616,["510"]],["Dundas St West at Beverley St",43.65371,-79.393961,["505"]],["Dundas St West at Sheridan Ave",43.649825,-79.433524,["505"]],["Bathurst St at King St West",43.643664,-79.402522,["511"]],["King St West at Bathurst St",43.644142,-79.40189,["504"]],["Queen St East at Empire Ave",43.659991,-79.344501,["501"]],["Lake Shore Blvd West at Fifth St",43.601151,-79.503113,["501"]],["Dundas St West at Chestnut St",43.655337,-79.385867,["505"]],["Dundas St West at Gladstone Ave",43.649516,-79.429975,["505"]],["Dundas St West at University Ave - St Patrick Station",43.654679,-79.388742,["505"]],["Bathurst St at Harbord St",43.66142,-79.409618,["511"]],["Queen St West at University Ave - Osgoode Station",43.650683,-79.386931,["501"]],["Gerrard St East at River St",43.66382,-79.359047,["506"]],["Queen St East at Broadview Ave",43.658999,-79.349497,["501"]],["Queens Quay West at Rees St West Side",43.63876,-79.387157,["509","510"]],["College St at Elizabeth St",43.660394,-79.387562,["506"]],["King St West at Jameson Ave",43.637264,-79.435861,["504"]],["Bathurst St at Fort York Blvd",43.638947,-79.400771,["511"]],["Queen St East at Ontario St",43.654914,-79.367262,["501"]],["Dundas St West at Sterling Rd",43.650631,-79.443251,["505","506"]],["Spadina Ave at Queen St West North Side",43.649178,-79.396495,["510"]],["Lake Shore Blvd West at Third St",43.601653,-79.500866,["501"]],["King St East at Sackville St",43.654602,-79.360165,["504"]],["Queen St West at Strachan Ave",43.645421,-79.413052,["501"]],["Queen St East at Saulter St East Side",43.659402,-79.347097,["501"]],["Broadview Ave at Dundas St East",43.6626,-79.351506,["504","505"]],["Gerrard St East at De Grassi St",43.66641,-79.348419,["506"]],["Queen St West at Brock Ave",43.641545,-79.432245,["501"]],["Gerrard St East at Marjory Ave",43.668684,-79.337632,["506"]],["Manitoba Dr at Strachan Ave",43.636172,-79.410145,["509","511"]],["Broadview Ave at Withrow Ave",43.669859,-79.353435,["504","505"]],["Broadview Ave at Jack Layton Way",43.666481,-79.353132,["504","505"]],["The Queensway at South Kingsway",43.635819,-79.473052,["501"]],["Queen St West at Beaty Ave",43.639599,-79.441272,["501"]],["Dundas St West at Bloor St West",43.6561,-79.45233,["504","505"]],["Queen St West at Palmerston Ave",43.646763,-79.406434,["501"]],["Carlton St at Ontario St",43.663621,-79.37064,["506"]],["Gerrard St East at Leslie St",43.66988,-79.332933,["506"]],["Roncesvalles Ave at Galley Ave",43.642982,-79.447845,["504"]],["Queen St East at Ontario St",43.655161,-79.366816,["501"]],["College St at Bay St",43.66092,-79.385569,["506"]],["Lake Shore Blvd West at Colonel Samuel Smith Park Dr",43.598047,-79.517179,["501"]],["Gerrard St East at Glenmount Park Rd",43.682773,-79.305845,["506"]],["Spadina Ave at Front St West North Side",43.643182,-79.394027,["510"]],["Queen St East at Jarvis St",43.653602,-79.373383,["501"]],["Bathurst St at Harbord St",43.661614,-79.409887,["511"]],["College St at Lansdowne Ave",43.651168,-79.439866,["506"]],["King St East at Parliament St",43.652556,-79.363371,["504"]],["Broadview Ave at Mountstephen St",43.664096,-79.35214,["504","505"]],["Roncesvalles Ave at Grenadier Rd",43.648639,-79.449872,["504"]],["Queen St West at Dovercourt Rd",43.643394,-79.422528,["501"]],["Queen St West at Augusta Ave",43.647951,-79.399869,["501"]],["College St at Euclid Ave",43.655822,-79.411298,["506"]],["Dundas St East at Ontario St",43.658961,-79.368357,["505"]],["College St at Rusholme Park Cres",43.652817,-79.429769,["506"]],["King St East at Sherbourne St",43.651169,-79.368367,["504"]],["Spadina Ave at Richmond St West",43.6476,-79.395827,["510"]],["College St at Ossington Ave",43.654475,-79.422554,["506"]],["College St at Lansdowne Ave",43.650681,-79.440227,["506"]],["College St at Grace St",43.654987,-79.415437,["506"]],["Queen St West at Claremont St",43.646157,-79.409404,["501"]],["Lake Shore Blvd West at Thirty Seventh St",43.593494,-79.537978,["501"]],["Howard Park Ave at Indian Rd",43.650763,-79.454889,["506"]],["Broadview Ave at Millbrook Cres",43.672144,-79.355165,["504","505"]],["Gerrard St East at Main St",43.683838,-79.300386,["506"]],["Bathurst St at Ulster St",43.65973,-79.408924,["511"]],["King St West at Shaw St",43.641529,-79.414775,["504"]],["Gerrard St East at Beaton Ave",43.676047,-79.317086,["506"]],["Howard Park Ave at Parkside Dr East Side",43.649054,-79.457394,["506"]],["Parliament St at Shuter St",43.657021,-79.365124,["501"]],["Queen St West at Shaw St",43.64479,-79.416155,["501"]],["Gerrard St East at Carlaw Ave",43.667717,-79.342605,["506"]],["Queen St East at Elmer Ave",43.669336,-79.303443,["501"]],["Howard Park Ave at Roncesvalles Ave",43.651426,-79.451176,["506"]],["Lake Shore Blvd West at Burlington St",43.617151,-79.487284,["501"]],["Dundas St East at Broadview Ave",43.662249,-79.351814,["501","505"]],["Lake Shore Blvd West at Louisa St",43.619048,-79.486446,["501"]],["Dufferin St at Liberty St",43.636946,-79.426505,["504"]],["St Clair Ave West at Vaughan Rd West Side",43.682656,-79.420844,["512"]],["St Clair Ave West at Vaughan Rd East Side",43.682875,-79.419348,["512"]],["St Clair Ave West at Bathurst St East Side",43.683213,-79.417671,["512"]],["St Clair Ave West at Bathurst St West Side",43.683061,-79.418852,["512"]],["St Clair Ave West at Tweedsmuir Ave",43.684084,-79.413336,["512"]],["St Clair Ave West at Spadina Rd East Side",43.684699,-79.410569,["512"]],["St Clair Ave West at Yonge St West Side",43.688014,-79.394607,["512"]],["Queen St East at Leslie St",43.66333,-79.330109,["501"]],["The Queensway at Colborne Lodge Dr East Side",43.639566,-79.458635,["501"]],["College St at Elizabeth St",43.660618,-79.387271,["506"]],["The Queensway at Parkside Dr",43.639746,-79.454176,["501"]],["The Queensway at Glendale Ave East Side - St Joseph's Health Centre",43.639168,-79.450773,["501"]],["King St West at Queen St West",43.638597,-79.445863,["504"]],["St Clair Ave West at Russell Hill Rd East Side",43.685403,-79.407321,["512"]],["Coxwell Ave at Gerrard St East",43.675096,-79.320091,["506"]],["Gerrard St East at Logan Ave",43.666983,-79.345317,["506"]],["Gerrard St East at St Matthews Rd",43.664968,-79.354903,["506"]],["King St West at Sudbury St",43.640853,-79.417479,["504"]],["Howard Park Ave at Dundas St West",43.651965,-79.448329,["506"]],["Dundas St West at McCaul St",43.654219,-79.391552,["505"]],["Dundas St East at Jarvis St",43.657163,-79.374378,["505"]],["Queen St West at Ossington Ave",43.644283,-79.41869,["501"]],["Queen St West at Ossington Ave",43.64406,-79.418976,["501"]],["Howard Park Ave at Roncesvalles Ave",43.651592,-79.45081,["506"]],["Queen St East at Kingston Rd",43.667398,-79.312137,["501"]],["Lake Shore Blvd West at Mimico Ave",43.613855,-79.489387,["501"]],["College St at Spadina Ave",43.658013,-79.399632,["506"]],["Spadina Ave at Queen St West South Side",43.64822,-79.396223,["510"]],["Lake Shore Blvd West at Thirteenth St",43.599445,-79.511706,["501"]],["Union Station",43.645652,-79.37921,["509","510"]],["Spadina Ave at Bremner Blvd North Side",43.641232,-79.393194,["510"]],["Queen St West at Dufferin St",43.642115,-79.428787,["501"]],["Queen St East at Jarvis St",43.653797,-79.373076,["501"]],["Lake Shore Blvd West at Twenty Sixth St",43.596668,-79.524268,["501"]],["Gerrard St East at De Grassi St",43.666207,-79.348755,["506"]],["College St at Dovercourt Rd",43.653509,-79.426497,["506"]],["Queen St West at Dovercourt Rd",43.643567,-79.422228,["501"]],["Lake Shore Blvd West at Kipling Ave",43.598331,-79.516749,["501"]],["Roncesvalles Ave at Howard Park Ave",43.651156,-79.450841,["504"]],["2111 Lake Shore Blvd West",43.629066,-79.478151,["501"]],["Dundas St West at Ossington Ave",43.64943,-79.42049,["505"]],["Lake Shore Blvd West at Park Lawn Rd",43.62278,-79.481308,["501"]],["Queen St West at Roncesvalles Ave",43.638864,-79.445773,["501"]],["College St at Crawford St",43.655048,-79.419148,["506"]],["Dundas St West at Lisgar St",43.649434,-79.426882,["505"]],["Queen St West at Brock Ave",43.641387,-79.432411,["501"]],["Bathurst St at Lennox St",43.663726,-79.410537,["511"]],["Bathurst St at Robinson St",43.649099,-79.40483,["511"]],["Broadview Ave at Wolfrey Ave",43.674192,-79.356904,["504","505"]],["College St at Grace St",43.654902,-79.415821,["506"]],["Dundas St West at University Ave - St Patrick Station",43.654919,-79.387813,["505"]],["Gerrard St East at Norwood Rd",43.683235,-79.303202,["506"]],["Roncesvalles Ave at Garden Ave",43.643538,-79.447901,["504"]],["King St West at Wilson Park Rd West Side",43.637035,-79.442107,["504"]],["Queen St East at Caroline Ave",43.662018,-79.335437,["501"]],["Richmond St West at York St",43.650603,-79.38422,["501"]],["Gerrard St East at Logan Ave",43.667162,-79.345079,["506"]],["College St at Brock Ave",43.651884,-79.4362,["506"]],["Queen St East at Wineva Ave",43.671104,-79.295327,["501"]],["Spadina Ave at Dundas St West South Side",43.65248,-79.397924,["510"]],["Broadview Ave at Withrow Ave",43.669638,-79.35303,["504","505"]],["Queen St West at Bathurst St",43.647313,-79.4037,["501"]],["Spadina Ave at King St West",43.645671,-79.395169,["510"]],["King St East at Sumach St",43.655658,-79.358336,["504"]],["Lake Shore Blvd West at Louisa St",43.618786,-79.486469,["501"]],["King St West at Dowling Ave",43.636773,-79.438379,["504"]],["The Queensway at Windermere Ave East Side",43.637256,-79.469205,["501"]],["King St West at Jameson Ave",43.637078,-79.436215,["504"]],["Coxwell Ave at Lower Gerrard St East",43.673091,-79.319449,["506"]],["Queen St West at Spadina Ave",43.648381,-79.397609,["501"]],["Gerrard St East at Alton Ave",43.670216,-79.330793,["506"]],["Gerrard St East at Pape Ave",43.668045,-79.340492,["506"]],["Lake Shore Blvd West at First St",43.602383,-79.498357,["501"]],["Queen St West at Jameson Ave",43.64039,-79.437517,["501"]],["Roncesvalles Ave at Queen St West",43.638925,-79.446287,["504"]],["Bathurst St at College St",43.656632,-79.407861,["511"]],["Broadview Ave at Gerrard St East",43.665663,-79.352794,["504","505"]],["College St at McCaul St",43.659317,-79.393278,["506"]],["Queen St East at Beech Ave",43.672555,-79.287687,["501"]],["Queens Quay/Ferry Docks Station",43.641422,-79.377093,["509","510"]],["Manitoba Dr at Strachan Ave West Side",43.6363,-79.410411,["509","511"]],["St Clair Ave West at Spadina Rd West Side",43.684535,-79.4117,["512"]],["King St West at Joe Shuster Way",43.639804,-79.423411,["504"]],["The Queensway at Windermere Ave West Side",43.637125,-79.470625,["501"]],["The Queensway at Ellis Ave West Side",43.637677,-79.467157,["501"]],["St Clair Ave West at Dunvegan Rd",43.685922,-79.404757,["512"]],["The Queensway at Colborne Lodge Dr West Side",43.639445,-79.460301,["501"]],["Fleet St at Bastion St West Side",43.635968,-79.404148,["509","511"]],["Fleet St at Bastion St",43.63585,-79.403771,["509","511"]],["Fleet St at Fort York Blvd East Side",43.636256,-79.406278,["509","511"]],["Fleet St at Fort York Blvd West Side",43.636422,-79.407397,["509","511"]],["Bathurst Station",43.666532,-79.411286,["511"]],["Broadview Station",43.677013,-79.358147,["505"]],["Broadview Station",43.677134,-79.358206,["504"]],["Dundas West Station",43.656821,-79.453463,["504"]],["Dundas West Station",43.656698,-79.45346,["505"]],["Main Street Station",43.688861,-79.301804,["506"]],["St Clair Station",43.687857,-79.391958,["512"]],["St Clair West Station",43.684447,-79.415555,["512"]],["Spadina Station",43.667221,-79.403665,["510"]],["St Clair Ave West at Lansdowne Ave East Side",43.676353,-79.450021,["512"]],["St Clair Ave West at Earlscourt Ave East Side",43.677045,-79.446847,["512"]],["St Clair Ave West at Dufferin St East Side",43.678011,-79.442476,["512"]],["St Clair Ave West at Northcliffe Blvd East Side",43.678485,-79.440298,["512"]],["St Clair Ave West at Glenholme Ave East Side",43.678985,-79.438072,["512"]],["St Clair Ave West at Oakwood Ave East Side",43.679661,-79.43507,["512"]],["St Clair Ave West at Winona Dr East Side",43.680326,-79.431948,["512"]],["St Clair Ave West at Arlington Ave East Side",43.681096,-79.428315,["512"]],["St Clair Ave West at Christie St East Side",43.681758,-79.425152,["512"]],["St Clair Ave West at Wychwood Ave East Side",43.682189,-79.422895,["512"]],["St Clair Ave West at Wychwood Ave West Side",43.68208,-79.424035,["512"]],["St Clair Ave West at Christie St West Side",43.681621,-79.426289,["512"]],["St Clair Ave West at Arlington Ave West Side",43.680962,-79.429411,["512"]],["St Clair Ave West at Winona Dr West Side",43.680191,-79.433048,["512"]],["St Clair Ave West at Oakwood Ave",43.679668,-79.43546,["512"]],["St Clair Ave West at Glenholme Ave West Side",43.678811,-79.439285,["512"]],["St Clair Ave West at Northcliffe Blvd West Side",43.678342,-79.441377,["512"]],["St Clair Ave West at Dufferin St West Side",43.677855,-79.443635,["512"]],["St Clair Ave West at Earlscourt Ave",43.677042,-79.447244,["512"]],["St Clair Ave West at Lansdowne Ave West Side",43.676186,-79.451121,["512"]],["St Clair Ave West at Caledonia Rd East Side",43.675437,-79.454201,["512"]],["St Clair Ave West at Caledonia Rd West Side",43.675275,-79.455281,["512"]],["St Clair Ave West at Laughton Ave East Side",43.67479,-79.457079,["512"]],["St Clair Ave West at Laughton Ave West Side",43.674639,-79.458176,["512"]],["St Clair Ave West at Hounslow Heath Rd East Side",43.674274,-79.459436,["512"]],["St Clair Ave West at Silverthorn Ave West Side",43.674107,-79.460547,["512"]],["St Clair Ave West at Old Weston Rd East Side",43.673599,-79.462439,["512"]],["St Clair Ave West at Old Weston Rd West Side",43.673427,-79.463578,["512"]],["St Clair Ave West at Keele St/ Weston Rd",43.672451,-79.467842,["512"]],["St Clair Ave West at Weston Rd/ Keele St West Side",43.672435,-79.468189,["512"]],["Gunns Loop at St Clair Ave West",43.671912,-79.471837,["512"]],["Queen St West at Dufferin St West Side",43.642145,-79.429333,["501"]],["Roncesvalles Ave at Marion St South Side",43.640654,-79.446945,["504"]],["Roncesvalles Ave at High Park Blvd South Side",43.645921,-79.448985,["504"]],["Roncesvalles Ave at Grenadier Rd",43.648885,-79.450121,["504"]],["Roncesvalles Ave at Marion St North Side",43.641432,-79.447086,["504"]],["Roncesvalles Ave at Howard Park Ave South Side",43.650939,-79.450927,["504"]],["Roncesvalles Ave at Queen St West North Side",43.639232,-79.44617,["504"]],["St Clair Ave West at Old Stock Yards Rd",43.671859,-79.470488,["512"]],["Exhibition Loop",43.635874,-79.417054,["509","511"]],["Parliament St at Dundas St East",43.65935,-79.365861,["501"]],["Bathurst St at Niagara St",43.641779,-79.401753,["511"]],["Bathurst St at Niagara St",43.642032,-79.401977,["511"]],["Queens Quay West at Rees St",43.638746,-79.386798,["509","510"]],["Queens Quay West at Harbourfront Centre",43.639613,-79.381765,["509","510"]],["Queens Quay West at Harbourfront Centre",43.639782,-79.381319,["509","510"]],["Bathurst St at Lennox St",43.663902,-79.410809,["511"]],["Bathurst St at Carr St",43.648599,-79.404431,["511"]],["Queen St East at Woodfield Rd",43.665141,-79.32153,["501"]],["Queen St East at Woodfield Rd",43.665353,-79.321174,["501"]],["Queen St East at Bellefair Ave",43.669987,-79.299922,["501"]],["Queen St East at Bellefair Ave",43.670148,-79.299743,["501"]],["Queen St West at St Patrick St",43.65048,-79.388482,["501"]],["Queen St West at Triller Ave",43.639092,-79.443874,["501"]],["Queen St East at Elmer Ave",43.669159,-79.303645,["501"]],["Queen St East at Woodbine Ave",43.668835,-79.305659,["501"]],["Queen St East at Glen Manor Dr",43.671493,-79.292818,["501"]],["Queen St East at Beech Ave",43.672733,-79.287448,["501"]],["Queen St West at Sudbury St",43.642398,-79.427345,["501"]],["King St East at Lower River St",43.65673,-79.356254,["504"]],["King St East at Ontario St",43.651647,-79.366167,["504"]],["King St West at Joe Shuster Way",43.639591,-79.423721,["504"]],["Dundas St West at Manning Ave",43.651197,-79.411029,["505"]],["Dundas St West at Manning Ave",43.651375,-79.410818,["505"]],["Dundas St West at Shaw St",43.649911,-79.418123,["505"]],["Gerrard St East at Woodfield Rd",43.671946,-79.323676,["506"]],["Dufferin St at King St West",43.638676,-79.42715,["504"]],["Cherry St at Front St East",43.652513,-79.357841,["504"]],["Cherry St at Front St East",43.65284,-79.358092,["504"]],["Distillery Loop",43.650856,-79.356822,["504"]],["Bathurst St at Bloor St West",43.665235,-79.411347,["511"]],["St Clair West Station",43.684297,-79.415609,["512"]],["Queen St West at Abell St",43.643197,-79.424093,["501"]],["King St West at Jarvis St West Side",43.650391,-79.372454,["504"]],["King St West at Jarvis St East Side",43.650541,-79.371287,["504"]],["King St West at Yonge St West Side - King Station",43.649058,-79.378565,["504"]],["King St West at Yonge St East Side - King Station",43.649232,-79.377256,["504"]],["King St West at Bay St West Side",43.648622,-79.380619,["504"]],["King St West at Bay St East Side",43.648724,-79.379621,["504"]],["King St West at Simcoe St - St. Andrew Station",43.647487,-79.385957,["504"]],["King St West at York St - St Andrew Station",43.647809,-79.383692,["504"]],["King St West at John St West Side",43.646538,-79.390161,["504"]],["King St West at John St East Side",43.646614,-79.389267,["504"]],["King St West at Blue Jays Way East Side",43.646101,-79.391644,["504"]],["King St West at Spadina Ave West Side",43.64537,-79.395811,["504"]],["King St West at Spadina Ave East Side",43.645507,-79.394296,["504"]],["King St West at Portland St East Side",43.644458,-79.399504,["504"]],["King St West at Bathurst St East Side",43.64399,-79.401815,["504"]],["King St East at Church St East Side",43.649982,-79.373826,["504"]],["King St East at Church St West Side",43.64984,-79.374971,["504"]],["Queen St East at Alton Ave",43.663648,-79.328109,["501"]],["Lake Shore Blvd West at Miles Rd",43.608194,-79.490239,["501"]],["Lake Shore Blvd West at Norris Cres",43.610819,-79.489952,["501"]],["Lake Shore Blvd West at Royal York Rd",43.603544,-79.493189,["501"]],["2155 Lake Shore Blvd West",43.626148,-79.479707,["501"]],["Berkeley St at King St East",43.65176,-79.364142,["504"]],["Dundas St East at Regent Park Blvd",43.660471,-79.361655,["501","505"]],["Dundas St East at Regent Park Blvd",43.660247,-79.361966,["501","505"]],["Dundas St West at St Patrick St",43.654566,-79.390141,["505"]],["Church St at Queen St East",43.653061,-79.375613,["501"]],["The Queensway at Glendale Ave - St Joseph's Health Centre",43.639553,-79.451838,["501"]],["College St at Augusta Ave",43.657485,-79.403078,["506"]],["Queen St West at Roncesvalles Ave East Side",43.638812,-79.445427,["501"]],["Queen St East at Wineva Ave East Side",43.671048,-79.295031,["501"]],["Adelaide St West at Yonge St - King Station",43.650274,-79.378551,["501"]],["York St at Adelaide St West",43.649422,-79.384314,["501"]]];

  // 503 Kingston Rd physical rail stops. The current TTC 503 service is
  // temporarily bus-replaced, so these are kept as geographic track stops
  // rather than dependent on today's operating mode.
  STREETCAR_STOP_RAW.push(
    ["Kingston Rd at Queen St East", 43.667029, -79.312948, ["503"]],
    ["Kingston Rd at Dundas St East", 43.6722, -79.3095, ["503"]],
    ["Kingston Rd at Columbine Ave", 43.6736, -79.3083, ["503"]],
    ["Kingston Rd at Woodbine Ave", 43.6747, -79.3071, ["503"]],
    ["Kingston Rd at Elmer Ave", 43.675537, -79.306008, ["503"]],
    ["Kingston Rd at Waverley Rd", 43.6768, -79.3028, ["503"]],
    ["Kingston Rd at Lee Ave", 43.6778, -79.3008, ["503"]],
    ["Kingston Rd at Southwood Dr", 43.678753, -79.298363, ["503"]],
    ["Kingston Rd at Glen Manor Dr", 43.679631, -79.294644, ["503"]],
    ["Kingston Rd at Beech Ave", 43.680314, -79.29052, ["503"]],
    ["Kingston Rd at Scarborough Rd", 43.680468, -79.287193, ["503"]],
    ["Kingston Rd at Bingham Ave", 43.6809, -79.2848, ["503"]],
    ["Bingham Loop", 43.68146, -79.285, ["503"]]
  );

  // -------------------------------------------------------------------------
  // Geometry helpers
  // -------------------------------------------------------------------------

  function pointAt(edge, s) {
    // Find the two stored points around distance s, then blend between them.
    const clamped = Math.max(0, Math.min(edge.len, s));
    let i = 1;
    while (i < edge.cum.length && edge.cum[i] < clamped) i++;
    i = Math.min(i, edge.pts.length - 1);

    const p0 = edge.pts[i - 1];
    const p1 = edge.pts[i];
    const segStart = edge.cum[i - 1];
    const segLen = Math.max(0.0001, edge.cum[i] - segStart);
    const t = (clamped - segStart) / segLen;
    const x = p0.x + (p1.x - p0.x) * t;
    const y = p0.y + (p1.y - p0.y) * t;
    const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    return { x, y, angle };
  }

  function lanePointAt(edge, s, dir) {
    // Offset the centreline sideways so opposite directions have separate rails.
    const p = pointAt(edge, s);
    const travelAngle = p.angle + (dir < 0 ? Math.PI : 0);
    return {
      x: p.x - Math.sin(travelAngle) * TRACK_LANE_OFFSET_M,
      y: p.y + Math.cos(travelAngle) * TRACK_LANE_OFFSET_M,
      angle: travelAngle,
    };
  }

  function outgoingVector(edge, nodeId) {
    const eps = Math.min(12, edge.len * 0.2);
    if (edge.a === nodeId) {
      const p0 = pointAt(edge, 0);
      const p1 = pointAt(edge, eps);
      const d = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
      return { x: (p1.x - p0.x) / d, y: (p1.y - p0.y) / d, dir: 1 };
    }
    const p0 = pointAt(edge, edge.len);
    const p1 = pointAt(edge, edge.len - eps);
    const d = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
    return { x: (p1.x - p0.x) / d, y: (p1.y - p0.y) / d, dir: -1 };
  }

  function edgeById(id) {
    return edges.find((edge) => edge.id === id);
  }

  const worldBounds = (() => {
    const all = [...nodes.values()];
    const xs = all.map((n) => n.x);
    const ys = all.map((n) => n.y);
    return {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys),
    };
  })();

  // Cache the static network as three world-space Path2D objects. Camera
  // transforms can move/scale them cheaply without rebuilding dozens of paths
  // or allocating screen-coordinate arrays every animation frame.
  const networkPaths = {
    main: new Path2D(),
    diversion: new Path2D(),
    yard: new Path2D(),
  };
  for (const edge of edges) {
    const path = edge.tags.includes("yard")
      ? networkPaths.yard
      : (edge.tags.includes("diversion") || edge.tags.includes("track"))
        ? networkPaths.diversion
        : networkPaths.main;
    path.moveTo(edge.pts[0].x, edge.pts[0].y);
    for (let i = 1; i < edge.pts.length; i++) path.lineTo(edge.pts[i].x, edge.pts[i].y);
  }

  // -------------------------------------------------------------------------
  // Game state
  // -------------------------------------------------------------------------

  // These values are the live simulation. A new run resets them; a checkpoint
  // stores only the small subset needed to rebuild them later.
  let running = false;
  let dead = false;
  let lastT = 0;
  let trainCars = 1;
  let queuedDirection = null;
  let manualSwitchEdgeId = null;
  let switchSignature = "";
  let pickups = [];
  let trail = [];
  let trailStart = 0;
  let trailDistance = 0;
  let head = null;
  let camera = { x: 0, y: 0, scale: 0.9 };
  let cameraZoomFactor = 1;
  let pinchStartDistance = 0;
  let pinchStartZoomFactor = 1;
  let canvasPinching = false;
  let terminalCollisionGraceM = 0;
  let audioCtx = null;
  let gameMode = "free";
  let operatorMode = "arcade";
  let speedKph = MODE_START_SPEED_KPH.arcade;
  let acceleratorHeld = false;
  let brakeHeld = false;
  let currentMission = null;
  let missionsCompleted = 0;
  let chaos = null;
  let blockedEdgeId = null;
  let nextChaosAt = Infinity;
  let lastLocationHudAt = 0;
  let nextStopCache = null;
  let firstPickupCollected = false;
  let runStartedAt = 0;
  let openingAssistPlacedAt = 0;
  let lastPacePickupAt = 0;
  let collisionFrames = 0;
  let resumeCheckpoint = null;
  let lastPickupAt = 0;
  let challengeZone = null;
  let nextChallengeAt = Infinity;
  let pickupMultiplier = 1;
  let gameEffects = [];

  // -------------------------------------------------------------------------
  // Persistence and HUD state
  // -------------------------------------------------------------------------

  function readBest() {
    const match = document.cookie.match(/(?:^|; )ttcSnakeHighScore=(\d+)/);
    return match ? Number(match[1]) : 0;
  }

  let best = readBest();

  function readCookie(name) {
    const prefix = name + "=";
    const parts = document.cookie.split("; ");
    for (const part of parts) {
      if (part.startsWith(prefix)) return decodeURIComponent(part.slice(prefix.length));
    }
    return null;
  }

  function updateResumeButton() {
    if (resumeCheckpoint && resumeCheckpoint.c >= 2) {
      resumeBtn.textContent = "Resume — " + resumeCheckpoint.c + " streetcars";
      resumeBtn.classList.add("show");
    } else {
      resumeBtn.classList.remove("show");
    }
  }

  function clearResumeCheckpoint() {
    resumeCheckpoint = null;
    document.cookie = "ttcSnakeResume=; Max-Age=0; Path=/; SameSite=Lax";
    updateResumeButton();
  }

  // Check the fields needed to safely place a saved train back on the graph.
  function isUsableCheckpoint(checkpoint) {
    return checkpoint && checkpoint.v === 1 &&
      Number.isFinite(checkpoint.c) && checkpoint.c >= 2 &&
      checkpoint.e && edgeById(checkpoint.e);
  }

  // Rename edges from older graph versions without changing the saved run's meaning.
  function migrateCheckpointEdge(checkpoint) {
    const edgeMigrations = {
      dundas1: "dundas1w",
      collegeWest: "collegeWestW",
    };
    checkpoint.e = edgeMigrations[checkpoint.e] || checkpoint.e;
    return checkpoint;
  }

  function readResumeCheckpoint() {
    try {
      const raw = readCookie("ttcSnakeResume");
      if (!raw) return null;
      const checkpoint = migrateCheckpointEdge(JSON.parse(raw));
      if (!isUsableCheckpoint(checkpoint)) return null;

      // Map pre-Ossington graph checkpoints onto the nearest replacement edge.
      // Exact position is approximate, but keeping the run is better than
      // invalidating tomorrow's resume because the rail graph gained a junction.
      return checkpoint;
    } catch (_) {
      return null;
    }
  }

  function compactResumeTrail() {
    const poses = getTrainPoses().filter((pose) => pose.placed !== false);
    if (!poses.length) return [];
    const headPose = poses[0];
    return poses.slice(0, 180).map((pose) => [
      Math.round(pose.x - headPose.x),
      Math.round(pose.y - headPose.y),
    ]);
  }

  function saveResumeCheckpoint() {
    if (dead || !head || trainCars < 2) return;

    const checkpoint = {
      v: 1,
      c: trainCars,
      e: head.edge.id,
      s: Math.round(head.s * 10) / 10,
      d: head.dir,
      sp: Math.round(speedKph),
      gm: gameMode,
      om: operatorMode,
      mc: missionsCompleted,
      mr: currentMission ? currentMission.def.route : null,
      rv: currentMission ? currentMission.reverse : false,
      tr: compactResumeTrail(),
    };

    try {
      let encoded = encodeURIComponent(JSON.stringify(checkpoint));
      // Keep safely below common ~4 KB per-cookie limits. Very large consists
      // still preserve count/location even if their full visible shape cannot fit.
      if (encoded.length > 3600) {
        checkpoint.tr = [];
        encoded = encodeURIComponent(JSON.stringify(checkpoint));
      }
      document.cookie = "ttcSnakeResume=" + encoded +
        "; Max-Age=2592000; Path=/; SameSite=Lax";
      resumeCheckpoint = checkpoint;
      updateResumeButton();
    } catch (_) {
      // Resume is optional and must never interrupt gameplay.
    }
  }

  function saveBest() {
    const joined = trainCars - 1;
    if (joined <= best) return;
    best = joined;
    document.cookie = "ttcSnakeHighScore=" + best + "; Max-Age=31536000; Path=/; SameSite=Lax";
  }

  function totalTrainLength() {
    return trainCars * CAR_LENGTH_M + Math.max(0, trainCars - 1) * COUPLER_GAP_M;
  }

  function updateHud() {
    const length = totalTrainLength();
    carsStat.textContent = String(trainCars);
    joinedStat.textContent = String(trainCars - 1);
    bestStat.textContent = String(best);
    lengthStat.textContent = length >= 1000
      ? (length / 1000).toFixed(2) + " km"
      : Math.round(length) + " m";
    speedStat.textContent = String(Math.round(speedKph));
    speedStat.style.color = speedKph > FLEXITY_RATED_MAX_KPH ? "#ffb3b7" : "";
    updateLocationHud();
    updateMissionHud();
  }

  function headingCardinal() {
    const a = Math.atan2(head.headingY, head.headingX);
    const dirs = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
    return dirs[(Math.round(a / (Math.PI / 4)) + 8) % 8];
  }

  function cleanStopName(name) {
    return String(name)
      .replace(/\s+(East|West|North|South) Side\b/gi, "")
      .replace(/^Opposite\s+/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function closestPointOnEdge(edge, x, y) {
    // Try every small line segment; keep the nearest projection on the track.
    let best = { distance: Infinity, s: 0, x: edge.pts[0].x, y: edge.pts[0].y };
    for (let i = 1; i < edge.pts.length; i++) {
      const a = edge.pts[i - 1];
      const b = edge.pts[i];
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const denom = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / denom));
      const px = a.x + vx * t;
      const py = a.y + vy * t;
      const distance = Math.hypot(x - px, y - py);
      if (distance < best.distance) {
        best = {
          distance,
          s: edge.cum[i - 1] + Math.hypot(px - a.x, py - a.y),
          x: px,
          y: py,
        };
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Geographic stop index
  // -------------------------------------------------------------------------

  function buildStreetcarStops() {
    // Convert geographic stop records into positions on our simplified graph.
    const snapped = [];

    for (const [rawName, lat, lon, rawRoutes] of STREETCAR_STOP_RAW) {
      const p = project(lat, lon);
      const routes = new Set(rawRoutes.map(String));
      let candidates = edges.filter((edge) =>
        !edge.tags.includes("yard") &&
        edge.tags.some((tag) => routes.has(String(tag)) || routes.has(String(tag).replace(/[A-Z]$/, "")))
      );
      if (!candidates.length) candidates = edges.filter((edge) => !edge.tags.includes("yard"));

      let best = null;
      for (const edge of candidates) {
        const snap = closestPointOnEdge(edge, p.x, p.y);
        if (!best || snap.distance < best.distance) best = { ...snap, edge };
      }
      if (!best || best.distance > 1600) continue;

      snapped.push({
        name: cleanStopName(rawName),
        edge: best.edge,
        s: best.s,
        x: best.x,
        y: best.y,
        sourceDistance: best.distance,
      });
    }

    // TTC source data has one record per direction/platform. For Snake we want
    // one geographic stop marker. Merge records landing on the same track within
    // roughly half a streetcar length.
    snapped.sort((a, b) => a.edge.id.localeCompare(b.edge.id) || a.s - b.s);
    const merged = [];
    for (const stop of snapped) {
      const previous = merged.at(-1);
      if (previous && previous.edge === stop.edge && Math.abs(previous.s - stop.s) < 42) {
        if (stop.sourceDistance < previous.sourceDistance) {
          previous.name = stop.name;
          previous.s = stop.s;
          previous.x = stop.x;
          previous.y = stop.y;
          previous.sourceDistance = stop.sourceDistance;
        }
        continue;
      }
      merged.push(stop);
    }
    return merged;
  }

  const STREETCAR_STOPS = buildStreetcarStops();
  const STOPS_BY_EDGE = new Map();
  for (const stop of STREETCAR_STOPS) {
    if (!STOPS_BY_EDGE.has(stop.edge.id)) STOPS_BY_EDGE.set(stop.edge.id, []);
    STOPS_BY_EDGE.get(stop.edge.id).push(stop);
  }
  for (const list of STOPS_BY_EDGE.values()) list.sort((a, b) => a.s - b.s);

  function nextStopAhead() {
    if (!head) return null;

    let edge = head.edge;
    let s = head.s;
    let dir = head.dir;
    let hx = head.headingX;
    let hy = head.headingY;
    let travelled = 0;

    // The guard prevents a looped graph from searching forever.
    for (let guard = 0; guard < 18; guard++) {
      const stops = STOPS_BY_EDGE.get(edge.id) || [];
      let bestStop = null;
      let bestDelta = Infinity;

      for (const stop of stops) {
        const delta = (stop.s - s) * dir;
        // Skip the pole we're effectively sitting on / just passed.
        if (delta > 22 && delta < bestDelta) {
          bestDelta = delta;
          bestStop = stop;
        }
      }

      if (bestStop) return { stop: bestStop, distance: travelled + bestDelta };

      const towardEnd = dir > 0;
      const available = towardEnd ? edge.len - s : s;
      travelled += available;
      const nodeId = towardEnd ? edge.b : edge.a;
      const next = previewNextEdge(nodeId, edge, hx, hy);
      if (!next) break;

      edge = next.edge;
      dir = next.dir;
      s = dir > 0 ? 0 : edge.len;
      hx = next.vec.x;
      hy = next.vec.y;
    }

    return null;
  }

  function updateLocationHud() {
    if (!head) return;
    nextStopCache = nextStopAhead();
    const stopName = nextStopCache?.stop?.name || "End of track";
    locationHud.innerHTML = '<span class="stop-diamond">◆</span><strong>Next Stop:</strong> ' + stopName;
  }

  function randomHeadOnEdges(candidateEdges) {
    const usable = candidateEdges.filter((edge) => edge.len > 90 && !edge.tags.includes("yard"));
    const pool = usable.length ? usable : candidateEdges;
    const edge = pool[Math.floor(Math.random() * pool.length)];
    const margin = Math.min(45, edge.len * .18);
    const s = margin + Math.random() * Math.max(1, edge.len - margin * 2);
    const dir = Math.random() < .5 ? -1 : 1;
    const p = pointAt(edge, s);
    const angle = p.angle + (dir < 0 ? Math.PI : 0);
    return { edge, s, dir, headingX: Math.cos(angle), headingY: Math.sin(angle) };
  }

  function missionEdges(def) {
    const base = def.route.replace(/[A-Z]$/, "");
    return edges.filter((edge) =>
      edge.tags.includes(def.route) ||
      edge.tags.includes(base) ||
      (base === "504" && edge.tags.includes("504"))
    );
  }

  function buildMission(def, reverse = false) {
    const originNode = reverse ? def.b : def.a;
    const targetNode = reverse ? def.a : def.b;
    const startEdge = reverse ? def.bEdge : def.aEdge;
    return { def, reverse, originNode, targetNode, startEdge };
  }

  function updateMissionHud() {
    if (gameMode !== "mission" || !currentMission) {
      missionHud.classList.remove("show");
      return;
    }
    missionHud.classList.add("show");
    missionRoute.textContent = currentMission.def.route;
    missionText.innerHTML = "<b>" + currentMission.def.name + " → " +
      nodes.get(currentMission.targetNode).label + "</b><span>" +
      missionsCompleted + " terminal" + (missionsCompleted === 1 ? "" : "s") +
      " completed • arrival adds one bonus car</span>";
  }

  function placeHeadFromNode(nodeId, edgeId) {
    const edge = edgeById(edgeId);
    const out = outgoingVector(edge, nodeId);
    const inset = Math.min(10, Math.max(2, edge.len * 0.08));
    const s = out.dir > 0 ? inset : edge.len - inset;
    return { edge, s, dir: out.dir, headingX: out.x, headingY: out.y };
  }

  function ringBell() {
    // A short synthetic bell keeps the game dependency-free and works offline.
    if (muteSounds.checked) return;
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;
      const gain = audioCtx.createGain();
      const o1 = audioCtx.createOscillator();
      const o2 = audioCtx.createOscillator();
      o1.type = "sine";
      o2.type = "sine";
      o1.frequency.setValueAtTime(1046.5, now);
      o2.frequency.setValueAtTime(1568, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
      o1.connect(gain);
      o2.connect(gain);
      gain.connect(audioCtx.destination);
      o1.start(now);
      o2.start(now);
      o1.stop(now + 0.34);
      o2.stop(now + 0.34);
    } catch (_) {
      // Audio is optional; gameplay should never depend on browser audio policy.
    }
  }

  function pickupChime() {
    // An original transit-esque three-note acknowledgement, not a sampled TTC sound.
    if (muteSounds.checked) return;
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;
      const notes = [
        { f: 659.25, at: 0.00, dur: 0.12 },
        { f: 987.77, at: 0.11, dur: 0.13 },
        { f: 783.99, at: 0.24, dur: 0.18 },
      ];

      for (const note of notes) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(note.f, now + note.at);
        gain.gain.setValueAtTime(0.0001, now + note.at);
        gain.gain.exponentialRampToValueAtTime(0.095, now + note.at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + note.at + note.dur);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + note.at);
        osc.stop(now + note.at + note.dur + 0.02);
      }
    } catch (_) {
      // Sound is optional; gameplay must survive browser audio restrictions.
    }
  }

  function routeKeys(edge) {
    const keys = new Set();
    for (const tag of edge.tags) {
      const match = String(tag).match(/^(\d+)([A-Z])?$/);
      if (!match) continue;
      keys.add(match[0]);
      keys.add(match[1]);
    }
    return keys;
  }

  function routeContinuityBonus(currentEdge, candidate) {
    if (!currentEdge || !candidate || currentEdge === candidate) return 0;
    const current = routeKeys(currentEdge);
    const next = routeKeys(candidate);
    let shared = 0;
    for (const key of current) if (next.has(key)) shared++;

    let bonus = Math.min(5.5, shared * 2.4);
    if (candidate.tags.includes("yard")) bonus -= 3.5;
    if ((candidate.tags.includes("diversion") || candidate.tags.includes("track")) &&
        !currentEdge.tags.includes("diversion") && !currentEdge.tags.includes("track")) {
      bonus -= 1.2;
    }

    // Route Missions get an extra nudge toward the assigned route when the
    // player has not explicitly thrown the turnout.
    if (currentMission) {
      const missionBase = currentMission.def.route.match(/^\d+/)?.[0];
      if (candidate.tags.some((tag) => String(tag).startsWith(missionBase))) bonus += 1.4;
    }
    return bonus;
  }

  function previewNextEdge(nodeId, currentEdge, headingX, headingY) {
    // Hey, this is the complicated part: manual input wins, then direction,
    // then route continuity keeps an unplanned turn from feeling random.
    let candidates = (adjacency.get(nodeId) || []).filter((edge) => edge.id !== blockedEdgeId);
    if (!candidates.length) return null;

    // Respect a manually thrown switch or queued steering when possible so the
    // opening pickup appears on the path the player is actually trying to take.
    if (manualSwitchEdgeId) {
      const manual = candidates.find((edge) => edge.id === manualSwitchEdgeId);
      if (manual) {
        const out = outgoingVector(manual, nodeId);
        return { edge: manual, dir: out.dir, vec: out };
      }
    }

    const target = queuedDirection ? desiredVector(queuedDirection) : { x: headingX, y: headingY };
    let choice = null;
    let score = -Infinity;

    for (const edge of candidates) {
      const out = outgoingVector(edge, nodeId);
      let value = out.x * target.x + out.y * target.y;

      // Without an explicit steering request, stay on the same TTC corridor.
      if (!queuedDirection) value += routeContinuityBonus(currentEdge, edge);

      // Avoid tracing backwards unless a terminal leaves no other option.
      if (edge === currentEdge && candidates.length > 1) value -= 3.0;
      if (value > score) {
        score = value;
        choice = { edge, dir: out.dir, vec: out };
      }
    }
    return choice;
  }

  function pointAheadOfHead(distance) {
    let edge = head.edge;
    let s = head.s;
    let dir = head.dir;
    let hx = head.headingX;
    let hy = head.headingY;
    let remaining = distance;

    for (let guard = 0; guard < 16; guard++) {
      const towardEnd = dir > 0;
      const available = towardEnd ? edge.len - s : s;

      if (remaining <= available) {
        const targetS = s + remaining * dir;
        const p = pointAt(edge, targetS);
        return {
          edge,
          s: targetS,
          x: p.x,
          y: p.y,
          angle: p.angle + (dir < 0 ? Math.PI : 0),
        };
      }

      remaining -= available;
      const nodeId = towardEnd ? edge.b : edge.a;
      const next = previewNextEdge(nodeId, edge, hx, hy);
      if (!next) break;

      edge = next.edge;
      dir = next.dir;
      s = dir > 0 ? 0 : edge.len;
      hx = next.vec.x;
      hy = next.vec.y;
    }

    // A very short dead-end still gets an assist: put the car near the end the
    // player is currently approaching.
    const targetS = dir > 0 ? Math.max(0, edge.len - 8) : Math.min(edge.len, 8);
    const p = pointAt(edge, targetS);
    return { edge, s: targetS, x: p.x, y: p.y, angle: p.angle + (dir < 0 ? Math.PI : 0) };
  }

  // -------------------------------------------------------------------------
  // Pickup pacing and challenge events
  // -------------------------------------------------------------------------

  function makeOpeningPickup(urgent = false) {
    const metresPerSecond = Math.max(8, speedKph / 3.6);
    const distance = urgent
      ? 45
      : Math.max(85, Math.min(210, metresPerSecond * OPENING_PICKUP_SECONDS_AHEAD));
    return { ...pointAheadOfHead(distance), assisted: true };
  }

  function maintainOpeningPickup(t) {
    if (firstPickupCollected || !running || dead) return;

    const elapsed = t - runStartedAt;
    const urgent = elapsed >= 22000;
    const refreshEvery = urgent ? 2600 : OPENING_ASSIST_REFRESH_MS;
    const hasAssist = pickups.some((pickup) => pickup.assisted);

    if (!hasAssist || t - openingAssistPlacedAt >= refreshEvery) {
      pickups = pickups.filter((pickup) => !pickup.assisted);
      pickups.unshift(makeOpeningPickup(urgent));
      openingAssistPlacedAt = t;

      // Keep the total collectible count stable.
      while (pickups.length > PICKUP_COUNT) pickups.pop();
    }
  }

  function desiredPickupCount() {
    // Faster play needs a denser world. Cap it so Arcade does not turn
    // the canvas into a Flexity particle accelerator.
    return Math.max(PICKUP_COUNT, Math.min(32, 9 + Math.floor(speedKph / 42)));
  }

  function makePacePickup() {
    const metresPerSecond = Math.max(12, speedKph / 3.6);
    const secondsAhead = operatorMode === "arcade" ? 2.6 : 4.2;
    const distance = Math.max(120, Math.min(780, metresPerSecond * secondsAhead));
    return { ...pointAheadOfHead(distance), pace: true };
  }

  function maintainPickupDensity(t) {
    if (!firstPickupCollected || !running || dead) return;

    const desired = desiredPickupCount();
    while (pickups.length < desired) pickups.push(makePickup());

    // Long straightaways always get something to chase. Re-target this single
    // pace car periodically so it follows the route the player actually takes.
    const interval = Math.max(1400, 5200 - speedKph * 4.0);
    if (t - lastPacePickupAt >= interval) {
      pickups = pickups.filter((pickup) => !pickup.pace);
      pickups.unshift(makePacePickup());
      lastPacePickupAt = t;

      while (pickups.length > desired) {
        const removeIndex = pickups.findLastIndex((pickup) => !pickup.pace && !pickup.assisted);
        if (removeIndex < 0) break;
        pickups.splice(removeIndex, 1);
      }
    }
  }

  function tailPressure() {
    // 0..1 based purely on earned train length. The game gets harder because
    // the snake gets longer, not because an invisible clock says so.
    return Math.max(0, Math.min(1, (trainCars - 8) / 32));
  }

  function distanceToPlacedTail(x, y) {
    const poses = getTrainPoses();
    let best = Infinity;
    for (let i = 5; i < poses.length; i++) {
      const pose = poses[i];
      if (pose.placed === false) continue;
      best = Math.min(best, Math.hypot(x - pose.x, y - pose.y));
    }
    return best;
  }

  function makeChallengeZone() {
    // Pick a reachable-looking position, with more tail pressure as the train grows.
    const pressure = tailPressure();
    const hp = pointAt(head.edge, head.s);
    let best = null;
    let bestScore = -Infinity;

    for (let attempts = 0; attempts < 90; attempts++) {
      const edge = edges[Math.floor(Math.random() * edges.length)];
      if (edge.len < 80 || edge.tags.includes("yard") && Math.random() < .75) continue;

      const margin = Math.min(45, edge.len * .16);
      const s = margin + Math.random() * Math.max(1, edge.len - margin * 2);
      const p = pointAt(edge, s);
      const headDistance = Math.hypot(p.x - hp.x, p.y - hp.y);
      if (headDistance < 220 || headDistance > 3200) continue;

      const tailDistance = distanceToPlacedTail(p.x, p.y);
      // Early: favour reachable open territory. Late: favour positions near
      // older tail segments, creating the classic Snake temptation to loop back.
      const tailTarget = 120 + (1 - pressure) * 340;
      const tailScore = Number.isFinite(tailDistance)
        ? -Math.abs(tailDistance - tailTarget) / 160
        : -3;
      const travelScore = -headDistance / 1800;
      const score = tailScore * (0.35 + pressure * 1.8) + travelScore + Math.random() * .8;

      if (score > bestScore) {
        bestScore = score;
        best = { edge, s, x: p.x, y: p.y, angle: p.angle };
      }
    }

    if (!best) best = pointAheadOfHead(500);
    const multiplier = Math.random() < (0.10 + pressure * 0.08) ? 3 : 2;
    return {
      ...best,
      multiplier,
      expiresAt: performance.now() + (multiplier === 3 ? 12000 : 16000),
    };
  }

  function addGameEffect(text, kind = "normal", duration = 1000) {
    gameEffects.push({
      text,
      kind,
      createdAt: performance.now(),
      duration,
    });
    if (gameEffects.length > 8) gameEffects.shift();
  }

  function updateChallengeZone(t) {
    if (!firstPickupCollected || !running || dead) return;

    if (challengeZone && t >= challengeZone.expiresAt) {
      challengeZone = null;
      nextChallengeAt = t + 18000 + Math.random() * 16000;
    }

    if (!challengeZone && t >= nextChallengeAt) {
      challengeZone = makeChallengeZone();
      eventBanner.textContent = challengeZone.multiplier === 3
        ? "RARE ×3 ZONE: reach it before it disappears — your next pickup triples."
        : "×2 ZONE: reach it before it disappears — your next pickup doubles.";
      eventBanner.hidden = false;
    }

    if (!challengeZone) return;

    const hp = pointAt(head.edge, head.s);
    if (Math.hypot(hp.x - challengeZone.x, hp.y - challengeZone.y) < 28) {
      pickupMultiplier = challengeZone.multiplier;
      addGameEffect("×" + pickupMultiplier + " ARMED", pickupMultiplier === 3 ? "rare" : "bonus", 1350);
      eventBanner.textContent = "MULTIPLIER ARMED: next streetcar pickup ×" + pickupMultiplier + "!";
      challengeZone = null;
      nextChallengeAt = t + 22000 + Math.random() * 18000;
    }
  }

  function maintainFoodMagnet(t) {
    if (!firstPickupCollected || !running || dead) return;
    const drought = t - lastPickupAt;
    if (drought < 12000) return;

    // Never let a straightaway turn into dead air. Keep one catchable car a few
    // seconds ahead and re-target it if the player changes route.
    const existing = pickups.find((pickup) => pickup.magnet);
    if (existing && drought < 18000) return;

    pickups = pickups.filter((pickup) => !pickup.magnet);
    const metresPerSecond = Math.max(12, speedKph / 3.6);
    const distance = Math.max(90, Math.min(900, metresPerSecond * 3.4));
    pickups.unshift({ ...pointAheadOfHead(distance), magnet: true });
    lastPacePickupAt = t;
  }

  function chooseStartingHead() {
    // Missions start on their route; Free Play starts anywhere useful.
    if (gameMode === "mission") {
      const def = MISSION_DEFS[Math.floor(Math.random() * MISSION_DEFS.length)];
      currentMission = buildMission(def, Math.random() < 0.5);
      head = randomHeadOnEdges(missionEdges(def));
      tip.textContent = currentMission.def.route + " " + currentMission.def.name +
        ": you entered service mid-route. Take it to " + nodes.get(currentMission.targetNode).label + ".";
      return;
    }

    const candidates = edges.filter((edge) =>
      !edge.tags.includes("yard") && edge.len > 100
    );
    head = randomHeadOnEdges(candidates);
    tip.textContent = "Free Play — randomized start. The entire network is yours.";
  }

  function seedFreshTrail() {
    // The first trail point is the lead car's position on its virtual rail.
    const laneP = lanePointAt(head.edge, head.s, head.dir);
    trail.push({ x: laneP.x, y: laneP.y, d: 0 });
    camera.x = laneP.x;
    camera.y = laneP.y;
    camera.scale = 0.7;
    cameraZoomFactor = 1;
  }

  function seedInitialPickups() {
    pickups = [makeOpeningPickup()];
    for (let i = 1; i < PICKUP_COUNT; i++) pickups.push(makePickup());
    lastPickupAt = performance.now();
    nextChallengeAt = performance.now() + 18000 + Math.random() * 14000;
  }

  function restoreTrail(checkpoint, headPoint, edge, sOnEdge, dir) {
    // Hey, this is the complicated part: saved cars are points, but movement
    // needs one continuous distance trail to place the cars smoothly.
    trail = [];
    trailStart = 0;
    trailDistance = 0;

    // Saved car centres are head-to-tail; the movement trail is tail-to-head.
    const savedShape = Array.isArray(checkpoint.tr) ? checkpoint.tr : [];
    if (savedShape.length >= 2) {
      const points = savedShape.map((pair) => ({
        x: headPoint.x + Number(pair[0] || 0),
        y: headPoint.y + Number(pair[1] || 0),
      })).reverse();

      for (const point of points) {
        const last = trail[trail.length - 1];
        if (last) {
          trailDistance += Math.max(0.1, Math.hypot(point.x - last.x, point.y - last.y));
        }
        trail.push({ x: point.x, y: point.y, d: trailDistance });
      }

      const laneP = lanePointAt(edge, sOnEdge, dir);
      const last = trail[trail.length - 1];
      const finalGap = Math.hypot(laneP.x - last.x, laneP.y - last.y);
      if (finalGap > 0.1) {
        trailDistance += finalGap;
        trail.push({ x: laneP.x, y: laneP.y, d: trailDistance });
      }
      return;
    }

    const laneP = lanePointAt(edge, sOnEdge, dir);
    trail.push({ x: laneP.x, y: laneP.y, d: 0 });
  }

  // Reset and restore both rebuild the playable train state. Keeping them
  // together makes checkpoint compatibility easier to reason about.
  function resetGame() {
    // Start a completely new run using the selected modes.
    trainCars = 1;
    queuedDirection = null;
    manualSwitchEdgeId = null;
    switchSignature = "";
    dead = false;
    trail = [];
    trailStart = 0;
    trailDistance = 0;
    missionsCompleted = 0;
    firstPickupCollected = false;
    runStartedAt = 0;
    openingAssistPlacedAt = 0;
    lastPacePickupAt = 0;
    collisionFrames = 0;
    lastPickupAt = 0;
    challengeZone = null;
    nextChallengeAt = Infinity;
    pickupMultiplier = 1;
    gameEffects = [];
    terminalCollisionGraceM = 0;
    gameMode = gameModeSelect.value;
    operatorMode = operatorModeSelect.value;
    speedKph = MODE_START_SPEED_KPH[operatorMode] ?? MODE_START_SPEED_KPH.arcade;
    acceleratorHeld = false;
    brakeHeld = false;
    currentMission = null;

    chooseStartingHead();
    seedFreshTrail();

    chaos = null;
    blockedEdgeId = null;
    eventBanner.hidden = true;

    // Do not throw a service disruption at the player before the first reward.
    nextChaosAt = Infinity;

    seedInitialPickups();
    updateHud();
    updateSwitchPanel(true);
  }

  function restoreGame(checkpoint) {
    // Rebuild a run from the small, cookie-safe checkpoint format.
    queuedDirection = null;
    manualSwitchEdgeId = null;
    switchSignature = "";
    dead = false;
    collisionFrames = 0;
    lastPickupAt = performance.now();
    challengeZone = null;
    nextChallengeAt = performance.now() + 18000 + Math.random() * 14000;
    pickupMultiplier = 1;
    gameEffects = [];
    terminalCollisionGraceM = 0;
    missionsCompleted = Number(checkpoint.mc) || 0;
    firstPickupCollected = true;
    runStartedAt = 0;
    openingAssistPlacedAt = 0;
    lastPacePickupAt = 0;

    trainCars = Math.max(2, Number(checkpoint.c) || 2);
    gameMode = checkpoint.gm === "mission" ? "mission" : "free";
    // Old Airplane checkpoints migrate forward into the new Arcade mode.
    operatorMode = checkpoint.om === "realistic" ? "realistic" : "arcade";

    gameModeSelect.value = gameMode;
    operatorModeSelect.value = operatorMode;

    speedKph = Number(checkpoint.sp) || MODE_START_SPEED_KPH[operatorMode];
    speedKph = Math.max(0, Math.min(speedCapKph(), speedKph));

    const edge = edgeById(checkpoint.e);
    const dir = checkpoint.d < 0 ? -1 : 1;
    const savedS = Number(checkpoint.s);
    const sOnEdge = Math.max(0, Math.min(edge.len, Number.isFinite(savedS) ? savedS : 0));
    const hp = pointAt(edge, sOnEdge);
    const heading = hp.angle + (dir < 0 ? Math.PI : 0);
    head = {
      edge,
      s: sOnEdge,
      dir,
      headingX: Math.cos(heading),
      headingY: Math.sin(heading),
    };

    currentMission = null;
    if (gameMode === "mission" && checkpoint.mr) {
      const def = MISSION_DEFS.find((item) => item.route === checkpoint.mr);
      if (def) currentMission = buildMission(def, Boolean(checkpoint.rv));
    }

    restoreTrail(checkpoint, hp, edge, sOnEdge, dir);

    camera.x = hp.x;
    camera.y = hp.y;
    camera.scale = 0.7;
    cameraZoomFactor = 1;

    chaos = null;
    blockedEdgeId = null;
    eventBanner.hidden = true;
    nextChaosAt = performance.now() + 20000 + Math.random() * 18000;

    pickups = [];
    while (pickups.length < desiredPickupCount()) pickups.push(makePickup());

    tip.textContent = "Resumed checkpoint — " + trainCars + " streetcars back in service.";
    updateStartButton();
    updateHud();
    updateSwitchPanel(true);
  }

  function makePickup() {
    // Random pickups avoid the head and each other so they remain catchable.
    // Prefer actual running/diversion track; yard pickups are deliberately rarer.
    for (let attempts = 0; attempts < 100; attempts++) {
      const edge = edges[Math.floor(Math.random() * edges.length)];
      if (edge.len < 40) continue;
      if (edge.tags.includes("yard") && Math.random() < 0.7) continue;
      const margin = Math.min(35, edge.len * 0.15);
      const s = margin + Math.random() * Math.max(1, edge.len - margin * 2);
      const p = pointAt(edge, s);

      if (head) {
        const hp = pointAt(head.edge, head.s);
        if (Math.hypot(p.x - hp.x, p.y - hp.y) < 260) continue;
      }
      if (pickups.some((other) => Math.hypot(p.x - other.x, p.y - other.y) < 250)) continue;
      return { edge, s, x: p.x, y: p.y, angle: p.angle };
    }

    const edge = edges[Math.floor(Math.random() * edges.length)];
    const s = edge.len * 0.5;
    const p = pointAt(edge, s);
    return { edge, s, x: p.x, y: p.y, angle: p.angle };
  }

  // -------------------------------------------------------------------------
  // Track movement and switch selection
  // -------------------------------------------------------------------------

  function queueDirection(dir) {
    queuedDirection = dir;
    manualSwitchEdgeId = null;
    const button = document.querySelector('[data-dir="' + dir + '"]');
    if (button) {
      button.classList.add("active");
      setTimeout(() => button.classList.remove("active"), 110);
    }
  }

  function desiredVector(dir) {
    if (dir === "up") return { x: 0, y: -1 };
    if (dir === "down") return { x: 0, y: 1 };
    if (dir === "left") return { x: -1, y: 0 };
    return { x: 1, y: 0 };
  }

  function chooseNextEdge(nodeId, currentEdge) {
    // Select the next graph edge when the head reaches a junction.
    let candidates = adjacency.get(nodeId) || [];
    if (candidates.length === 0) return null;

    const openCandidates = candidates.filter((edge) => edge.id !== blockedEdgeId);
    if (openCandidates.length) candidates = openCandidates;

    if (manualSwitchEdgeId) {
      const manual = candidates.find((edge) => edge.id === manualSwitchEdgeId);
      manualSwitchEdgeId = null;
      queuedDirection = null;
      if (manual) {
        const out = outgoingVector(manual, nodeId);
        return { edge: manual, dir: out.dir, vec: out };
      }
    }

    // Never bounce back along the edge we just arrived on when another route
    // is available. The only valid same-edge reversal is a protected terminal
    // turnback, represented by a node with no other open candidate.
    const continuing = candidates.filter((edge) => edge !== currentEdge);
    if (continuing.length) candidates = continuing;

    if (candidates.length === 1) {
      const only = candidates[0];
      const out = outgoingVector(only, nodeId);
      return { edge: only, dir: out.dir, vec: out };
    }

    const currentVec = { x: head.headingX, y: head.headingY };
    const target = queuedDirection ? desiredVector(queuedDirection) : currentVec;
    let bestChoice = null;
    let bestScore = -Infinity;

    for (const edge of candidates) {
      const out = outgoingVector(edge, nodeId);
      let score = out.x * target.x + out.y * target.y;

      // No switch command means "stay on this service/corridor" first, geometry
      // second. This prevents accidental Dundas→Queen or similar turns.
      if (!queuedDirection) score += routeContinuityBonus(currentEdge, edge);

      // Taking the same edge from the node is a U-turn.
      if (!queuedDirection && edge === currentEdge) score -= 3.0;
      if (queuedDirection && edge === currentEdge) score -= 0.4;

      if (score > bestScore) {
        bestScore = score;
        bestChoice = { edge, dir: out.dir, vec: out };
      }
    }

    queuedDirection = null;
    return bestChoice;
  }

  function getUpcomingSwitch() {
    if (!head) return null;
    const towardEnd = head.dir > 0;
    const distance = towardEnd ? head.edge.len - head.s : head.s;
    const lookahead = Math.max(230, Math.min(1400, (speedKph / 3.6) * 4.5));
    if (distance > lookahead) return null;

    const nodeId = towardEnd ? head.edge.b : head.edge.a;
    let candidates = (adjacency.get(nodeId) || []).filter((edge) => edge !== head.edge);
    if (candidates.length < 2) return null;

    const currentVec = { x: head.headingX, y: head.headingY };
    const branches = candidates.map((edge) => {
      const out = outgoingVector(edge, nodeId);
      const cross = currentVec.x * out.y - currentVec.y * out.x;
      const dot = currentVec.x * out.x + currentVec.y * out.y;
      const angle = Math.atan2(cross, dot);
      const abs = Math.abs(angle);
      const label = abs < 0.42 ? "STRAIGHT" : (angle > 0 ? "RIGHT" : "LEFT");
      return { edge, out, angle, label, blocked: edge.id === blockedEdgeId };
    }).sort((a, b) => a.angle - b.angle);

    return { nodeId, distance, branches };
  }

  function selectSwitchBranch(edgeId) {
    const state = getUpcomingSwitch();
    if (!state) return;
    const branch = state.branches.find((item) => item.edge.id === edgeId && !item.blocked);
    if (!branch) return;
    manualSwitchEdgeId = edgeId;
    queuedDirection = null;
    updateSwitchPanel(true);
    updateLocationHud();
  }

  function selectSwitchByIntent(intent) {
    const state = getUpcomingSwitch();
    if (!state) return;
    const open = state.branches.filter((b) => !b.blocked);
    if (!open.length) return;

    let choice;
    if (intent === "left") choice = open.reduce((a, b) => a.angle < b.angle ? a : b);
    else if (intent === "right") choice = open.reduce((a, b) => a.angle > b.angle ? a : b);
    else choice = open.reduce((a, b) => Math.abs(a.angle) < Math.abs(b.angle) ? a : b);

    selectSwitchBranch(choice.edge.id);
  }

  function updateSwitchPanel(force = false) {
    const state = getUpcomingSwitch();
    if (!state) {
      switchPanel.hidden = true;
      switchSignature = "";
      return;
    }

    const signature = state.nodeId + "|" + Math.round(state.distance / 10) + "|" +
      state.branches.map((b) => b.edge.id + ":" + (b.blocked ? "x" : "")).join(",") +
      "|" + (manualSwitchEdgeId || "");
    if (!force && signature === switchSignature) return;
    switchSignature = signature;

    switchPanel.hidden = false;
    switchMeta.textContent = nodes.get(state.nodeId).label + " • " + Math.round(state.distance) + " m";
    switchChoices.innerHTML = state.branches.map((b) =>
      '<button class="switch-choice' +
      (manualSwitchEdgeId === b.edge.id ? " selected" : "") +
      (b.blocked ? " blocked" : "") +
      '" data-edge="' + b.edge.id + '"' + (b.blocked ? " disabled" : "") + '>' +
      b.label + '</button>'
    ).join("");
  }

  function appendTrailPoint(x, y) {
    const last = trail[trail.length - 1];
    if (!last) {
      trail.push({ x, y, d: trailDistance });
      return;
    }
    const seg = Math.hypot(x - last.x, y - last.y);
    if (seg < 0.25) return;
    trailDistance += seg;
    trail.push({ x, y, d: trailDistance });
  }

  const TERMINAL_LOOP_RADIUS_M = {
    union: 18,
    spadinaStation: 15,
    mainStation: 15,
    broadviewStation: 15,
    stClairYonge: 15,
  };

  // Terminal handling keeps endpoints playable by synthesizing a short
  // turnback instead of allowing the consist to collide with the buffer.
  function terminalTurnbackRadius(nodeId) {
    const node = nodes.get(nodeId);
    if (TERMINAL_LOOP_RADIUS_M[nodeId]) return TERMINAL_LOOP_RADIUS_M[nodeId];
    if (node?.type === "station") return 14;
    if (node?.type === "loop") return 12;
    if (node?.type === "carhouse") return 10;
    return 10;
  }

  function addTerminalTurnaround(nodeId, edge, incomingDir, outgoingDir) {
    // A same-edge reversal at any terminal-like node is treated as a physical
    // loop/turnback rather than a literal U-turn on one centreline. This matters
    // at multi-branch terminals such as Humber, Exhibition and Dufferin Gate as
    // well as degree-1 terminals such as Union.
    const incident = adjacency.get(nodeId) || [];
    const node = nodes.get(nodeId);
    const terminalLike = node && ["loop", "station", "carhouse"].includes(node.type);
    if ((!terminalLike && incident.length !== 1) || !incident.includes(edge) || incomingDir === outgoingDir) return;
    const inbound = lanePointAt(edge, incomingDir > 0 ? edge.len : 0, incomingDir);
    const outbound = lanePointAt(edge, outgoingDir > 0 ? 0 : edge.len, outgoingDir);

    let a0 = Math.atan2(inbound.y - node.y, inbound.x - node.x);
    let a1 = Math.atan2(outbound.y - node.y, outbound.x - node.x);
    let delta = a1 - a0;
    while (delta <= -Math.PI) delta += Math.PI * 2;
    while (delta > Math.PI) delta -= Math.PI * 2;
    if (Math.abs(delta) < Math.PI * 0.75) delta = delta >= 0 ? Math.PI : -Math.PI;

    const radius = Math.max(
      terminalTurnbackRadius(nodeId),
      TRACK_LANE_OFFSET_M,
      Math.hypot(inbound.x - node.x, inbound.y - node.y)
    );

    const steps = Math.max(12, Math.ceil(Math.PI * radius / 2.5));
    for (let i = 1; i <= steps; i++) {
      const a = a0 + delta * (i / steps);
      appendTrailPoint(node.x + Math.cos(a) * radius, node.y + Math.sin(a) * radius);
    }

    terminalCollisionGraceM = Math.max(terminalCollisionGraceM, CAR_LENGTH_M * 3.5);
  }

  function advanceHead(distance) {
    // Move in metres, crossing as many graph edges as this step requires.
    if (terminalCollisionGraceM > 0) {
      terminalCollisionGraceM = Math.max(0, terminalCollisionGraceM - distance);
    }
    let remaining = distance;
    let guard = 0;

    while (remaining > 0 && guard++ < 20) {
      const towardEnd = head.dir > 0;
      const available = towardEnd ? head.edge.len - head.s : head.s;

      if (remaining <= available) {
        head.s += remaining * head.dir;
        const p = pointAt(head.edge, head.s);
        const a = p.angle + (head.dir < 0 ? Math.PI : 0);
        head.headingX = Math.cos(a);
        head.headingY = Math.sin(a);
        remaining = 0;
        break;
      }

      head.s = towardEnd ? head.edge.len : 0;
      remaining -= available;
      const nodeId = towardEnd ? head.edge.b : head.edge.a;
      handleNodeArrival(nodeId);
      const previousEdge = head.edge;
      const previousDir = head.dir;
      const next = chooseNextEdge(nodeId, previousEdge);
      if (!next) break;

      if (next.edge === previousEdge && next.dir !== previousDir) {
        addTerminalTurnaround(nodeId, previousEdge, previousDir, next.dir);
      }

      head.edge = next.edge;
      head.dir = next.dir;
      head.s = next.dir > 0 ? 0 : next.edge.len;
      head.headingX = next.vec.x;
      head.headingY = next.vec.y;

      if (chaos?.type === "doNotEnter" && head.edge.id === blockedEdgeId) {
        gameOver("doNotEnter");
        return;
      }
    }
  }

  function addTrailSample() {
    const p = lanePointAt(head.edge, head.s, head.dir);
    const last = trail[trail.length - 1];
    if (!last) {
      trail.push({ x: p.x, y: p.y, d: trailDistance });
      return;
    }

    const seg = Math.hypot(p.x - last.x, p.y - last.y);
    if (seg >= 1.2) {
      trailDistance += seg;
      trail.push({ x: p.x, y: p.y, d: trailDistance });
    }

    // Advance a logical start index rather than shifting the array every frame.
    const cutoff = trailDistance - (totalTrainLength() + 180);
    while (trailStart < trail.length - 2 && trail[trailStart + 1].d < cutoff) trailStart++;

    // Compact only occasionally, amortizing the cost over hundreds of samples.
    if (trailStart > 600) {
      trail = trail.slice(trailStart);
      trailStart = 0;
    }
  }

  function getTrainPoses() {
    // Read car positions backward from the head along the distance-indexed trail.
    if (!trail.length) return [];
    if (trail.length - trailStart === 1) {
      return Array.from({ length: trainCars }, (_, index) => ({
        x: trail[trailStart].x,
        y: trail[trailStart].y,
        angle: 0,
        placed: index === 0,
      }));
    }

    const poses = [];
    let cursor = trail.length - 1;

    for (let car = 0; car < trainCars; car++) {
      const wanted = trailDistance - car * CAR_SPACING_M;

      if (wanted <= trail[trailStart].d) {
        const oldest = trail[trailStart];
        poses.push({
          x: oldest.x,
          y: oldest.y,
          angle: poses.at(-1)?.angle || 0,
          placed: false,
        });
        continue;
      }

      while (cursor > trailStart + 1 && trail[cursor - 1].d > wanted) cursor--;
      const newer = trail[cursor];
      const older = trail[cursor - 1];
      const span = Math.max(0.0001, newer.d - older.d);
      const t = Math.max(0, Math.min(1, (wanted - older.d) / span));
      poses.push({
        x: older.x + (newer.x - older.x) * t,
        y: older.y + (newer.y - older.y) * t,
        angle: Math.atan2(newer.y - older.y, newer.x - older.x),
        placed: true,
      });
    }

    return poses;
  }

  function checkPickups() {
    const p = pointAt(head.edge, head.s);
    for (let i = pickups.length - 1; i >= 0; i--) {
      const pickup = pickups[i];
      if (Math.hypot(p.x - pickup.x, p.y - pickup.y) < 22) {
        const wasFirstPickup = !firstPickupCollected;
        const gainedCars = Math.max(1, pickupMultiplier);
        trainCars += gainedCars;
        pickupMultiplier = 1;
        lastPickupAt = performance.now();
        pickups.splice(i, 1);

        if (wasFirstPickup) {
          firstPickupCollected = true;
          // Any stale onboarding assist vanishes once the player has learned the
          // basic loop. From here on out the cars belong to the normal system.
          pickups = pickups.filter((other) => !other.assisted);
          nextChaosAt = performance.now() + 20000 + Math.random() * 18000;
        }

        while (pickups.length < desiredPickupCount()) pickups.push(makePickup());
        pickupChime();
        addGameEffect(
          gainedCars > 1 ? "+" + gainedCars + " CARS!" : "+1 CAR",
          gainedCars >= 3 ? "rare" : gainedCars === 2 ? "bonus" : "normal",
          gainedCars > 1 ? 1350 : 900
        );
        saveBest();
        saveResumeCheckpoint();
        updateHud();
        tip.textContent = gainedCars > 1
          ? "MULTIPLIER! +" + gainedCars + " streetcars — " + trainCars + " total."
          : trainCars >= 40
            ? "Forty cars. Transit Control has stopped asking questions."
            : trainCars + " cars: " + Math.round(totalTrainLength()) + " metres of extremely unofficial TTC.";
        break;
      }
    }
  }

  function handleNodeArrival(nodeId) {
    if (gameMode !== "mission" || !currentMission || nodeId !== currentMission.targetNode) return;

    missionsCompleted++;
    trainCars++;
    ringBell();
    saveBest();

    currentMission = buildMission(currentMission.def, !currentMission.reverse);
    // At compressed terminal loops, prime the correct departure leg so the
    // turnaround behaves like a route reversal instead of choosing a random spur.
    manualSwitchEdgeId = currentMission.startEdge;
    saveResumeCheckpoint();

    tip.textContent = "Terminal reached. Bonus car coupled. Now " +
      currentMission.def.route + " back to " + nodes.get(currentMission.targetNode).label + ".";
    updateHud();
  }

  function pointSegmentDistance(px, py, ax, ay, bx, by) {
    const vx = bx - ax;
    const vy = by - ay;
    const denom = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / denom));
    return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
  }

  function orient(ax, ay, bx, by, cx, cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  }

  function segmentsIntersect(a, b, c, d) {
    const o1 = orient(a.x, a.y, b.x, b.y, c.x, c.y);
    const o2 = orient(a.x, a.y, b.x, b.y, d.x, d.y);
    const o3 = orient(c.x, c.y, d.x, d.y, a.x, a.y);
    const o4 = orient(c.x, c.y, d.x, d.y, b.x, b.y);
    return o1 * o2 < 0 && o3 * o4 < 0;
  }

  function capsuleAxis(pose) {
    const half = CAR_LENGTH_M * 0.42;
    const dx = Math.cos(pose.angle) * half;
    const dy = Math.sin(pose.angle) * half;
    return {
      a: { x: pose.x - dx, y: pose.y - dy },
      b: { x: pose.x + dx, y: pose.y + dy },
    };
  }

  function segmentDistance(s1, s2) {
    if (segmentsIntersect(s1.a, s1.b, s2.a, s2.b)) return 0;
    return Math.min(
      pointSegmentDistance(s1.a.x, s1.a.y, s2.a.x, s2.a.y, s2.b.x, s2.b.y),
      pointSegmentDistance(s1.b.x, s1.b.y, s2.a.x, s2.a.y, s2.b.x, s2.b.y),
      pointSegmentDistance(s2.a.x, s2.a.y, s1.a.x, s1.a.y, s1.b.x, s1.b.y),
      pointSegmentDistance(s2.b.x, s2.b.y, s1.a.x, s1.a.y, s1.b.x, s1.b.y)
    );
  }

  function checkSelfCollision(poses) {
    // Cars are long capsules, so collision matches the vehicle shape better
    // than comparing only their centre points.
    if (terminalCollisionGraceM > 0) {
      collisionFrames = 0;
      return false;
    }
    if (trainCars < 6 || poses.length < 6) {
      collisionFrames = 0;
      return false;
    }

    const lead = capsuleAxis(poses[0]);
    let touching = false;

    // A newly lengthened train can temporarily have more cars than recorded
    // trail behind it. Those tail entries are layout placeholders, not physical
    // cars, and must never participate in collision detection.
    for (let i = 5; i < poses.length; i++) {
      if (poses[i].placed === false) continue;
      if (segmentDistance(lead, capsuleAxis(poses[i])) < 2.5) {
        touching = true;
        break;
      }
    }

    // A one-frame overlap can happen from interpolation at complex special work.
    // Require sustained contact before declaring a real self-collision.
    collisionFrames = touching ? collisionFrames + 1 : 0;
    return collisionFrames >= 2;
  }

  // Disruptions are fictional gameplay events layered over the static graph.
  function startChaos(t) {
    if (!running || dead) return;
    const choices = ["slow", "block", "doNotEnter"];
    const type = choices[Math.floor(Math.random() * choices.length)];

    if (type === "slow") {
      chaos = { type, until: t + 12000 };
      eventBanner.textContent = "TRANSIT CONTROL: slow order — " +
        slowOrderCapKph() + " km/h for 12 seconds.";
    } else {
      const options = edges.filter((edge) =>
        edge !== head.edge && !edge.tags.includes("yard") && edge.len > 120
      );
      const edge = options[Math.floor(Math.random() * options.length)];
      if (!edge) return;
      blockedEdgeId = edge.id;

      if (type === "doNotEnter") {
        chaos = { type, until: t + 24000, edgeId: edge.id };
        eventBanner.textContent = "DO NOT ENTER: " +
          nodes.get(edge.a).label + " ↔ " + nodes.get(edge.b).label + " closed — find another way.";
      } else {
        chaos = { type, until: t + 19000, edgeId: edge.id };
        eventBanner.textContent = "STALLED CAR: " +
          nodes.get(edge.a).label + " ↔ " + nodes.get(edge.b).label + " blocked — divert.";
      }
    }

    eventBanner.hidden = false;
  }

  function updateChaos(t) {
    if (chaos && t >= chaos.until) {
      chaos = null;
      blockedEdgeId = null;
      if (!challengeZone && pickupMultiplier === 1) eventBanner.hidden = true;
      nextChaosAt = t + 30000 + Math.random() * 26000;
      updateSwitchPanel(true);
    } else if (!chaos && t >= nextChaosAt) {
      startChaos(t);
    }
  }

  function gameOver(reason = "selfCollision") {
    dead = true;
    running = false;
    chaos = null;
    blockedEdgeId = null;
    eventBanner.hidden = true;
    saveBest();
    clearResumeCheckpoint();
    updateHud();
    overlay.classList.add("crash-state");
    overlay.classList.remove("hidden");
    overlayTitle.textContent = reason === "doNotEnter" ? "Absolutely not." : "Service suspended";
    overlayLead.innerHTML = reason === "doNotEnter"
      ? "You entered a <strong>DO NOT ENTER</strong> section.<small>Transit Control has removed you from service with unusual efficiency.</small>"
      : "You built a <strong>" + trainCars + "-car</strong> monster.<small>" +
        Math.round(totalTrainLength()) + " m of streetcar before it ate itself.</small>";
    overlayHero.style.display = "flex";
    overlayRules.style.display = "none";
    overlayStatus.hidden = false;
    overlayStatus.textContent = "High score: " + best + " joined streetcars.";
    overlayExtra.hidden = true;
    overlayJoke.textContent = reason === "doNotEnter"
      ? "⛔ The sign was, in fairness, fairly specific."
      : "🚧 Please stand by while Transit Control invents an explanation.";
    startBtn.textContent = "Begin new game";
  }


  // -------------------------------------------------------------------------
  // Camera + drawing
  // -------------------------------------------------------------------------

  function worldToScreen(x, y) {
    return {
      x: (x - camera.x) * camera.scale + W / 2,
      y: (y - camera.y) * camera.scale + H / 2,
    };
  }

  function updateCamera(poses) {
    // Frame the lead and tail together, then ease toward the target for smooth motion.
    const headPose = poses[0];
    if (!headPose) return;
    const tailPose = poses[poses.length - 1] || headPose;
    const mobile = W < 600;

    // Keep a short train close enough that motion reads as motion. The previous
    // ~1 km minimum view width made 100+ km/h look oddly sedate on phones.
    const baseViewWidth = mobile ? 500 : 820;
    const desiredViewWidth = Math.max(baseViewWidth, totalTrainLength() * 1.38);
    const maxScale = mobile ? 0.92 : 1.28;
    const fitScale = Math.max(0.20, Math.min(maxScale, W / desiredViewWidth));
    const targetScale = Math.max(0.06, Math.min(2.8, fitScale * cameraZoomFactor));

    // Look a little ahead of the car so high speed feels directional while the
    // tail still influences framing as the consist gets absurdly long.
    const speedFactor = Math.min(1, speedKph / 120);
    const lookAhead = (mobile ? 65 : 95) * speedFactor;
    const headWeight = totalTrainLength() < 300 ? 0.82 : 0.70;
    const targetX = headPose.x * headWeight + tailPose.x * (1 - headWeight) +
      head.headingX * lookAhead;
    const targetY = headPose.y * headWeight + tailPose.y * (1 - headWeight) +
      head.headingY * lookAhead;

    camera.x += (targetX - camera.x) * 0.10;
    camera.y += (targetY - camera.y) * 0.10;
    camera.scale += (targetScale - camera.scale) * 0.09;
  }

  function drawWater() {
    // Approximate shoreline only; this is decorative geographic context.
    const shoreGeo = [
      // West end / Humber Bay. Keep the decorative shoreline south of the
      // Lake Shore streetcar corridor instead of cutting a giant diagonal
      // from Long Branch to Humber Loop.
      [43.584, -79.550],
      [43.589, -79.535],
      [43.597, -79.520],
      [43.607, -79.505],
      [43.618, -79.496],
      [43.626, -79.491],
      [43.628, -79.480],
      [43.629, -79.465],
      [43.631, -79.450],
      [43.632, -79.445],

      // Central/east waterfront remains intentionally approximate.
      [43.633, -79.420], [43.635, -79.400], [43.639, -79.382],
      [43.645, -79.360], [43.652, -79.330], [43.660, -79.300],
      [43.665, -79.275],
    ];
    const shore = shoreGeo.map(([lat, lon]) => project(lat, lon));
    ctx.beginPath();
    const first = worldToScreen(shore[0].x, shore[0].y);
    ctx.moveTo(first.x, first.y);
    for (const p of shore.slice(1)) {
      const s = worldToScreen(p.x, p.y);
      ctx.lineTo(s.x, s.y);
    }
    ctx.lineTo(W + 200, H + 200);
    ctx.lineTo(-200, H + 200);
    ctx.closePath();
    ctx.fillStyle = "#bed8e5";
    ctx.fill();
  }

  function drawNetworkLayer(targetCtx, scale, path, outer, inner, width, alpha) {
    // Each layer gets an outline and a lighter rail centre.
    targetCtx.globalAlpha = alpha;
    targetCtx.strokeStyle = outer;
    targetCtx.lineWidth = width / scale;
    targetCtx.stroke(path);
    targetCtx.globalAlpha = .82;
    targetCtx.strokeStyle = inner;
    targetCtx.lineWidth = 1.2 / scale;
    targetCtx.stroke(path);
  }

  function drawNetwork(targetCtx = ctx, scale = camera.scale, tx = W / 2 - camera.x * camera.scale, ty = H / 2 - camera.y * camera.scale) {
    targetCtx.save();
    targetCtx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * tx, dpr * ty);
    targetCtx.lineJoin = "round";
    targetCtx.lineCap = "round";

    drawNetworkLayer(targetCtx, scale, networkPaths.main, "#3d4044", "#d7d3ca", 5, .90);
    drawNetworkLayer(targetCtx, scale, networkPaths.diversion, "#74746f", "#d7d3ca", 5, .70);
    drawNetworkLayer(targetCtx, scale, networkPaths.yard, "#6d6a64", "#c5c0b6", 4, .72);

    targetCtx.restore();
    targetCtx.globalAlpha = 1;
  }

  function roundedRectPath(targetCtx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    targetCtx.beginPath();
    targetCtx.moveTo(x + radius, y);
    targetCtx.lineTo(x + w - radius, y);
    targetCtx.quadraticCurveTo(x + w, y, x + w, y + radius);
    targetCtx.lineTo(x + w, y + h - radius);
    targetCtx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    targetCtx.lineTo(x + radius, y + h);
    targetCtx.quadraticCurveTo(x, y + h, x, y + h - radius);
    targetCtx.lineTo(x, y + radius);
    targetCtx.quadraticCurveTo(x, y, x + radius, y);
    targetCtx.closePath();
  }

  function drawGeographyLabels() {
    // Labels are screen-space overlays so they stay readable while the map moves.
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const mobile = W < 600;
    const minimumScale = mobile ? 0.36 : 0.28;
    const showSecondary = camera.scale > (mobile ? 0.53 : 0.42);

    if (camera.scale >= minimumScale) {
      for (const item of ROAD_MARKERS) {
        if (item.priority > 1 && !showSecondary) continue;

        const p = worldToScreen(item.x, item.y);
        if (p.x < -100 || p.x > W + 100 || p.y < -60 || p.y > H + 60) continue;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(item.angle || 0);

        const fontSize = mobile ? 7.5 : 8.5;
        ctx.font = "800 " + fontSize + "px system-ui, sans-serif";
        const textWidth = ctx.measureText(item.label).width;
        const padX = mobile ? 4 : 5;
        const boxW = textWidth + padX * 2;
        const boxH = mobile ? 14 : 16;

        // Small Google/Apple-map-ish street-name plaque.
        roundedRectPath(ctx, -boxW / 2, -boxH / 2, boxW, boxH, 4);
        ctx.fillStyle = "rgba(255,255,252,.90)";
        ctx.fill();
        ctx.strokeStyle = "rgba(83,88,92,.34)";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = "rgba(46,50,54,.92)";
        ctx.fillText(item.label, 0, 0.5);
        ctx.restore();
      }
    }

    for (const item of WATER_LABELS) {
      const p = worldToScreen(item.x, item.y);
      if (p.x < -140 || p.x > W + 140 || p.y < -80 || p.y > H + 80) continue;
      ctx.font = "italic 800 12px system-ui, sans-serif";
      ctx.fillStyle = "rgba(46,95,122,.68)";
      ctx.fillText(item.label, p.x, p.y);
    }

    ctx.restore();
  }

  function drawNode(node) {
    if (!['loop', 'station', 'carhouse'].includes(node.type)) return;
    const p = worldToScreen(node.x, node.y);
    if (p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60) return;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.lineWidth = 1.5;

    if (node.type === "loop") {
      ctx.strokeStyle = "#c51d24";
      ctx.fillStyle = "#fffaf1";
      ctx.beginPath();
      ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (node.type === "station") {
      ctx.fillStyle = "#111317";
      ctx.fillRect(-4.5, -4.5, 9, 9);
    } else {
      ctx.fillStyle = "#d71920";
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(7, 6);
      ctx.lineTo(-7, 6);
      ctx.closePath();
      ctx.fill();
    }

    if (camera.scale > 0.34) {
      ctx.font = "600 10px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(20,22,25,.78)";
      ctx.fillText(node.label, 9, -9);
    }
    ctx.restore();
  }

  function drawStreetcar(pose, index, pickup = false) {
    // Draw one simplified Flexity; repeated calls make the train.
    const p = worldToScreen(pose.x, pose.y);
    if (p.x < -100 || p.x > W + 100 || p.y < -100 || p.y > H + 100) return;

    const lengthPx = Math.max(5, CAR_LENGTH_M * camera.scale);
    const widthPx = Math.max(3.4, CAR_WIDTH_M * camera.scale);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(pose.angle);

    if (pickup) {
      ctx.shadowColor = "rgba(215,25,32,.9)";
      ctx.shadowBlur = 15;
    }

    ctx.fillStyle = index === 0 && !pickup ? "#b40f15" : "#d71920";
    ctx.strokeStyle = "#fbfbf8";
    ctx.lineWidth = Math.min(1.5, Math.max(.7, camera.scale));
    ctx.fillRect(-lengthPx / 2, -widthPx / 2, lengthPx, widthPx);
    ctx.strokeRect(-lengthPx / 2, -widthPx / 2, lengthPx, widthPx);

    // Articulation joints make long trains read as modern Flexitys.
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(30,30,30,.82)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-lengthPx * .18, -widthPx / 2);
    ctx.lineTo(-lengthPx * .18, widthPx / 2);
    ctx.moveTo(lengthPx * .18, -widthPx / 2);
    ctx.lineTo(lengthPx * .18, widthPx / 2);
    ctx.stroke();

    ctx.fillStyle = "#f4f4f1";
    ctx.fillRect(lengthPx * .34, -widthPx / 2, Math.max(1.2, lengthPx * .08), widthPx);

    if (index === 0 && !pickup && currentMission && lengthPx > 18) {
      ctx.save();
      ctx.translate(lengthPx * .20, 0);
      ctx.rotate(-pose.angle);
      ctx.fillStyle = "#111";
      ctx.fillRect(-9, -6, 18, 12);
      ctx.fillStyle = "#ffb000";
      ctx.font = "900 7px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(currentMission.def.route, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawStreetcarStops() {
    // Keep stops legible without turning a zoomed-out Toronto into confetti.
    const normalSize = camera.scale < 0.12 ? 1.7 : camera.scale < 0.28 ? 2.2 : 2.8;
    const next = nextStopCache?.stop;

    for (const stop of STREETCAR_STOPS) {
      const p = worldToScreen(stop.x, stop.y);
      if (p.x < -12 || p.x > W + 12 || p.y < -12 || p.y > H + 12) continue;

      const isNext = stop === next;
      const size = isNext ? normalSize + 2.2 : normalSize;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = isNext ? "#d71920" : "rgba(35,39,43,.58)";
      ctx.strokeStyle = isNext ? "#fff" : "rgba(255,255,255,.72)";
      ctx.lineWidth = isNext ? 1.5 : .8;
      ctx.beginPath();
      ctx.rect(-size, -size, size * 2, size * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawPickups() {
    for (const pickup of pickups) {
      const pulse = 1 + Math.sin(performance.now() / 180 + pickup.x * .001) * .12;
      const p = worldToScreen(pickup.x, pickup.y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, (pickup.assisted ? 15 : pickup.magnet ? 16 : pickup.pace ? 13 : 11) * pulse, 0, Math.PI * 2);
      ctx.fillStyle = pickup.assisted
        ? "rgba(255,221,87,.72)"
        : pickup.magnet
          ? "rgba(34,197,94,.62)"
          : pickup.pace
            ? "rgba(125,211,252,.70)"
            : "rgba(255,255,255,.74)";
      ctx.fill();
      drawStreetcar(pickup, -1, true);
    }
  }

  function drawMinimap(poses) {
    mctx.clearRect(0, 0, mW, mH);
    mctx.fillStyle = "rgba(248,246,239,.96)";
    mctx.fillRect(0, 0, mW, mH);

    const pad = 10;
    const spanX = worldBounds.maxX - worldBounds.minX;
    const spanY = worldBounds.maxY - worldBounds.minY;
    const scale = Math.min((mW - pad * 2) / spanX, (mH - pad * 2) / spanY);
    const ox = pad + ((mW - pad * 2) - spanX * scale) / 2;
    const oy = pad + ((mH - pad * 2) - spanY * scale) / 2;
    const mp = (x, y) => ({ x: ox + (x - worldBounds.minX) * scale, y: oy + (y - worldBounds.minY) * scale });

    mctx.save();
    mctx.setTransform(dpr * scale, 0, 0, dpr * scale,
      dpr * (ox - worldBounds.minX * scale),
      dpr * (oy - worldBounds.minY * scale));
    mctx.lineJoin = "round";
    mctx.lineCap = "round";
    mctx.strokeStyle = "#4d5054";
    mctx.globalAlpha = .72;
    mctx.lineWidth = 1.3 / scale;
    mctx.stroke(networkPaths.main);
    mctx.stroke(networkPaths.diversion);
    mctx.strokeStyle = "#9a9790";
    mctx.globalAlpha = .55;
    mctx.lineWidth = 1 / scale;
    mctx.stroke(networkPaths.yard);
    mctx.restore();
    mctx.globalAlpha = 1;

    for (const pickup of pickups) {
      const p = mp(pickup.x, pickup.y);
      mctx.fillStyle = "#d71920";
      mctx.beginPath();
      mctx.arc(p.x, p.y, 2.1, 0, Math.PI * 2);
      mctx.fill();
    }

    if (mW >= 180) {
      const miniLabels = W < 600
        ? [["Long Br", "longBranch"], ["Union", "union"], ["Main", "mainStation"], ["Gunns", "gunns"]]
        : [
            ["Long Branch", "longBranch"], ["Dundas W", "dundasWest"],
            ["Union", "union"], ["Broadview", "broadviewStation"],
            ["Main", "mainStation"], ["Neville", "neville"], ["Gunns", "gunns"],
          ];
      mctx.font = "700 7px system-ui, sans-serif";
      mctx.fillStyle = "rgba(40,44,48,.72)";
      mctx.textAlign = "center";
      for (const [label, nodeId] of miniLabels) {
        const n = nodes.get(nodeId);
        const p = mp(n.x, n.y);
        mctx.fillText(label, p.x, p.y - 4);
      }
    }

    if (poses.length) {
      const tail = mp(poses.at(-1).x, poses.at(-1).y);
      const hp = mp(poses[0].x, poses[0].y);
      mctx.strokeStyle = "rgba(215,25,32,.50)";
      mctx.lineWidth = 2.5;
      mctx.beginPath();
      mctx.moveTo(tail.x, tail.y);
      mctx.lineTo(hp.x, hp.y);
      mctx.stroke();

      mctx.fillStyle = "#fff";
      mctx.strokeStyle = "#d71920";
      mctx.lineWidth = 2.5;
      mctx.beginPath();
      mctx.arc(hp.x, hp.y, 5.2, 0, Math.PI * 2);
      mctx.fill();
      mctx.stroke();
      mctx.fillStyle = "#111";
      mctx.font = "900 7px system-ui, sans-serif";
      mctx.textAlign = "left";
      mctx.fillText("YOU", hp.x + 7, hp.y + 2);
    }
  }

  function drawSwitchPreview() {
    const state = getUpcomingSwitch();
    if (!state) return;
    const node = nodes.get(state.nodeId);
    const p = worldToScreen(node.x, node.y);

    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#f4a300";
    ctx.fillStyle = "rgba(244,163,0,.18)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const selected = state.branches.find((b) => b.edge.id === manualSwitchEdgeId);
    if (selected) {
      const q = worldToScreen(node.x + selected.out.x * 85, node.y + selected.out.y * 85);
      ctx.strokeStyle = "#087f5b";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBlockedEdge() {
    if (!blockedEdgeId) return;
    const edge = edgeById(blockedEdgeId);
    if (!edge) return;

    ctx.save();
    ctx.strokeStyle = chaos?.type === "doNotEnter" ? "#d71920" : "#d97706";
    ctx.lineWidth = chaos?.type === "doNotEnter" ? 7 : 5;
    ctx.setLineDash(chaos?.type === "doNotEnter" ? [10, 7] : [6, 6]);
    ctx.beginPath();
    for (let i = 0; i < edge.pts.length; i++) {
      const p = worldToScreen(edge.pts[i].x, edge.pts[i].y);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    const mid = pointAt(edge, edge.len * .5);
    const p = worldToScreen(mid.x, mid.y);
    ctx.fillStyle = chaos?.type === "doNotEnter" ? "#d71920" : "#d97706";
    ctx.font = "900 9px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(chaos?.type === "doNotEnter" ? "DO NOT ENTER" : "BLOCKED", p.x, p.y - 12);

    ctx.beginPath();
    ctx.moveTo(p.x - 10, p.y - 10);
    ctx.lineTo(p.x + 10, p.y + 10);
    ctx.moveTo(p.x + 10, p.y - 10);
    ctx.lineTo(p.x - 10, p.y + 10);
    ctx.stroke();
    ctx.restore();
  }

  function drawChallengeZone() {
    if (!challengeZone) return;
    const p = worldToScreen(challengeZone.x, challengeZone.y);
    const pulse = 1 + Math.sin(performance.now() / 120) * .10;
    const radius = (challengeZone.multiplier === 3 ? 25 : 21) * pulse;

    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = challengeZone.multiplier === 3
      ? "rgba(168,85,247,.25)"
      : "rgba(255,193,7,.25)";
    ctx.fill();
    ctx.strokeStyle = challengeZone.multiplier === 3 ? "#a855f7" : "#f59f00";
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = "#111";
    ctx.font = "900 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("×" + challengeZone.multiplier, p.x, p.y);
    ctx.restore();
  }

  function drawChallengeArrow() {
    if (!challengeZone || !head) return;

    const target = worldToScreen(challengeZone.x, challengeZone.y);
    const margin = 54;
    if (target.x >= margin && target.x <= W - margin &&
        target.y >= margin && target.y <= H - margin) {
      return;
    }

    const cx = W / 2;
    const cy = H / 2;
    const dx = target.x - cx;
    const dy = target.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;

    const usableHalfW = W / 2 - margin;
    const usableHalfH = H / 2 - margin;
    const tx = Math.abs(ux) > 0.001 ? usableHalfW / Math.abs(ux) : Infinity;
    const ty = Math.abs(uy) > 0.001 ? usableHalfH / Math.abs(uy) : Infinity;
    const travel = Math.min(tx, ty);
    const x = cx + ux * travel;
    const y = cy + uy * travel;

    const hp = pointAt(head.edge, head.s);
    const metres = Math.hypot(challengeZone.x - hp.x, challengeZone.y - hp.y);
    const distanceLabel = metres >= 1000
      ? (metres / 1000).toFixed(1) + " km"
      : Math.round(metres) + " m";

    const rare = challengeZone.multiplier === 3;
    const accent = rare ? "#a855f7" : "#f59f00";

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(uy, ux));

    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(-8, -11);
    ctx.lineTo(-8, 11);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.font = "900 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const label = "×" + challengeZone.multiplier + "  " + distanceLabel;
    const w = ctx.measureText(label).width + 14;
    roundedRectPath(ctx, x - w / 2, y + 17, w, 22, 8);
    ctx.fillStyle = "rgba(16,17,20,.90)";
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.fillText(label, x, y + 28);
    ctx.restore();
  }

  function drawGameEffects(poses, now) {
    if (!poses.length) return;
    const lead = worldToScreen(poses[0].x, poses[0].y);

    // Persistent armed multiplier badge: keep the power-up visually attached to
    // the player's streetcar instead of hiding it in HUD text.
    if (pickupMultiplier > 1) {
      const rare = pickupMultiplier === 3;
      const label = "NEXT PICKUP ×" + pickupMultiplier;
      ctx.save();
      ctx.font = "900 9px system-ui, sans-serif";
      const w = ctx.measureText(label).width + 14;
      roundedRectPath(ctx, lead.x - w / 2, lead.y - 43, w, 20, 8);
      ctx.fillStyle = rare ? "rgba(126,34,206,.92)" : "rgba(180,83,9,.94)";
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, lead.x, lead.y - 33);
      ctx.restore();
    }

    gameEffects = gameEffects.filter((effect) => now - effect.createdAt < effect.duration);
    let stack = pickupMultiplier > 1 ? 56 : 34;

    for (const effect of gameEffects) {
      const age = now - effect.createdAt;
      const progress = Math.max(0, Math.min(1, age / effect.duration));
      const rise = 18 * progress;
      const alpha = 1 - progress;
      const scale = 1 + Math.sin(progress * Math.PI) * .16;
      const color = effect.kind === "rare"
        ? "#a855f7"
        : effect.kind === "bonus"
          ? "#f59f00"
          : "#087f5b";

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(lead.x, lead.y - stack - rise);
      ctx.scale(scale, scale);
      ctx.font = "900 13px system-ui, sans-serif";
      const w = ctx.measureText(effect.text).width + 16;
      roundedRectPath(ctx, -w / 2, -12, w, 24, 9);
      ctx.fillStyle = "rgba(16,17,20,.90)";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(effect.text, 0, 0);
      ctx.restore();

      stack += 29;
    }
  }

  function drawYouMarker(poses) {
    if (!poses.length) return;
    const lead = poses[0];
    const p = worldToScreen(lead.x, lead.y);
    const pulse = 13 + Math.sin(performance.now() / 170) * 2;

    ctx.save();
    ctx.strokeStyle = "rgba(215,25,32,.78)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, pulse, 0, Math.PI * 2);
    ctx.stroke();

    if (W >= 600) {
      ctx.fillStyle = "rgba(16,17,20,.88)";
      ctx.font = "900 8px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("YOU", p.x, p.y - pulse - 3);
    }
    ctx.restore();
  }

  // Canvas rendering is kept in one frame pipeline: clear, world, train, HUD.
  function drawFrame(poses) {
    const now = performance.now();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#f1eee5";
    ctx.fillRect(0, 0, W, H);
    drawWater();

    drawNetwork();
    drawGeographyLabels();
    for (const node of nodes.values()) drawNode(node);
    drawBlockedEdge();
    drawChallengeZone();
    drawChallengeArrow();
    drawSwitchPreview();
    drawStreetcarStops();
    drawPickups();

    // Draw tail first so the lead car remains visually dominant.
    for (let i = poses.length - 1; i >= 0; i--) {
      if (poses[i].placed === false) continue;
      drawStreetcar(poses[i], i, false);
    }
    drawYouMarker(poses);
    drawGameEffects(poses, now);

    drawMinimap(poses);
  }

  // -------------------------------------------------------------------------
  // Main loop
  // -------------------------------------------------------------------------

  function speedCapKph() {
    if (operatorMode === "realistic") return REALISTIC_GOVERNOR_KPH;
    return ARCADE_GOVERNOR_KPH;
  }

  function slowOrderCapKph() {
    if (operatorMode === "realistic") return 25;
    return 250;
  }

  function updateSpeed(dt) {
    // Pedals change the target speed; disruptions can temporarily lower it.
    const accelRate = operatorMode === "realistic" ? 34 : 360;
    const brakeRate = operatorMode === "realistic" ? 58 : 420;
    if (acceleratorHeld) speedKph += accelRate * dt;
    if (brakeHeld) speedKph -= brakeRate * dt;
    speedKph = Math.max(0, Math.min(speedCapKph(), speedKph));

    // Arcade keeps the "slow order" idea without reducing a game to walking pace.
    const effective = chaos?.type === "slow" ? Math.min(speedKph, slowOrderCapKph()) : speedKph;
    speedStat.textContent = String(Math.round(effective));
    speedStat.style.color = effective >= 1000
      ? "#74c0fc"
      : effective >= 500
        ? "#ffd43b"
        : effective > FLEXITY_RATED_MAX_KPH
          ? "#ffb3b7"
          : "";
    return effective;
  }

  function frame(t) {
    // One animation frame: update the simulation, then redraw the world.
    if (!lastT) lastT = t;
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;

    if (running && !dead) {
      maintainOpeningPickup(t);
      maintainPickupDensity(t);
      maintainFoodMagnet(t);
      updateChallengeZone(t);
      updateChaos(t);
      const effectiveKph = updateSpeed(dt);
      let frameDistance = (effectiveKph / 3.6) * dt;

      // At extreme speed, sampling only once per animation frame turns bends
      // into long diagonal chords. Substep along the rail so the stored tail
      // follows the actual track geometry instead of cutting corners.
      const maxStep = 3.5;
      while (frameDistance > 0) {
        const step = Math.min(maxStep, frameDistance);
        advanceHead(step);
        addTrailSample();
        checkPickups();
        frameDistance -= step;
      }
      updateSwitchPanel();
      if (t - lastLocationHudAt > 220) {
        updateLocationHud();
        lastLocationHudAt = t;
      }
    }

    const poses = getTrainPoses();
    if (running && !dead && checkSelfCollision(poses)) gameOver();
    updateCamera(poses);
    drawFrame(poses);
    requestAnimationFrame(frame);
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  function touchDistance(touches) {
    if (!touches || touches.length < 2) return 0;
    const a = touches[0];
    const b = touches[1];
    return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
  }

  function beginMapPinch(touches) {
    const distance = touchDistance(touches);
    if (distance <= 0) return;
    canvasPinching = true;
    pinchStartDistance = distance;
    pinchStartZoomFactor = cameraZoomFactor;
  }

  function updateMapPinch(touches) {
    // Scale the camera only; the fixed HTML controls do not zoom.
    const distance = touchDistance(touches);
    if (pinchStartDistance <= 0 || distance <= 0) return;
    const ratio = distance / pinchStartDistance;
    cameraZoomFactor = Math.max(0.22, Math.min(3.0, pinchStartZoomFactor * ratio));
  }

  // Capture at the document level, before Safari or any child control can claim
  // a two-finger gesture. A pinch may start over the HUD, switch panel, BRAKE,
  // ACCEL, or canvas; during gameplay it always means "zoom the map".
  document.addEventListener("touchstart", (event) => {
    if (!running || dead || event.touches.length < 2) return;
    event.preventDefault();
    event.stopPropagation();
    beginMapPinch(event.touches);
  }, { passive: false, capture: true });

  document.addEventListener("touchmove", (event) => {
    if (!running || dead || event.touches.length < 2) return;
    event.preventDefault();
    event.stopPropagation();
    if (!canvasPinching) beginMapPinch(event.touches);
    else updateMapPinch(event.touches);
  }, { passive: false, capture: true });

  document.addEventListener("touchend", (event) => {
    if (event.touches.length < 2) canvasPinching = false;
  }, { passive: false, capture: true });

  document.addEventListener("touchcancel", () => {
    canvasPinching = false;
  }, { passive: false, capture: true });

  // Older/current iOS Safari also emits proprietary gesture events for pinch
  // magnification. Capture and cancel those before the page viewport sees them.
  for (const gestureEvent of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(gestureEvent, (event) => {
      if (!running || dead) return;
      event.preventDefault();
      event.stopPropagation();
    }, { passive: false, capture: true });
  }

  let lastGameplayTouchEnd = 0;
  document.addEventListener("touchend", (event) => {
    if (!running || dead || event.changedTouches.length !== 1) return;
    const now = performance.now();
    if (now - lastGameplayTouchEnd < 300) event.preventDefault();
    lastGameplayTouchEnd = now;
  }, { passive: false, capture: true });

  addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (key === "arrowup") {
      event.preventDefault();
      acceleratorHeld = true;
      accelerator.classList.add("active");
    } else if (key === "arrowdown") {
      event.preventDefault();
      brakeHeld = true;
      brake.classList.add("active");
    } else if (key === "arrowleft") {
      event.preventDefault();
      selectSwitchByIntent("left");
    } else if (key === "arrowright") {
      event.preventDefault();
      selectSwitchByIntent("right");
    } else if (key === " ") {
      event.preventDefault();
      selectSwitchByIntent("straight");
    } else if (key === "q") {
      event.preventDefault();
      selectSwitchByIntent("left");
    } else if (key === "e") {
      event.preventDefault();
      selectSwitchByIntent("right");
    } else if (key === "r") {
      event.preventDefault();
      selectSwitchByIntent("straight");
    } else if (key === "+" || key === "=") {
      event.preventDefault();
      acceleratorHeld = true;
      accelerator.classList.add("active");
    } else if (key === "-" || key === "_") {
      event.preventDefault();
      brakeHeld = true;
      brake.classList.add("active");
    }
  }, { passive: false });

  addEventListener("keyup", (event) => {
    const key = event.key.toLowerCase();
    if (key === "arrowup") {
      acceleratorHeld = false;
      accelerator.classList.remove("active");
    } else if (key === "arrowdown") {
      brakeHeld = false;
      brake.classList.remove("active");
    } else if (key === "+" || key === "=") {
      acceleratorHeld = false;
      accelerator.classList.remove("active");
    } else if (key === "-" || key === "_") {
      brakeHeld = false;
      brake.classList.remove("active");
    }
  });

  switchChoices.addEventListener("pointerdown", (event) => {
    const button = event.target.closest(".switch-choice");
    if (!button || button.disabled) return;
    event.preventDefault();
    selectSwitchBranch(button.dataset.edge);
  });


  function updateStartButton() {
    const label = gameModeSelect.value === "mission" ? "Route Mission" : "Free Play";
    const feel = operatorModeSelect.value === "realistic"
      ? " • Realistic"
      : " • Arcade";
    startBtn.textContent = "Begin new game — " + label + feel;
  }
  gameModeSelect.addEventListener("change", updateStartButton);
  operatorModeSelect.addEventListener("change", updateStartButton);

  // Sound is ON by default. Only an explicit first-party cookie opt-out
  // should start a future visit muted.
  muteSounds.checked = readCookie("ttcSnakeMuted") === "1";
  muteSounds.addEventListener("change", () => {
    document.cookie = "ttcSnakeMuted=" + (muteSounds.checked ? "1" : "0") +
      "; Max-Age=31536000; Path=/; SameSite=Lax";
  });

  resumeCheckpoint = readResumeCheckpoint();
  updateResumeButton();
  updateStartButton();

  function setPedal(button, kind, pressed) {
    if (kind === "accelerate") acceleratorHeld = pressed;
    else brakeHeld = pressed;
    button.classList.toggle("active", pressed);
  }

  accelerator.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    accelerator.setPointerCapture?.(event.pointerId);
    setPedal(accelerator, "accelerate", true);
  });
  brake.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    brake.setPointerCapture?.(event.pointerId);
    setPedal(brake, "brake", true);
  });
  for (const [button, kind] of [[accelerator, "accelerate"], [brake, "brake"]]) {
    for (const evt of ["pointerup", "pointercancel", "lostpointercapture"]) {
      button.addEventListener(evt, () => setPedal(button, kind, false));
    }
  }

  function restoreStartCard() {
    overlay.classList.remove("crash-state");
    overlayTitle.textContent = "Streetcar Snake";
    overlayLead.innerHTML = "Eat streetcars. Get absurdly long.<br>Don't eat yourself." +
      "<small>Basically Snake, except the snake is 30-tonne transit equipment.</small>";
    overlayHero.style.display = "flex";
    overlayRules.style.display = "flex";
    overlayStatus.hidden = true;
    overlayExtra.hidden = true;
    overlayJoke.textContent = "⚠ Transit Control would like a word.";
  }

  function beginRunning() {
    overlay.classList.add("hidden");
    running = true;
    lastT = performance.now();
    runStartedAt = lastT;
    openingAssistPlacedAt = lastT;
    ringBell();
  }

  resumeBtn.addEventListener("click", () => {
    restoreStartCard();
    const checkpoint = readResumeCheckpoint();
    if (!checkpoint) {
      clearResumeCheckpoint();
      return;
    }
    resumeCheckpoint = checkpoint;
    restoreGame(checkpoint);
    beginRunning();
  });

  startBtn.addEventListener("click", () => {
    restoreStartCard();
    clearResumeCheckpoint();
    resetGame();
    beginRunning();
  });

  aboutBtn.addEventListener("click", () => {
    aboutPanel.classList.toggle("open");
  });

  // Start with a visible world before the user presses Depart.
  resetGame();
  updateHud();
  requestAnimationFrame(frame);
})();
