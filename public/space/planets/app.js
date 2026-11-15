// Planet Explorer — 3D Moon & Mars with click-to-explore.
// Data flow:
//   1. Shipped with the site: colour maps, elevation grids (LOLA / MOLA), USGS/IAU feature names, missions.json
//   2. Our API (/api, cached): live orbiter tracks (JPL Horizons), rover drive paths and latest raw photos
//   3. Straight from public services in the browser: NASA Trek high-res tiles, Wikipedia, NASA Image Library
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const VER = "2"; // bump on every data change so browsers never mix old cached data with new code
const API = "/api"; // served by the Space Relics Next backend
const BODY = {
  moon: {
    label: "Moon", tex: "textures/moon.jpg", feats: "data/moon-features.json", elev: "data/moon-elev.bin", wikiWord: /moon|lunar/i,
    trek: "https://trek.nasa.gov/moon/", ex: 6, maxZ: 8,
    layers: [{ upTo: 8, px: 256, name: "LRO WAC mosaic", credit: "NASA/GSFC/ASU", url: (z, y, x) => `https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/${z}/${y}/${x}.jpg` }],
  },
  mars: {
    label: "Mars", tex: "textures/mars.jpg", feats: "data/mars-features.json", elev: "data/mars-elev.bin", wikiWord: /mars|martian/i,
    trek: "https://trek.nasa.gov/mars/", ex: 4, maxZ: 12,
    layers: [
      { upTo: 6, px: 256, name: "Viking MDIM 2.1 mosaic", credit: "NASA/USGS", url: (z, y, x) => `https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/${z}/${y}/${x}.jpg` },
      { upTo: 12, px: 512, name: "MRO CTX global mosaic", credit: "NASA/JPL/MSSS/Caltech Murray Lab/Esri", url: (z, y, x) => `https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/${z}/${y}/${x}` },
    ],
  },
};

// ---------- scene ----------
const stage = $("#stage");
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
Object.assign(labelRenderer.domElement.style, { position: "absolute", top: "0", pointerEvents: "none" });
stage.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.0005, 200);
camera.position.set(0, 0.6, 3.6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 1.02;
controls.maxDistance = 9;
controls.autoRotateSpeed = 0.4;

scene.add(new THREE.AmbientLight(0xffffff, 0.3));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
scene.add(sun);
{
  const g = new THREE.BufferGeometry(), n = 3000, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) p.set(new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 40).toArray(), i * 3);
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.8 })));
}

const planet = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }));
scene.add(planet);
const world = new THREE.Group(); // markers, labels, orbits, rover paths (rebuilt per body / terrain change)
scene.add(world);

// ---------- coordinates ----------
// Maps are equirectangular, lon -180..180 with 0 in the middle, matching three.js SphereGeometry UVs.
function dirLL(lat, lon) {
  const u = (lon + 180) / 360, v = (lat + 90) / 180, phi = u * Math.PI * 2, theta = (1 - v) * Math.PI;
  return new THREE.Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
}
function vecToLL(p) {
  const r = p.length(), theta = Math.acos(THREE.MathUtils.clamp(p.y / r, -1, 1));
  let phi = Math.atan2(p.z, -p.x);
  if (phi < 0) phi += Math.PI * 2;
  return { lat: 90 - (theta * 180) / Math.PI, lon: (phi / (Math.PI * 2)) * 360 - 180 };
}
function distKm(a, b, R) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const fmtLL = (lat, lon) => `${Math.abs(lat).toFixed(3)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(3)}° ${lon >= 0 ? "E" : "W"}`;
const fmtKm = (k) => (k < 10 ? k.toFixed(1) : Math.round(k).toLocaleString()) + " km";
const fmtM = (m) => `${m >= 0 ? "+" : "−"}${Math.abs(Math.round(m)).toLocaleString()} m`;

// ---------- elevation (metres, Int16 grid 1440×720) ----------
let ELEV = null, EW = 1440, EH = 720, ex = 6;
function elevAt(lat, lon) {
  if (!ELEV) return 0;
  const x = ((((lon + 180) / 360) * EW - 0.5) % EW + EW) % EW, y = THREE.MathUtils.clamp(((90 - lat) / 180) * EH - 0.5, 0, EH - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = (x0 + 1) % EW, y1 = Math.min(y0 + 1, EH - 1), fx = x - x0, fy = y - y0;
  const g = (xx, yy) => ELEV[yy * EW + xx];
  return (g(x0, y0) * (1 - fx) + g(x1, y0) * fx) * (1 - fy) + (g(x0, y1) * (1 - fx) + g(x1, y1) * fx) * fy;
}
const surfR = (lat, lon, lift = 0) => 1 + (ex * elevAt(lat, lon)) / 1000 / R + lift;
const surfV = (lat, lon, lift = 0) => dirLL(lat, lon).multiplyScalar(surfR(lat, lon, lift));

function buildGlobe() {
  const g = new THREE.SphereGeometry(1, 720, 360), pos = g.attributes.position, uv = g.attributes.uv, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const lat = uv.getY(i) * 180 - 90, lon = uv.getX(i) * 360 - 180;
    v.fromBufferAttribute(pos, i).multiplyScalar(surfR(lat, lon));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  planet.geometry.dispose();
  planet.geometry = g;
}

// ---------- state ----------
let MISSIONS = null, body = "moon", feats = [], R = 1737.4, markers = [], orbiters = [], labels = [], pin = null, live = null;
const loader = new THREE.TextureLoader();
const cache = {};

async function loadBody(name) {
  body = name;
  document.querySelectorAll(".seg button").forEach((b) => b.classList.toggle("on", b.dataset.body === name));
  $("#loading").hidden = false;
  closePanel();
  clearTiles();
  const B = BODY[name];
  if (!cache[name]) {
    const [tex, f, elev] = await Promise.all([
      loader.loadAsync(`${B.tex}?v=${VER}`),
      fetch(`${B.feats}?v=${VER}`).then((r) => r.json()),
      fetch(`${B.elev}?v=${VER}`).then((r) => r.arrayBuffer()),
    ]);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    cache[name] = { tex, elev: new Int16Array(elev), feats: f.map(([n, lat, lon, d, type, origin, id]) => ({ n, lat, lon, d, type, origin, id })) };
  }
  if (body !== name) return; // switched again while loading
  const m = planet.material;
  m.map = cache[name].tex;
  m.bumpMap = cache[name].tex;
  m.bumpScale = 0.6;
  m.needsUpdate = true;
  feats = cache[name].feats;
  ELEV = cache[name].elev;
  R = MISSIONS[name].radiusKm;
  ex = B.ex;
  $("#ex").value = ex;
  $("#exv").textContent = ex + "×";
  buildGlobe();
  buildWorld();
  camera.position.copy(name === "moon" ? dirLL(12, 10).multiplyScalar(3.4) : dirLL(5, -65).multiplyScalar(3.4));
  controls.update();
  $("#loading").hidden = true;
  loadLive(name);
  if (name === "mars") loadRovers();
}

// ---------- markers, labels, orbits ----------
const vis = (km) => 1.06 + 0.33 * Math.log10(1 + Math.max(km, 0) / 100); // compressed altitude for display
function buildWorld() {
  world.traverse((o) => o.isCSS2DObject && o.element.remove()); // CSS labels live in the DOM
  world.clear();
  markers = []; orbiters = []; labels = []; routes.length = 0; pin = null;
  const M = MISSIONS[body];
  const sites = new THREE.Group();
  sites.name = "sites";
  world.add(sites);
  const siteGeo = new THREE.SphereGeometry(0.008, 16, 8);
  M.landings.forEach((s) => {
    const mesh = new THREE.Mesh(siteGeo, new THREE.MeshBasicMaterial({ color: 0xffc04d, depthTest: false }));
    mesh.position.copy(surfV(s.lat, s.lon, 0.0002));
    mesh.userData = { kind: "site", data: s };
    sites.add(mesh);
    markers.push(mesh);
    labels.push(addLabel(s.name, surfV(s.lat, s.lon, 0.0004), "site", sites));
  });
  const labGroup = new THREE.Group();
  labGroup.name = "labels";
  world.add(labGroup);
  feats.filter((f) => f.type !== "Satellite Feature" && f.type !== "Albedo Feature" && f.d > 0).slice(0, body === "moon" ? 24 : 22)
    .forEach((f) => labels.push(addLabel(f.n, surfV(f.lat, f.lon, 0.01), "", labGroup)));
  const orbGroup = new THREE.Group();
  orbGroup.name = "orbits";
  world.add(orbGroup);
  M.orbiters.forEach((o, i) => {
    const sat = new THREE.Mesh(new THREE.OctahedronGeometry(0.02), new THREE.MeshBasicMaterial({ color: new THREE.Color(o.color) }));
    const lab = new CSS2DObject(Object.assign(document.createElement("div"), { className: "label", textContent: o.name }));
    sat.add(lab);
    sat.userData = { kind: "orbiter", data: o, idx: i, lab };
    orbGroup.add(sat);
    orbiters.push(sat);
    markers.push(sat);
    setOrbit(sat, null);
  });
  const roverGroup = new THREE.Group();
  roverGroup.name = "rovers";
  world.add(roverGroup);
  world.traverse((o) => (o.renderOrder = 2));
  if (live?.body === body) live.orbiters.forEach(applyLive);
  if (body === "mars") Object.values(rovers).forEach(drawRover);
  applyLayers();
}
function addLabel(text, pos, cls, parent) {
  const obj = new CSS2DObject(Object.assign(document.createElement("div"), { className: "label " + cls, textContent: text }));
  obj.position.copy(pos);
  parent.add(obj);
  return obj;
}
// illustrative ellipse (no live data) or a real track from JPL Horizons
function setOrbit(sat, track) {
  const u = sat.userData, o = u.data;
  if (u.line) { u.line.geometry.dispose(); u.line.parent?.remove(u.line); }
  let pts;
  if (track) {
    u.track = track.points.map((p) => ({ t: p.t, alt: p.alt, lat: p.lat, lon: p.lon, v: dirLL(p.lat, p.lon).multiplyScalar(vis(p.alt)) }));
    pts = u.track.map((p) => p.v);
    u.live = true;
  } else {
    const rp = vis(o.altKm), ra = vis(o.apoKm), a = (rp + ra) / 2, e = (ra - rp) / (ra + rp);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(((90 - o.inc) * Math.PI) / 180, (u.idx * 67 * Math.PI) / 180, 0, "YXZ"));
    u.ell = { a, e, q, nu: Math.random() * Math.PI * 2, speed: 0.6 / Math.pow(a, 1.5) };
    pts = [];
    for (let k = 0; k <= 256; k++) {
      const nu = (k / 256) * Math.PI * 2, r = (a * (1 - e * e)) / (1 + e * Math.cos(nu));
      pts.push(new THREE.Vector3(r * Math.cos(nu), 0, r * Math.sin(nu)).applyQuaternion(q));
    }
    u.live = false;
  }
  u.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: new THREE.Color(o.color), transparent: true, opacity: track ? 0.75 : 0.35 }));
  sat.parent.add(u.line);
  u.lab.element.textContent = (track ? "● " : "") + o.name;
  u.lab.element.classList.toggle("live", !!track);
}
function applyLive(t) {
  const sat = orbiters.find((s) => s.userData.data.name === t.name);
  if (!sat) return;
  sat.userData.liveInfo = t;
  if (t.live && t.points?.length > 2) setOrbit(sat, t);
}
async function loadLive(name) {
  $("#livebadge").textContent = "Live orbits: loading…";
  try {
    const j = await fetch(`${API}/orbiters?body=${name}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
    if (body !== name) return;
    live = j;
    j.orbiters.forEach(applyLive);
    const n = j.orbiters.filter((o) => o.live).length;
    $("#livebadge").textContent = `● ${n} orbiters live · NASA JPL Horizons${j.stale ? " (cached)" : ""}`;
  } catch {
    if (body === name) $("#livebadge").textContent = "Live orbits unavailable · showing illustrative orbits";
  }
}

// ---------- rovers (Mars) ----------
const rovers = {}, routes = [];
async function loadRovers() {
  for (const r of MISSIONS.mars.rovers || []) {
    if (rovers[r.id]) continue;
    fetch(`${API}/traverse?rover=${r.id}`).then((x) => x.json()).then((t) => {
      if (!t.points?.length) return;
      let km = 0;
      for (let i = 1; i < t.points.length; i++) km += distKm({ lon: t.points[i - 1][0], lat: t.points[i - 1][1] }, { lon: t.points[i][0], lat: t.points[i][1] }, 3389.5);
      rovers[r.id] = { ...r, ...t, km };
      if (body === "mars") drawRover(rovers[r.id]);
    }).catch(() => {});
  }
}
function drawRover(rv) {
  const g = world.getObjectByName("rovers");
  if (!g || g.getObjectByName("rv-" + rv.id)) return;
  const grp = new THREE.Group();
  grp.name = "rv-" + rv.id;
  const pts = rv.points.map(([lon, lat]) => surfV(lat, lon, 0.0006));
  const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x7cf3ff, depthTest: false }));
  path.userData.anchor = surfV(rv.current[1], rv.current[0]);
  grp.add(path);
  routes.push(path);
  const [lon, lat] = rv.current;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshBasicMaterial({ color: 0x7cf3ff, depthTest: false }));
  dot.position.copy(surfV(lat, lon, 0.0002));
  dot.userData = { kind: "rover", data: rv };
  grp.add(dot);
  markers.push(dot);
  labels.push(addLabel(`🛞 ${rv.name} (now)`, surfV(lat, lon, 0.0004), "rover", grp));
  grp.traverse((o) => (o.renderOrder = 2));
  g.add(grp);
}

function applyLayers() {
  world.children.forEach((g) => {
    if (g.name === "sites" || g.name === "rovers") g.visible = $("#lyLand").checked;
    if (g.name === "labels") g.visible = $("#lyLab").checked;
    if (g.name === "orbits") g.visible = $("#lyOrb").checked;
  });
}
["#lyLand", "#lyOrb", "#lyLab"].forEach((id) => $(id).addEventListener("change", applyLayers));
$("#lySpin").addEventListener("change", (e) => (controls.autoRotate = e.target.checked));
$("#ex").addEventListener("input", (e) => ($("#exv").textContent = e.target.value + "×"));
$("#ex").addEventListener("change", (e) => {
  ex = +e.target.value;
  buildGlobe();
  buildWorld();
  refreshTiles(true);
});

// ---------- high-resolution tiles (NASA Trek WMTS, geographic grid: level z has 2^(z+1) × 2^z tiles of 256 px) ----------
let patch = null, patchKey = "", tileTimer = null;
const tileCache = new Map();
function clearTiles() {
  if (patch) { scene.remove(patch); patch.geometry.dispose(); patch.material.map?.dispose(); patch.material.dispose(); patch = null; }
  patchKey = "";
  $("#hdbadge").hidden = true;
}
function loadTile(url) {
  if (tileCache.has(url)) return tileCache.get(url);
  const p = new Promise((ok) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => ok(im);
    im.onerror = () => ok(null);
    im.src = url;
  });
  tileCache.set(url, p);
  if (tileCache.size > 400) tileCache.delete(tileCache.keys().next().value);
  return p;
}
async function refreshTiles(force) {
  const d = camera.position.length() - 1;
  if (d > 0.75) return clearTiles();
  const hit = new THREE.Raycaster(camera.position.clone(), camera.position.clone().negate().normalize()).intersectObject(planet)[0];
  if (!hit) return;
  const c = vecToLL(hit.point), B = BODY[body];
  const fpDeg = 2 * d * Math.tan(THREE.MathUtils.degToRad(20)) * (180 / Math.PI) * 1.4; // rough visible width
  const z = THREE.MathUtils.clamp(Math.round(Math.log2((180 * 2.5) / fpDeg)), 2, B.maxZ);
  const L = B.layers.find((l) => z <= l.upTo), TP = L.px; // TP = tile size in pixels
  const tileDeg = 180 / 2 ** z, cols = 6, rows = 4;
  const nx = 2 ** (z + 1), ny = 2 ** z;
  const cx = Math.floor((c.lon + 180) / tileDeg), cy = Math.floor((90 - c.lat) / tileDeg);
  const x0 = cx - Math.floor(cols / 2), y0 = THREE.MathUtils.clamp(cy - Math.floor(rows / 2), 0, Math.max(0, ny - rows));
  const key = `${body}/${z}/${x0}/${y0}/${ex}`;
  if (!force && key === patchKey) return;
  patchKey = key;
  const canvas = document.createElement("canvas");
  canvas.width = cols * TP;
  canvas.height = Math.min(rows, ny) * TP;
  const ctx = canvas.getContext("2d");
  const jobs = [];
  for (let j = 0; j < Math.min(rows, ny); j++)
    for (let i = 0; i < cols; i++) {
      const tx = (((x0 + i) % nx) + nx) % nx, ty = y0 + j;
      jobs.push(loadTile(L.url(z, ty, tx)).then((im) => im && ctx.drawImage(im, i * TP, j * TP, TP, TP)));
    }
  await Promise.all(jobs);
  if (patchKey !== key) return; // user moved on
  // patch mesh following the terrain, slightly above the globe
  const lon0 = x0 * tileDeg - 180, lat0 = 90 - y0 * tileDeg, lonSpan = cols * tileDeg, latSpan = Math.min(rows, ny) * tileDeg;
  const N = 64, pos = [], uv = [], idx = [];
  for (let j = 0; j <= N; j++)
    for (let i = 0; i <= N; i++) {
      const lat = lat0 - (j / N) * latSpan, lon = lon0 + (i / N) * lonSpan;
      pos.push(...surfV(lat, lon, 0.00004 + d * 0.0004).toArray());
      uv.push(i / N, 1 - j / N);
    }
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c2 = a + N + 1, d2 = c2 + 1;
      idx.push(a, c2, b, b, c2, d2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // drawn on top of the coarse globe (which can poke through between its vertices); the patch is always on the side facing us
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0, depthTest: false });
  if (patch) { scene.remove(patch); patch.geometry.dispose(); patch.material.map?.dispose(); patch.material.dispose(); }
  patch = new THREE.Mesh(g, mat);
  patch.renderOrder = 1;
  scene.add(patch);
  const mpp = ((tileDeg / TP) * Math.PI * R * 1000) / 180;
  $("#hdbadge").textContent = `HD · ${L.name} (${L.credit}) · ~${mpp < 1000 ? Math.round(mpp) + " m" : (mpp / 1000).toFixed(1) + " km"}/pixel`;
  $("#hdbadge").hidden = false;
}
controls.addEventListener("change", () => {
  clearTimeout(tileTimer);
  tileTimer = setTimeout(() => refreshTiles(false), 350);
  const d = camera.position.length() - 1;
  controls.rotateSpeed = THREE.MathUtils.clamp(d / 2.6, 0.02, 0.5);
  controls.zoomSpeed = d < 0.3 ? 0.5 : 1;
});

// ---------- clicking ----------
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
let down = null;
renderer.domElement.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return; // it was a drag
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hitP = ray.intersectObject(planet, false)[0];
  // markers are small: pick the nearest visible one within 16 px on screen
  let best = null, bestPx = 16;
  for (const m of markers) {
    if (!isVisible(m)) continue;
    const wp = m.getWorldPosition(new THREE.Vector3());
    if (hitP && wp.distanceTo(camera.position) > hitP.distance + 0.01) continue; // hidden behind the planet
    const sp = wp.clone().project(camera), px = Math.hypot(((sp.x + 1) / 2) * innerWidth - e.clientX, ((1 - sp.y) / 2) * innerHeight - e.clientY);
    if (sp.z < 1 && px < bestPx) { bestPx = px; best = m; }
  }
  if (best) {
    const u = best.userData;
    return u.kind === "site" ? showSite(u.data) : u.kind === "rover" ? showRover(u.data) : showOrbiter(u.data, best);
  }
  if (hitP) showPoint(vecToLL(hitP.point));
});
function isVisible(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
function dropPin(lat, lon) {
  if (pin) world.remove(pin);
  const h = 0.03 * THREE.MathUtils.clamp(camera.position.length() - 1, 0.05, 1);
  pin = new THREE.Mesh(new THREE.ConeGeometry(h * 0.25, h, 12), new THREE.MeshBasicMaterial({ color: 0x6ea8ff, depthTest: false }));
  pin.renderOrder = 3;
  const p = surfV(lat, lon, h / 2);
  pin.position.copy(p);
  pin.lookAt(p.clone().multiplyScalar(2));
  pin.rotateX(-Math.PI / 2);
  world.add(pin);
}

// ---------- panel ----------
function openPanel(html) {
  $("#pbody").innerHTML = html;
  $("#panel").hidden = false;
  $("#panel").scrollTop = 0;
  $("#hint").hidden = true;
}
function closePanel() {
  $("#panel").hidden = true;
  if (pin) { world.remove(pin); pin = null; }
}
$("#close").onclick = closePanel;
let seq = 0; // ignore late API answers after the user clicked somewhere else

function showPoint({ lat, lon }, focus) {
  dropPin(lat, lon);
  const my = ++seq, here = { lat, lon }, elev = elevAt(lat, lon);
  const ranked = feats.map((f) => ({ f, km: distKm(here, f, R) }));
  const inside = ranked.filter((x) => x.f.d && x.km <= x.f.d / 2 && x.f.type !== "Satellite Feature").sort((a, b) => b.f.d - a.f.d);
  const near = ranked.filter((x) => x.f.type !== "Satellite Feature").sort((a, b) => a.km - b.km).slice(0, 6);
  const main = focus || (inside.length ? inside[inside.length - 1].f : near[0]?.f);
  const sites = MISSIONS[body].landings.map((s) => ({ s, km: distKm(here, s, R) })).sort((a, b) => a.km - b.km);
  const close = sites.filter((x) => x.km < 600).slice(0, 4);
  openPanel(`
    <div class="eyebrow">${BODY[body].label} · location</div>
    <h2>${main ? esc(main.n) : "Unnamed terrain"}</h2>
    <div class="coords">${fmtLL(lat, lon)}</div>
    <div class="chips">
      <span class="chip elev" title="${body === "moon" ? "LRO LOLA, relative to a 1,737.4 km sphere" : "MGS MOLA, relative to the Mars areoid"}">⛰ Elevation ${fmtM(elev)}</span>
      ${main ? `<span class="chip">${esc(main.type)}</span>${main.d ? `<span class="chip">${fmtKm(main.d)} across</span>` : ""}${inside.length ? `<span class="chip">You clicked inside it</span>` : `<span class="chip">${fmtKm(distKm(here, main, R))} from here</span>`}` : ""}
    </div>
    ${main?.origin ? `<p class="muted">Named after: ${esc(main.origin)}</p>` : ""}
    <div class="sec"><h3>About</h3><div class="wiki" id="wk"><span class="muted">Looking up…</span></div></div>
    ${inside.length > 1 ? `<div class="sec"><h3>This spot is inside</h3><div class="list">${inside.slice(0, 4).map((x) => featBtn(x.f, x.f.d ? fmtKm(x.f.d) + " wide" : "")).join("")}</div></div>` : ""}
    <div class="sec"><h3>Nearest named features</h3><div class="list">${near.map((x) => featBtn(x.f, fmtKm(x.km))).join("")}</div></div>
    <div class="sec"><h3>Missions that landed nearby</h3>${close.length ? `<div class="list">${close.map((x) => siteBtn(x.s, fmtKm(x.km))).join("")}</div>` : `<p class="muted">No landing within 600 km. Closest: ${siteBtn(sites[0].s, fmtKm(sites[0].km), true)}</p>`}</div>
    <div class="sec"><h3>NASA images</h3><div class="gallery" id="gal"><span class="muted">Searching NASA…</span></div></div>
    <div class="sec"><h3>Explore further</h3><div class="links">
      <button class="linkbtn" id="zoomhere">🔍 Zoom in here (HD imagery)</button>
      ${main ? `<a href="https://planetarynames.wr.usgs.gov/Feature/${esc(main.id)}" target="_blank" rel="noopener">USGS feature page ↗</a>` : ""}
      <a href="${BODY[body].trek}" target="_blank" rel="noopener">NASA ${BODY[body].label} Trek ↗</a>
    </div></div>`);
  wirePanel();
  $("#zoomhere").onclick = () => flyTo(lat, lon, 1.12);
  if (main) {
    wikiFor(main).then((w) => my === seq && renderWiki(w));
    const cands = [main, ...inside.map((x) => x.f), ...near.map((x) => x.f)].filter((f, i, a) => a.indexOf(f) === i).slice(0, 5);
    (async () => {
      for (const f of cands) {
        const g = await nasaImages(`${f.n} ${BODY[body].label}`);
        if (my !== seq) return;
        if (g.length) return renderGallery(g, f === main ? null : f.n);
      }
      renderGallery([]);
    })();
  } else {
    renderWiki(null);
    renderGallery([]);
  }
}
function showSite(s) {
  dropPin(s.lat, s.lon);
  const my = ++seq, here = { lat: s.lat, lon: s.lon };
  const near = feats.filter((f) => f.type !== "Satellite Feature").map((f) => ({ f, km: distKm(here, f, R) })).sort((a, b) => a.km - b.km).slice(0, 4);
  const rv = body === "mars" ? (MISSIONS.mars.rovers || []).find((r) => r.landing === s.name) : null;
  openPanel(`
    <div class="eyebrow">${BODY[body].label} · landing site</div>
    <h2>${esc(s.name)}</h2>
    <div class="coords">${fmtLL(s.lat, s.lon)}${s.approx ? " (approx.)" : ""}</div>
    <div class="chips"><span class="chip">${esc(s.agency)}</span><span class="chip">${s.year}</span><span class="chip">${esc(s.kind)}</span><span class="chip elev">⛰ ${fmtM(elevAt(s.lat, s.lon))}</span></div>
    ${rv ? `<div class="links" style="margin:6px 0 4px"><button class="linkbtn" id="rvgo">🛞 See where ${esc(rv.name)} is now + latest photos</button></div>` : ""}
    <div class="sec"><h3>About the mission</h3><div class="wiki" id="wk"><span class="muted">Looking up…</span></div></div>
    <div class="sec"><h3>Named features around it</h3><div class="list">${near.map((x) => featBtn(x.f, fmtKm(x.km))).join("")}</div></div>
    <div class="sec"><h3>NASA images</h3><div class="gallery" id="gal"><span class="muted">Searching NASA…</span></div></div>
    <div class="links" style="margin-top:14px"><button class="linkbtn" id="zoomhere">🔍 Zoom in here (HD imagery)</button></div>`);
  wirePanel();
  $("#zoomhere").onclick = () => flyTo(s.lat, s.lon, 1.06);
  if (rv) $("#rvgo").onclick = () => (rovers[rv.id] ? showRover(rovers[rv.id], true) : ($("#rvgo").textContent = "Rover data still loading… try again in a moment"));
  wiki(s.wiki).then((w) => my === seq && renderWiki(w));
  nasaImages(s.name.replace(/\(.*?\)/g, "").split("/")[0].trim()).then((g) => my === seq && renderGallery(g));
}
async function showRover(rv, fly) {
  const [lon, lat] = rv.current, my = ++seq;
  dropPin(lat, lon);
  if (fly) flyTo(lat, lon, 1.012);
  openPanel(`
    <div class="eyebrow">Mars · rover today</div>
    <h2>${esc(rv.name)}</h2>
    <div class="coords">${fmtLL(lat, lon)}</div>
    <div class="chips"><span class="chip">Driven ~${rv.km.toFixed(1)} km</span>${rv.lastSol ? `<span class="chip">Route up to sol ${rv.lastSol}</span>` : ""}<span class="chip elev">⛰ ${fmtM(elevAt(lat, lon))}</span></div>
    <p class="muted">The cyan line is the rover's actual drive path (NASA/JPL MMGIS). Zoom in to see it on HD imagery.</p>
    <div class="links"><button class="linkbtn" id="zoomhere">🔍 Fly to the rover</button></div>
    <div class="sec"><h3>Latest raw photos from ${esc(rv.name)}</h3><div class="gallery" id="gal"><span class="muted">Fetching from NASA…</span></div><p class="muted" id="rvcredit"></p></div>`);
  $("#zoomhere").onclick = () => flyTo(lat, lon, 1.012);
  try {
    const p = await fetch(`${API}/rover-photos?rover=${rv.id}`).then((r) => r.json());
    if (my !== seq) return;
    const el = $("#gal");
    el.innerHTML = p.items.length
      ? p.items.slice(0, 12).map((x) => `<a href="${esc(x.full || x.link)}" target="_blank" rel="noopener" title="Sol ${x.sol} · ${esc(x.camera)}"><img src="${esc(x.thumb)}" alt="Sol ${x.sol} ${esc(x.camera)}" loading="lazy"></a>`).join("")
      : `<span class="muted">No photos returned.</span>`;
    $("#rvcredit").textContent = p.items.length ? `Sol ${p.items[0].sol} (taken ${new Date(p.items[0].taken).toUTCString().slice(5, 16)}) · ${p.credit}` : "";
  } catch {
    if (my === seq) $("#gal").innerHTML = `<span class="muted">Rover photos are unavailable right now.</span>`;
  }
}
function showOrbiter(o, sat) {
  if (pin) { world.remove(pin); pin = null; }
  const my = ++seq, u = sat?.userData || {}, li = u.liveInfo;
  let now = "";
  if (u.live && u.cur) now = `<div class="livebox"><b>● Live position (JPL Horizons)</b><br>Above ${fmtLL(u.cur.lat, u.cur.lon)} · altitude ${Math.round(u.cur.alt).toLocaleString()} km<br><span class="muted">Track shows the next ~${Math.round((u.track.at(-1).t - u.track[0].t) / 60e3)} min; the bright line is the real ground track, lifted for display.</span></div>`;
  else if (li && !li.live) now = `<p class="muted">No live position: ${esc(li.reason)}. Showing an illustrative orbit.</p>`;
  else now = `<p class="muted">${o.hid ? "Live position loading…" : "This spacecraft isn't in NASA JPL Horizons, so the orbit drawn is illustrative."}</p>`;
  openPanel(`
    <div class="eyebrow">${BODY[body].label} · orbiter</div>
    <h2>${esc(o.name)}</h2>
    <div class="chips"><span class="chip">${esc(o.agency)}</span><span class="chip">In orbit since ${o.since}</span><span class="chip">${o.altKm === o.apoKm ? `~${o.altKm.toLocaleString()} km altitude` : `${o.altKm.toLocaleString()} × ${o.apoKm.toLocaleString()} km`}</span><span class="chip">${o.inc}° inclination</span></div>
    ${now}
    <div class="sec"><h3>About the mission</h3><div class="wiki" id="wk"><span class="muted">Looking up…</span></div></div>
    <div class="sec"><h3>NASA images</h3><div class="gallery" id="gal"><span class="muted">Searching NASA…</span></div></div>`);
  wiki(o.wiki).then((w) => my === seq && renderWiki(w));
  nasaImages(o.name.replace(/\(.*?\)/g, "").trim()).then((g) => my === seq && renderGallery(g));
}
const featBtn = (f, right) => `<button data-feat="${esc(f.id)}"><span>${esc(f.n)} <small>· ${esc(f.type)}</small></span><small>${right}</small></button>`;
const siteBtn = (s, right, inline) => (inline ? `<a href="#" data-site="${esc(s.name)}">${esc(s.name)}</a> (${right})` : `<button data-site="${esc(s.name)}"><span>🚀 ${esc(s.name)} <small>· ${s.year}</small></span><small>${right}</small></button>`);
function wirePanel() {
  $("#pbody").querySelectorAll("[data-feat]").forEach((b) => (b.onclick = () => { const f = feats.find((x) => x.id === b.dataset.feat); flyTo(f.lat, f.lon); showPoint({ lat: f.lat, lon: f.lon }, f); }));
  $("#pbody").querySelectorAll("[data-site]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); const s = MISSIONS[body].landings.find((x) => x.name === b.dataset.site); flyTo(s.lat, s.lon); showSite(s); }));
}

// ---------- live data: Wikipedia + NASA Image Library ----------
const wikiCache = new Map();
async function wiki(title) {
  if (wikiCache.has(title)) return wikiCache.get(title);
  let out = null;
  try {
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    if (r.ok) {
      const j = await r.json();
      if (j.type !== "disambiguation" && j.extract) out = { title: j.title, text: j.extract, img: j.thumbnail?.source, url: j.content_urls?.desktop?.page };
    }
  } catch {}
  wikiCache.set(title, out);
  return out;
}
async function wikiFor(f) {
  const B = BODY[body], crater = /crater/i.test(f.type);
  const tries = crater ? [`${f.n} (${body === "moon" ? "lunar" : "Martian"} crater)`, `${f.n} (crater)`, f.n] : [f.n, `${f.n} (${B.label})`];
  for (const t of tries) {
    const w = await wiki(t);
    if (w && B.wikiWord.test(w.text)) return w;
  }
  return null;
}
function renderWiki(w) {
  const el = $("#wk");
  if (!el) return;
  el.innerHTML = w
    ? `${w.img ? `<img src="${esc(w.img)}" alt="">` : ""}<p>${esc(w.text)}</p><a class="muted" href="${esc(w.url)}" target="_blank" rel="noopener">Read more on Wikipedia ↗</a>`
    : `<p class="muted">No encyclopedia article found for this exact place. The USGS feature page has the official record.</p>`;
}
const imgCache = new Map();
async function nasaImages(q) {
  if (imgCache.has(q)) return imgCache.get(q);
  let out = [];
  try {
    const j = await fetch(`https://images-api.nasa.gov/search?media_type=image&q=${encodeURIComponent(q)}`).then((r) => r.json());
    out = (j.collection?.items || []).slice(0, 9).map((it) => ({ id: it.data?.[0]?.nasa_id, title: it.data?.[0]?.title, thumb: it.links?.[0]?.href })).filter((x) => x.thumb);
  } catch {}
  imgCache.set(q, out);
  return out;
}
function renderGallery(list, about) {
  const el = $("#gal");
  if (!el) return;
  if (about) el.insertAdjacentHTML("beforebegin", `<p class="muted" style="margin:0 0 6px">No photos of this exact spot, showing nearby ${esc(about)}:</p>`);
  el.innerHTML = list.length
    ? list.map((x) => `<a href="https://images.nasa.gov/details/${encodeURIComponent(x.id)}" target="_blank" rel="noopener" title="${esc(x.title)}"><img src="${esc(x.thumb)}" alt="${esc(x.title)}" loading="lazy"></a>`).join("")
    : `<span class="muted">No NASA library images for this name.</span>`;
}

// ---------- camera fly-to ----------
let fly = null;
function flyTo(lat, lon, dist) {
  const target = dist ?? Math.max(1.8, Math.min(camera.position.length(), 3));
  const surf = surfR(lat, lon);
  fly = { from: camera.position.clone(), to: dirLL(lat, lon).multiplyScalar(Math.max(target, surf + 0.006)), t: 0 };
  controls.autoRotate = false;
  $("#lySpin").checked = false;
}

// ---------- search ----------
const q = $("#q"), res = $("#results");
let hits = [], act = 0;
q.addEventListener("input", () => {
  const s = q.value.trim().toLowerCase();
  if (s.length < 2) { res.hidden = true; return; }
  const M = MISSIONS[body];
  const sm = [
    ...M.landings.map((x) => ({ k: "site", x, label: x.name, sub: `Landing · ${x.year}` })),
    ...M.orbiters.map((x) => ({ k: "orb", x, label: x.name, sub: "Orbiter" })),
    ...(body === "mars" ? Object.values(rovers).map((x) => ({ k: "rover", x, label: x.name + " (where it is now)", sub: "Rover" })) : []),
  ].filter((h) => h.label.toLowerCase().includes(s));
  const sf = feats.filter((f) => f.n.toLowerCase().includes(s)).sort((a, b) => (a.n.toLowerCase().startsWith(s) ? 0 : 1) - (b.n.toLowerCase().startsWith(s) ? 0 : 1) || b.d - a.d).slice(0, 10).map((f) => ({ k: "feat", x: f, label: f.n, sub: f.type }));
  hits = [...sm, ...sf].slice(0, 12);
  act = 0;
  res.innerHTML = hits.length ? hits.map((h, i) => `<li data-i="${i}" class="${i === 0 ? "act" : ""}"><span>${esc(h.label)}</span><small>${esc(h.sub)}</small></li>`).join("") : `<li><small>Nothing on the ${BODY[body].label} called that</small></li>`;
  res.hidden = false;
});
q.addEventListener("keydown", (e) => {
  if (res.hidden || !hits.length) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    act = (act + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length;
    res.querySelectorAll("li").forEach((li, i) => li.classList.toggle("act", i === act));
    e.preventDefault();
  }
  if (e.key === "Enter") pick(act);
  if (e.key === "Escape") res.hidden = true;
});
res.addEventListener("click", (e) => { const li = e.target.closest("li[data-i]"); if (li) pick(+li.dataset.i); });
function pick(i) {
  const h = hits[i];
  if (!h) return;
  res.hidden = true;
  q.value = h.label;
  q.blur();
  if (h.k === "feat") { flyTo(h.x.lat, h.x.lon); showPoint({ lat: h.x.lat, lon: h.x.lon }, h.x); }
  else if (h.k === "site") { flyTo(h.x.lat, h.x.lon); showSite(h.x); }
  else if (h.k === "rover") showRover(h.x, true);
  else { $("#lyOrb").checked = true; applyLayers(); showOrbiter(h.x, orbiters.find((s) => s.userData.data === h.x)); }
}
document.querySelectorAll(".seg button").forEach((b) => (b.onclick = () => b.dataset.body !== body && loadBody(b.dataset.body)));
// stay inside the app shell: ask the parent to route instead of loading the game in the frame
document.querySelector(".top .navlink")?.addEventListener("click", (e) => { if (window.parent !== window) { e.preventDefault(); window.parent.postMessage({ source: "planet-explorer", type: "navigate", to: "/game" }, location.origin); } });

// ---------- loop ----------
const clock = new THREE.Clock(), tmp = new THREE.Vector3(), camDir = new THREE.Vector3();
let simT = Date.now();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const speed = $("#ff").checked ? 120 : 1; // fast-forward: 2 minutes per second
  simT += dt * 1000 * speed;
  if (fly) {
    fly.t = Math.min(1, fly.t + dt * 0.9);
    const k = fly.t < 0.5 ? 2 * fly.t * fly.t : 1 - (-2 * fly.t + 2) ** 2 / 2;
    const len = Math.exp(THREE.MathUtils.lerp(Math.log(fly.from.length() - 1), Math.log(fly.to.length() - 1), k)) + 1;
    camera.position.copy(fly.from.clone().normalize().lerp(fly.to.clone().normalize(), k).normalize().multiplyScalar(len));
    if (fly.t >= 1) { fly = null; refreshTiles(false); }
  }
  controls.update();
  sun.position.copy(camera.position).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.6).add(new THREE.Vector3(0, 1.5, 0));
  for (const s of orbiters) {
    const u = s.userData;
    if (u.live && u.track?.length > 1) {
      const T = u.track, span = T.at(-1).t - T[0].t;
      const t = T[0].t + ((((simT - T[0].t) % span) + span) % span);
      let i = T.findIndex((p) => p.t > t);
      if (i < 1) i = 1;
      const a = T[i - 1], b = T[i], f = (t - a.t) / (b.t - a.t || 1);
      s.position.copy(a.v).lerp(b.v, f);
      u.cur = { lat: a.lat + (b.lat - a.lat) * f, lon: Math.abs(b.lon - a.lon) > 180 ? b.lon : a.lon + (b.lon - a.lon) * f, alt: a.alt + (b.alt - a.alt) * f };
    } else if (u.ell) {
      const E = u.ell;
      E.nu += dt * E.speed * (1 + E.e * Math.cos(E.nu)) ** 2;
      const r = (E.a * (1 - E.e * E.e)) / (1 + E.e * Math.cos(E.nu));
      s.position.set(r * Math.cos(E.nu), 0, r * Math.sin(E.nu)).applyQuaternion(E.q);
    }
    s.rotation.y += dt;
  }
  // a surface point p is in view when it is above the horizon as seen from the camera: p·cam > |p|²
  const C = camera.position, camLen = C.length(), ms = THREE.MathUtils.clamp((camLen - 1) / 2.4, 0.004, 1);
  const above = (p, margin = 0) => p.dot(C) > p.lengthSq() * (1 + margin);
  for (const l of labels) l.visible = above(l.getWorldPosition(tmp), camLen > 1.6 ? 0.08 : 0);
  for (const m of markers) {
    if (m.userData.kind === "orbiter") { m.scale.setScalar(Math.max(ms, 0.06)); continue; }
    m.scale.setScalar(ms);
    m.visible = above(m.position);
  }
  for (const r of routes) r.visible = above(r.userData.anchor);
  for (const s of orbiters) {
    s.getWorldPosition(tmp);
    const toSat = tmp.clone().sub(camera.position), d = toSat.length();
    toSat.normalize();
    const tc = -camera.position.dot(toSat), closest = camera.position.clone().addScaledVector(toSat, tc).length();
    s.userData.lab.visible = !(tc > 0 && tc < d && closest < 1);
  }
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(frame);
}
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
});

MISSIONS = await fetch(`data/missions.json?v=${VER}`).then((r) => r.json());
await loadBody(new URLSearchParams(location.search).get("body") === "mars" ? "mars" : "moon");
frame();
