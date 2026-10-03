import { boundsOf, searchFeatures, type Bounds, type Edge, type Feature, type Point, type Route, type ViewerData } from "./model";
import { fitCamera, moveCamera, zoomCamera } from "./camera";
import { nearestOnSegment } from "../../workers/map-generator/src/geometry";
import { loadVehicleSnapshot, projectSnapshot, streetcarBody, type PlottedVehicle } from "./live-status";
import { vehicleIsStale, type VehicleSnapshot } from "../../workers/shared/live-vehicles";

const data: ViewerData = JSON.parse(document.querySelector("#map-data")!.textContent!);
const svg = document.querySelector<SVGSVGElement>("#map")!;
const viewport = document.querySelector<HTMLElement>("#viewport")!;
const details = document.querySelector<HTMLElement>("#details")!;
const tooltip = document.querySelector<HTMLElement>("#tooltip")!;
const search = document.querySelector<HTMLInputElement>("#search")!;
const results = document.querySelector<HTMLElement>("#search-results")!;
const routes = new Map(data.routes.map(r => [r.id,r]));
const features = new Map(data.features.map(f => [f.id,f]));
const routeButtons = new Map<string,HTMLButtonElement>();
const markerElements = new Map<string,SVGGElement>();
const trackElements = new Map<string,SVGPolylineElement>();
const svgNS = "http://www.w3.org/2000/svg";
const liveToggle = document.querySelector<HTMLInputElement>("#show-live")!;
const liveSummary = document.querySelector<HTMLElement>("#live-summary")!;
const liveTimestamp = document.querySelector<HTMLElement>("#live-timestamp")!;
const carElements = new Map<string, SVGGElement>();
let liveSnapshot: VehicleSnapshot | undefined, cars: PlottedVehicle[] = [];
let selected: Feature | undefined, selectedRoute: string | undefined, hovered: Feature | undefined;
let moreLabels = false, scheduledFrame = false;
const rect = () => viewport.getBoundingClientRect();
let initial = fitCamera(data.bounds,Math.max(1,rect().width)/Math.max(1,rect().height));
let camera = { ...initial };
const center = (): Point => [camera.x+camera.width/2,camera.y+camera.height/2];
const zoomLevel = () => initial.width/camera.width;
const screenPoint = (p: Point): Point => [(p[0]-camera.x)*rect().width/camera.width,(p[1]-camera.y)*rect().height/camera.height];
const worldPoint = (x: number,y: number): Point => [camera.x+(x-rect().left)*camera.width/rect().width,camera.y+(y-rect().top)*camera.height/rect().height];

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function shape<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string,string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(svgNS,tag);
  for (const [key,value] of Object.entries(attributes)) node.setAttribute(key,String(value));
  return node;
}
function sortedRoutes(ids: string[]) {
  return ids.map(id => routes.get(id)).filter((r): r is Route => Boolean(r))
    .sort((a,b) => Number(a.overnight)-Number(b.overnight) || a.number.localeCompare(b.number));
}
function paintedRoute(edge: Edge): Route | undefined {
  const first = sortedRoutes(edge.routeIds)[0];
  return first?.overnight ? data.routes.find(r => r.number === String(Number(first.number)+200)) ?? first : first;
}
function routeText(ids: string[]) {
  return sortedRoutes(ids).map(r => `${r.number} ${r.name}${r.overnight ? " (overnight)" : ""}`).join(" · ");
}
function routeButton(route: Route, action: () => void): HTMLButtonElement {
  const button = element("button","route-button");
  button.style.setProperty("--route-color",route.color);
  button.append(element("span","route-number",route.number),element("span","route-name",route.name));
  if (route.overnight || !route.scheduled) button.append(element("small","route-state",route.overnight ? "OVERNIGHT" : "RAIL ONLY"));
  button.onclick = action;
  return button;
}

// Fixed geometry stays in SVG. Symbols and labels keep a readable screen size
// while the camera reveals progressively more stops.
const water = shape("g",{"aria-hidden":"true"});
const shoreline = data.shoreline;
const waterPoints = [...shoreline,[5000,shoreline.at(-1)![1]],[5000,5000],[-5000,5000],[-5000,shoreline[0][1]]] as Point[];
water.append(shape("polygon",{ points:waterPoints.map(p => p.join(",")).join(" "),fill:"#d8e8e9" }),
  shape("polyline",{ points:shoreline.map(p => p.join(",")).join(" "),fill:"none",stroke:"#bdd7da","stroke-width":1.2,"vector-effect":"non-scaling-stroke" }));
const lake = shape("text",{x:950,y:875,fill:"#7b9fa9","font-size":23,"letter-spacing":5});
lake.textContent = "LAKE ONTARIO"; water.append(lake); svg.append(water);
const tracksLayer = shape("g",{"aria-hidden":"true"});
for (const edge of data.edges) {
  const line = shape("polyline",{class:"track",points:edge.points.map(p => p.join(",")).join(" "),fill:"none",
    stroke:paintedRoute(edge)?.color ?? "#7b8794","stroke-width":edge.routeIds.length ? 4.5 : 3,
    "stroke-linecap":"round","stroke-linejoin":"round",...(edge.routeIds.length ? {} : {"stroke-dasharray":"6 5"})});
  tracksLayer.append(line); trackElements.set(edge.id,line);
}
svg.append(tracksLayer);
const markersLayer = shape("g");
for (const feature of data.features) {
  const marker = shape("g",{ "data-feature":feature.id,role:"button",tabindex:0,
    "aria-label":`${feature.name}. ${routeText(feature.routeIds) || "Physical terminal without scheduled streetcar service"}. Press Enter for details.` });
  marker.append(shape("circle",{r:10,fill:"transparent"}),
    shape("circle",{class:"selection-halo",r:12,fill:"#278f9120",stroke:"#278f91","stroke-width":1.5,display:"none"}),
    shape("circle",{class:"marker",r:feature.kind === "terminal" ? 4.6 : 2.2,fill:"#fffdf7",stroke:"#43535e","stroke-width":feature.kind === "terminal" ? 1.7 : 1}));
  marker.addEventListener("keydown",event => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); selectFeature(feature); }
  });
  marker.addEventListener("focus",() => {
    const [x,y] = screenPoint(feature.point);
    if (x<15 || y<15 || x>rect().width-15 || y>rect().height-15) focusPoint(feature.point,zoomLevel());
    hovered = feature; drawSoon();
  });
  marker.addEventListener("blur",() => { hovered = undefined; drawSoon(); });
  markersLayer.append(marker); markerElements.set(feature.id,marker);
}
svg.append(markersLayer);
const vehiclesLayer = shape("g", { id: "live-vehicles", display: "none" }); svg.append(vehiclesLayer);
const labelsLayer = shape("g",{class:"map-label","aria-hidden":"true"}); svg.append(labelsLayer);
document.querySelector("#north-arrow")!.setAttribute("transform",`rotate(${data.northAngle} 18 18)`);

interface Box { x: number; y: number; width: number; height: number }
function renderLabels(scale: number) {
  labelsLayer.replaceChildren();
  const occupied: Box[] = [ {x:0,y:rect().height-65,width:340,height:65}, {x:rect().width-60,y:0,width:60,height:75} ];
  const fits = (box: Box) => box.x>8 && box.y>10 && box.x+box.width<rect().width-8 && box.y+box.height<rect().height-8 &&
    !occupied.some(p => box.x<p.x+p.width+4 && box.x+box.width+4>p.x && box.y<p.y+p.height+4 && box.y+box.height+4>p.y);
  const visible = (p: Point) => { const [x,y] = screenPoint(p); return x>=0 && y>=0 && x<=rect().width && y<=rect().height; };
  const labelFeatures = data.features.filter(f => visible(f.point) &&
    (f.kind === "terminal" || f.id === selected?.id || f.id === hovered?.id || zoomLevel()>=(moreLabels ? 1 : 2.6)))
    .sort((a,b) => Number(b.id === selected?.id)-Number(a.id === selected?.id) || Number(b.id === hovered?.id)-Number(a.id === hovered?.id) ||
      Number(b.kind === "terminal")-Number(a.kind === "terminal") || Number(b.routeIds.includes(selectedRoute ?? ""))-Number(a.routeIds.includes(selectedRoute ?? "")));
  for (const f of labelFeatures) {
    const [x,y] = screenPoint(f.point), terminal = f.kind === "terminal";
    const name = f.name.replace(/\s+/g," ");
    const text = name.length>43 && zoomLevel()<5 ? `${name.slice(0,40)}…` : name;
    const sub = zoomLevel()>=3 && !terminal ? sortedRoutes(f.routeIds).map(r => r.number).join(" · ") : "";
    const width = text.length*(terminal ? 6.7 : 5.8)+12, height = sub ? 35 : 23;
    const offsets = [[10,-height-3],[10,5],[-width-10,-height-3],[-width-10,5],[-width/2,-height-11],[-width/2,12]];
    const box = offsets.map(([dx,dy]) => ({x:x+dx,y:y+dy,width,height})).find(fits);
    if (!box) continue;
    occupied.push(box);
    const p = worldPoint(rect().left+box.x,rect().top+box.y);
    const group = shape("g",{transform:`translate(${p[0]} ${p[1]}) scale(${1/scale})`});
    group.append(shape("rect",{width,height,rx:4,fill:"#fffdf7",opacity:.95}));
    const title = shape("text",{x:6,y:15,fill:f.id === selected?.id ? "#167c7e" : "#25343c","font-size":terminal ? 12 : 11,"font-weight":terminal ? 650 : 500});
    title.textContent = text; group.append(title);
    if (sub) { const subtitle = shape("text",{x:6,y:28,fill:"#697980","font-size":10}); subtitle.textContent = sub; group.append(subtitle); }
    labelsLayer.append(group);
  }
  for (const route of data.routes.filter(r => !r.overnight)) {
    const candidates = data.edges.filter(e => paintedRoute(e)?.id === route.id && visible(e.points[Math.floor(e.points.length/2)]))
      .sort((a,b) => b.lengthMetres-a.lengthMetres);
    const edge = candidates[0]; if (!edge) continue;
    const point: Point = [(edge.points[0][0]+edge.points.at(-1)![0])/2,(edge.points[0][1]+edge.points.at(-1)![1])/2];
    const [x,y] = screenPoint(point), box = {x:x-17,y:y-10,width:34,height:20};
    if (!fits(box)) continue;
    occupied.push(box);
    const badge = shape("g",{transform:`translate(${point.join(" ")}) scale(${1/scale})`,opacity:selectedRoute && selectedRoute !== route.id ? .3 : 1});
    badge.append(shape("rect",{x:-17,y:-10,width:34,height:20,rx:5,fill:"#fffdf7",stroke:route.color,"stroke-width":1.5}));
    const text = shape("text",{"text-anchor":"middle","dominant-baseline":"central","font-size":11,"font-weight":700,fill:route.color});
    text.textContent = route.number; badge.append(text); labelsLayer.append(badge);
  }
  for (const label of data.labels) {
    if (!visible(label.point)) continue;
    const [x,y] = screenPoint(label.point), width = label.text.length*5.6+10, height = 20;
    const vertical = Math.abs(label.angle)===90;
    const box = {x:x-(vertical ? height : width)/2,y:y-(vertical ? width : height)/2,width:vertical ? height : width,height:vertical ? width : height};
    if (!fits(box)) continue;
    occupied.push(box);
    const group = shape("g",{transform:`translate(${label.point.join(" ")}) scale(${1/scale}) rotate(${label.angle})`});
    const text = shape("text",{"text-anchor":"middle","dominant-baseline":"central","font-size":11,fill:"#697980"});
    text.textContent = label.text; group.append(text); labelsLayer.append(group);
  }
}
function drawSoon() {
  if (scheduledFrame) return;
  scheduledFrame = true; requestAnimationFrame(() => { scheduledFrame = false; draw(); });
}
function draw() {
  svg.setAttribute("viewBox",`${camera.x} ${camera.y} ${camera.width} ${camera.height}`);
  const scale = rect().width/camera.width;
  document.querySelector("#zoom-level")!.textContent = `${Math.round(zoomLevel()*100)}%`;
  document.querySelector<HTMLButtonElement>("#zoom-in")!.disabled = zoomLevel()>=11.99;
  document.querySelector<HTMLButtonElement>("#zoom-out")!.disabled = zoomLevel()<=1.001;
  for (const edge of data.edges) trackElements.get(edge.id)!.style.opacity = selectedRoute && !edge.routeIds.includes(selectedRoute) ? ".18" : "1";
  for (const feature of data.features) {
    const marker = markerElements.get(feature.id)!;
    marker.setAttribute("transform",`translate(${feature.point.join(" ")}) scale(${1/scale})`);
    marker.querySelector(".marker")!.setAttribute("r",String(feature.kind === "terminal" ? 4.6 : zoomLevel()>2 ? 3 : 2));
    marker.querySelector(".selection-halo")!.setAttribute("display",feature.id === selected?.id || feature.id === hovered?.id ? "inline" : "none");
    marker.style.opacity = selectedRoute && !feature.routeIds.includes(selectedRoute) && feature.id !== selected?.id ? ".3" : "1";
    marker.setAttribute("aria-pressed",String(feature.id === selected?.id));
  }
  renderLabels(scale);
  renderVehicles(scale);
}

function vehicleDescription(car: PlottedVehicle): string {
  const route = routes.get(car.vehicle.routeId ?? "");
  return `${route ? `${route.number} ${route.name}` : car.vehicle.routeId ? `Route ${car.vehicle.routeId}` : "No assigned trip"} · ${car.match ? "On mapped track" : "Off mapped track; GPS position"}${car.stale ? " · Stale position" : ""}`;
}

function renderVehicles(scale: number) {
  vehiclesLayer.setAttribute("display", liveToggle.checked ? "inline" : "none");
  if (!liveToggle.checked) return;
  for (const car of cars) {
    const group = carElements.get(car.vehicle.id)!;
    group.setAttribute("opacity", car.stale ? ".45" : selectedRoute && car.vehicle.routeId !== selectedRoute ? ".25" : "1");
    const color = routes.get(car.vehicle.routeId ?? "")?.color ?? "#b4393f";
    const body = streetcarBody(car, data.edges, scale);
    Array.from(group.children).forEach((child, i) => {
      const section = body[4 - i];
      child.setAttribute("transform", `translate(${section.point.join(" ")}) rotate(${section.angle}) scale(${1 / scale})`);
      child.querySelector("rect")!.setAttribute("fill", color);
    });
    group.classList.toggle("off-track", !car.match);
  }
}

function selectVehicle(car: PlottedVehicle) {
  selected = undefined; hovered = undefined; tooltip.hidden = true;
  details.replaceChildren();
  details.append(element("p", "eyebrow", "Flexity streetcar"));
  const heading = element("div", "details-heading"), close = element("button", "close-details", "×");
  close.setAttribute("aria-label", "Close streetcar details"); close.onclick = closeDetails;
  heading.append(element("h1", "", `Car ${car.vehicle.label}`), close); details.append(heading);
  details.append(element("p", "", vehicleDescription(car)));
  const facts = element("dl", "stop-facts");
  facts.append(element("dt", "", "Position reported"), element("dd", "", car.vehicle.observedAt ? new Date(car.vehicle.observedAt).toLocaleString("en-CA", { timeZone: "America/Toronto" }) : "Time not supplied"));
  if (car.vehicle.speedMetresPerSecond !== undefined) facts.append(element("dt", "", "Reported speed"), element("dd", "", `${Math.round(car.vehicle.speedMetresPerSecond * 3.6)} km/h`));
  if (car.match) facts.append(element("dt", "", "GPS distance from mapped track"), element("dd", "", `${Math.round(car.match.distanceFromTrackMetres)} m`));
  else details.append(element("p", "tip", "This car is beyond the mapped track or in a yard. Its GPS location uses the same geographic transform as the map."));
  details.append(facts);
  const focus = element("button", "focus-button", "Zoom to this streetcar"); focus.onclick = () => focusPoint(car.point, 6); details.append(focus);
  drawSoon();
}

function hitVehicle(x: number, y: number): PlottedVehicle | undefined {
  if (!liveToggle.checked) return;
  const scale = rect().width / camera.width, target: Point = [x - rect().left, y - rect().top];
  return cars.filter(car => { const point = screenPoint(car.point); return Math.hypot(point[0] - target[0], point[1] - target[1]) < 38; })
    .map(car => ({ car, distance: Math.min(...streetcarBody(car, data.edges, scale).map(section => {
      const point = screenPoint(section.point); return Math.hypot(point[0] - target[0], point[1] - target[1]);
    })) })).filter(hit => hit.distance < 8).sort((a, b) => a.distance - b.distance)[0]?.car;
}

function updateSnapshotAge() {
  if (!liveSnapshot) return;
  cars.forEach(car => { car.stale = vehicleIsStale(car.vehicle, liveSnapshot!); });
  cars.forEach(car => carElements.get(car.vehicle.id)?.setAttribute("aria-label", `Flexity car ${car.vehicle.label}. ${vehicleDescription(car)}. Press Enter for details.`));
  const offTrack = cars.filter(car => !car.match).length, stale = cars.filter(car => car.stale).length;
  liveSummary.textContent = cars.length ? `${cars.length} cars reported${offTrack ? ` · ${offTrack} off mapped track` : ""}${stale ? ` · ${stale} stale` : ""}.` : "No Flexity positions reported.";
  if (liveSnapshot.invalidPositions) liveSummary.textContent += ` ${liveSnapshot.invalidPositions} invalid GPS fixes omitted.`;
  drawSoon();
}

async function bootLiveStatus() {
  // Static file previews use the public API. HTTP previews and production use
  // their own Worker, keeping upstream protobuf acquisition out of the browser.
  const endpoint = location.protocol === "file:" ? "https://api.ttcstatus.ca/v1/vehicles/streetcar" : "/v1/vehicles/streetcar";
  try {
    liveSnapshot = await loadVehicleSnapshot(endpoint);
    cars = projectSnapshot(data, liveSnapshot);
    for (const car of cars) {
      const group = shape("g", { class: "live-car", "data-vehicle": car.vehicle.id, role: "button", tabindex: 0,
        "aria-label": `Flexity car ${car.vehicle.label}. ${vehicleDescription(car)}. Press Enter for details.` });
      // Five articulated sections, drawn tail-first so the cab sits on top.
      for (let i = 0; i < 5; i++) {
        const section = shape("g");
        section.append(shape("rect", { x: -3, y: -3.5, width: 6, height: 7, rx: i === 4 ? 2.2 : 1.2, stroke: "#fffdf7", "stroke-width": 1 }));
        section.append(shape("path", { d: i === 4 ? "M1 -2 L1 2" : "M-1.5 -1.5 H1.5 M-1.5 1.5 H1.5", stroke: "#183340", "stroke-width": 1.2, "stroke-linecap": "round" }));
        group.append(section);
      }
      group.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); selectVehicle(car); }
      });
      group.addEventListener("focus", () => { const [x, y] = screenPoint(car.point); if (x < 15 || y < 15 || x > rect().width - 15 || y > rect().height - 15) focusPoint(car.point, zoomLevel()); });
      vehiclesLayer.append(group); carElements.set(car.vehicle.id, group);
    }
    const timestamp = liveSnapshot.feedTimestamp ?? liveSnapshot.fetchedAt;
    liveTimestamp.textContent = `Snapshot · ${new Date(timestamp).toLocaleTimeString("en-CA", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit", second: "2-digit" })} · loads once`;
    updateSnapshotAge();
    // This timer only updates age labels; no polling or simulated movement.
    setInterval(updateSnapshotAge, 30_000);
  } catch {
    liveSummary.textContent = "Live status unavailable. Reload to try again.";
    liveTimestamp.textContent = "The streetcar map is still available.";
  }
}
liveToggle.addEventListener("change", () => { tooltip.hidden = true; drawSoon(); });
function focusPoint(point: Point, level = 3.5) {
  const width = initial.width/Math.max(1,Math.min(12,level)), height = width/(rect().width/rect().height);
  camera = {x:point[0]-width/2,y:point[1]-height/2,width,height}; tooltip.hidden = true; drawSoon();
}
function zoom(factor: number, anchor = center()) {
  camera = zoomCamera(camera,factor,anchor,initial.width/12,initial.width); tooltip.hidden = true; drawSoon();
}
function fit() { camera = {...initial}; tooltip.hidden = true; drawSoon(); }
function chooseRoute(id?: string, focus = false) {
  if (focus) selected = undefined;
  selectedRoute = selectedRoute === id ? undefined : id;
  document.querySelector<HTMLElement>("#clear-route")!.hidden = !selectedRoute;
  for (const [routeId,button] of routeButtons) button.setAttribute("aria-pressed",String(selectedRoute === routeId));
  if (focus && selectedRoute) {
    const points = data.edges.filter(e => e.routeIds.includes(selectedRoute!)).flatMap(e => e.points);
    if (points.length) {
      const bounds = fitCamera(boundsOf(points,80),rect().width/rect().height);
      const width = Math.max(initial.width/12,Math.min(initial.width,bounds.width));
      camera = {x:bounds.x+bounds.width/2-width/2,y:bounds.y+bounds.height/2-width/(rect().width/rect().height)/2,width,height:width/(rect().width/rect().height)};
    }
  }
  if (!selected) showOverview();
  drawSoon();
}
function closeDetails() { selected = undefined; showOverview(); drawSoon(); }
function showOverview() {
  details.replaceChildren();
  details.append(element("p","eyebrow",selectedRoute ? "Route highlighted" : "Explore Toronto"));
  const route = selectedRoute ? routes.get(selectedRoute) : undefined;
  details.append(element("h1","",route ? `${route.number} ${route.name}` : "Follow the city’s tracks."),
    element("p","",route ? "Highlighted tracks carry this route in the service snapshot. Select a stop to see its boarding details." : "From Long Branch to the Beaches, explore the network one stop at a time."));
  const stats = element("div","stats");
  const count = data.features.filter(f => !selectedRoute || f.routeIds.includes(selectedRoute)).length;
  for (const [number,label] of [[String(count),"stops & terminals"],[String(data.routes.filter(r => !r.overnight).length),"daytime routes"]]) {
    const stat = element("div"); stat.append(element("strong","",number),element("small","",label)); stats.append(stat);
  }
  details.append(stats,element("p","tip","Zoom in to reveal stop names and route numbers. Hover for a quick look; select a stop for the full details."));
}
function selectFeature(feature: Feature, focus = false) {
  selected = feature; hovered = undefined; tooltip.hidden = true;
  if (selectedRoute && !feature.routeIds.includes(selectedRoute)) chooseRoute(undefined);
  details.replaceChildren();
  details.append(element("p","eyebrow",feature.kind === "terminal" ? "Station / terminal" : "Streetcar stop"));
  const heading = element("div","details-heading"), close = element("button","close-details","×");
  close.setAttribute("aria-label","Close stop details"); close.onclick = closeDetails;
  heading.append(element("h1","",feature.name),close); details.append(heading);
  if (!feature.routeIds.length) details.append(element("p","tip","This physical terminal has no scheduled streetcar boarding records in this snapshot. Its tracks remain part of the map."));
  else details.append(element("p","",`${feature.routeIds.length} scheduled ${feature.routeIds.length === 1 ? "route" : "routes"} serve the boarding points grouped here.`));
  const services = element("div","served-routes");
  for (const route of sortedRoutes(feature.routeIds)) services.append(routeButton(route,() => chooseRoute(route.id)));
  details.append(services);
  if (feature.replacementRouteIds.length) details.append(element("p","",`${routeText(feature.replacementRouteIds)} has replacement-bus trips in this snapshot. Bus paths are not drawn.`));
  const focusButton = element("button","focus-button","Zoom to this stop"); focusButton.onclick = () => focusPoint(feature.point,5); details.append(focusButton);
  const facts = element("dl","stop-facts");
  if (feature.boardingPoints) {
    facts.append(element("dt","","Boarding points grouped here"),element("dd","",String(feature.boardingPoints)),
      element("dt","","Accessible boarding"),element("dd","",feature.accessible ? "Listed at one or more boarding points" : "Not confirmed in this snapshot"));
  }
  const destinations = element("details"), summary = element("summary","","Scheduled destinations"); destinations.append(summary);
  const list = element("ul");
  for (const route of sortedRoutes(feature.routeIds)) for (const headsign of feature.destinations[route.id] ?? []) list.append(element("li","",headsign));
  if (list.childElementCount) { destinations.append(list); facts.append(destinations); }
  if (feature.platformNames.length>1) {
    const platforms = element("details"); platforms.append(element("summary","","Boarding point names"));
    const names = element("ul"); feature.platformNames.forEach(name => names.append(element("li","",name))); platforms.append(names); facts.append(platforms);
  }
  details.append(facts);
  if (focus) focusPoint(feature.point);
  drawSoon();
}

for (const route of data.routes.filter(r => !r.overnight)) {
  const button = routeButton(route,() => chooseRoute(route.id,true)); button.setAttribute("aria-pressed","false");
  if (!route.scheduled) { button.disabled = true; button.title = "No scheduled streetcar service in this snapshot; physical tracks are shown dashed."; }
  routeButtons.set(route.id,button); document.querySelector("#route-list")!.append(button);
}
document.querySelector<HTMLButtonElement>("#clear-route")!.onclick = () => chooseRoute(undefined);
document.querySelector<HTMLButtonElement>("#zoom-in")!.onclick = () => zoom(.7);
document.querySelector<HTMLButtonElement>("#zoom-out")!.onclick = () => zoom(1/.7);
document.querySelector<HTMLButtonElement>("#fit")!.onclick = fit;
document.querySelector<HTMLButtonElement>("#labels")!.onclick = event => {
  moreLabels = !moreLabels; (event.currentTarget as HTMLButtonElement).setAttribute("aria-pressed",String(moreLabels)); drawSoon();
};
document.querySelector<HTMLAnchorElement>("#brand")!.onclick = event => { event.preventDefault(); selectedRoute = undefined; chooseRoute(undefined); closeDetails(); fit(); };
const date = new Date(data.snapshot);
document.querySelector("#snapshot")!.textContent = Number.isFinite(date.getTime()) ? `Service snapshot · ${new Intl.DateTimeFormat("en-CA",{month:"short",day:"numeric",year:"numeric",timeZone:"America/Toronto"}).format(date)}` : "Scheduled service snapshot";

function hideSearch() { results.hidden = true; search.setAttribute("aria-expanded","false"); }
search.addEventListener("input",() => {
  const matches = searchFeatures(data.features,data.routes,search.value); results.replaceChildren();
  if (!search.value.trim()) { hideSearch(); return; }
  for (const feature of matches) {
    const button = element("button","",feature.name);
    button.append(element("small","",routeText(feature.routeIds) || "Physical terminal · no scheduled streetcar service"));
    button.onclick = () => { hideSearch(); selectFeature(feature,true); search.value = feature.name; };
    results.append(button);
  }
  if (!matches.length) results.append(element("p","","No matching stops. Try a street name or route number."));
  results.hidden = false; search.setAttribute("aria-expanded","true");
});
search.addEventListener("keydown",event => {
  if (event.key === "Escape") hideSearch();
  if ((event.key === "Enter" || event.key === "ArrowDown") && !results.hidden) {
    const first = results.querySelector<HTMLButtonElement>("button");
    if (first) { event.preventDefault(); event.key === "Enter" ? first.click() : first.focus(); }
  }
});
results.addEventListener("keydown",event => {
    const buttons = Array.from(results.querySelectorAll<HTMLButtonElement>("button")), index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (event.key === "Escape") { hideSearch(); search.focus(); }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); buttons[(index+(event.key === "ArrowDown" ? 1 : buttons.length-1))%buttons.length]?.focus(); }
});
document.addEventListener("pointerdown",event => { if (!(event.target as Element).closest(".search")) hideSearch(); });

function hitFeature(x: number,y: number): Feature | undefined {
  const point = worldPoint(x,y), tolerance = camera.width/rect().width*10;
  return data.features.map(feature => ({feature,distance:Math.hypot(feature.point[0]-point[0],feature.point[1]-point[1])}))
    .filter(hit => hit.distance<=tolerance).sort((a,b) => a.distance-b.distance || Number(b.feature.kind === "terminal")-Number(a.feature.kind === "terminal"))[0]?.feature;
}
function hoverAt(x: number,y: number) {
  const car = hitVehicle(x, y);
  if (car) {
    hovered = undefined; tooltip.replaceChildren(element("strong", "", `Flexity car ${car.vehicle.label}`), element("small", "", vehicleDescription(car)), element("small", "", "Select for streetcar details"));
    tooltip.hidden = false;
    tooltip.style.left = `${Math.max(8, Math.min(x - rect().left + 16, rect().width - tooltip.offsetWidth - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(y - rect().top + 16, rect().height - tooltip.offsetHeight - 8))}px`;
    drawSoon(); return;
  }
  const feature = hitFeature(x,y);
  if (hovered?.id !== feature?.id) { hovered = feature; drawSoon(); }
  const point = worldPoint(x,y), tolerance = camera.width/rect().width*6;
  const hitEdge = feature ? undefined : data.edges.map(edge => ({edge,distance:Math.min(...edge.points.slice(1).map((p,i) => nearestOnSegment(point,edge.points[i],p).distance))}))
    .filter(hit => hit.distance<tolerance).sort((a,b) => a.distance-b.distance)[0]?.edge;
  if (!feature && !hitEdge) { tooltip.hidden = true; return; }
  tooltip.replaceChildren();
  tooltip.append(element("strong","",feature?.name ?? (hitEdge!.routeIds.length ? "Streetcar corridor" : "Physical track")),
    element("small","",feature ? routeText(feature.routeIds) || "No scheduled streetcar boarding point" : routeText(hitEdge!.routeIds) || data.infrastructure.filter(i => hitEdge!.infrastructureIds.includes(i.id)).map(i => i.name).join(" · ")));
  if (feature) tooltip.append(element("small","","Select to see boarding details"));
  tooltip.hidden = false;
  tooltip.style.left = `${Math.max(8,Math.min(x-rect().left+16,rect().width-tooltip.offsetWidth-8))}px`;
  tooltip.style.top = `${Math.max(8,Math.min(y-rect().top+16,rect().height-tooltip.offsetHeight-8))}px`;
}

const pointers = new Map<number,Point>();
let dragging = false, gestureMoved = false, gesturePinched = false, startPoint: Point | undefined;
let dragCamera = camera;
svg.addEventListener("pointerdown",event => {
  if (event.button !== 0) return;
  pointers.set(event.pointerId,[event.clientX,event.clientY]); svg.setPointerCapture(event.pointerId);
  startPoint = [event.clientX,event.clientY]; dragCamera = {...camera};
  if (pointers.size===1) { gestureMoved = false; gesturePinched = false; }
  else gesturePinched = true;
  tooltip.hidden = true;
});
svg.addEventListener("pointermove",event => {
  if (!pointers.has(event.pointerId)) { if (event.pointerType !== "touch") hoverAt(event.clientX,event.clientY); return; }
  const before = [...pointers.values()]; pointers.set(event.pointerId,[event.clientX,event.clientY]);
  const after = [...pointers.values()];
  if (pointers.size>=2) {
    const midpoint = (p: Point[]): Point => [(p[0][0]+p[1][0])/2,(p[0][1]+p[1][1])/2];
    const a = midpoint(before), b = midpoint(after);
    const oldDistance = Math.hypot(before[0][0]-before[1][0],before[0][1]-before[1][1]);
    const newDistance = Math.hypot(after[0][0]-after[1][0],after[0][1]-after[1][1]);
    if (oldDistance>0 && newDistance>0) zoom(oldDistance/newDistance,worldPoint(...a));
    camera = moveCamera(camera,-(b[0]-a[0])*camera.width/rect().width,-(b[1]-a[1])*camera.height/rect().height);
    gestureMoved = true; drawSoon(); return;
  }
  if (startPoint && (gestureMoved || Math.hypot(event.clientX-startPoint[0],event.clientY-startPoint[1])>4)) {
    gestureMoved = true; dragging = true; svg.classList.add("dragging");
    camera = moveCamera(dragCamera,-(event.clientX-startPoint[0])*dragCamera.width/rect().width,-(event.clientY-startPoint[1])*dragCamera.height/rect().height);
    hovered = undefined; drawSoon();
  }
});
function endPointer(event: PointerEvent) {
  if (!pointers.has(event.pointerId)) return;
  if (event.type === "pointerup" && !gestureMoved && !gesturePinched) {
    const car = hitVehicle(event.clientX, event.clientY);
    if (car) selectVehicle(car);
    else { const feature = hitFeature(event.clientX,event.clientY); if (feature) selectFeature(feature); }
  }
  pointers.delete(event.pointerId);
  if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  dragging = false; svg.classList.remove("dragging");
  startPoint = [...pointers.values()][0]; dragCamera = {...camera};
}
svg.addEventListener("pointerup",endPointer); svg.addEventListener("pointercancel",endPointer);
svg.addEventListener("pointerleave",() => { if (!dragging) { tooltip.hidden = true; hovered = undefined; drawSoon(); } });
svg.addEventListener("wheel",event => {
  event.preventDefault(); zoom(Math.exp(Math.max(-160,Math.min(160,event.deltaY))*.0025),worldPoint(event.clientX,event.clientY));
},{passive:false});
svg.addEventListener("dblclick",event => { event.preventDefault(); zoom(.5,worldPoint(event.clientX,event.clientY)); });
svg.addEventListener("keydown",event => {
  const keys: Record<string,Point> = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
  if (keys[event.key]) { event.preventDefault(); const [x,y] = keys[event.key]; camera = moveCamera(camera,x*camera.width*.08,y*camera.height*.08); drawSoon(); }
  else if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(.7); }
  else if (event.key === "-") { event.preventDefault(); zoom(1/.7); }
  else if (event.key === "Home" || event.key === "0") { event.preventDefault(); fit(); }
  else if (event.key === "Escape") { closeDetails(); tooltip.hidden = true; }
});
new ResizeObserver(() => {
  const previousLevel = zoomLevel(), point = center();
  initial = fitCamera(data.bounds,rect().width/Math.max(1,rect().height));
  previousLevel<1.01 ? fit() : focusPoint(point,previousLevel);
}).observe(viewport);
showOverview(); draw();
void bootLiveStatus();
