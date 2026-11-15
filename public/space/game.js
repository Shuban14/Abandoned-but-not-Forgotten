// Launch Lab — build a rocket in 3D, pick a real launch site on a 3D Earth, launch it with a real mission timeline,
// and fly on to the real Moon or Mars (NASA imagery + elevation).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { Sky } from "three/addons/objects/Sky.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { PARTS, SITES, SAMPLES, TARGETS, analyse, outcome, siteBonus } from "./sim.js?v=2";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp, D2R = Math.PI / 180;
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const rnd = (a = 1) => (Math.random() * 2 - 1) * a;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const SPEEDUP = () => window.__llSpeed || 1; // test-only fast-forward

// ================================================================ renderer + post-processing
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$("#stage").appendChild(renderer.domElement);
const labels = new CSS2DRenderer();
labels.setSize(innerWidth, innerHeight);
Object.assign(labels.domElement.style, { position: "absolute", top: 0, pointerEvents: "none" });
$("#stage").appendChild(labels.domElement);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 5e7);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(new THREE.Scene(), camera);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.45, 0.82);
composer.addPass(renderPass);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const pmrem = new THREE.PMREMGenerator(renderer);

// ================================================================ textures
const TL = new THREE.TextureLoader();
const tex = (url, srgb = true) => { const t = TL.load(url); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
const T = {
  earth: tex("textures/earth.jpg"), night: tex("textures/earth-night.jpg"), clouds: tex("textures/earth-clouds.jpg", false),
  spec: tex("textures/earth-spec.jpg", false), moon: tex("textures/moon.jpg"), mars: tex("textures/mars.jpg"),
};
function canvasTex(w, h, draw, repeat, srgb = true) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  t.anisotropy = 8;
  return t;
}
const noise = (g, w, h, n, a) => { for (let i = 0; i < n; i++) { const v = Math.random() > 0.5 ? 255 : 0; g.fillStyle = `rgba(${v},${v},${v},${a})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); } };
const tankTex = canvasTex(1024, 512, (g, w, h) => {
  g.fillStyle = "#eef0f3"; g.fillRect(0, 0, w, h);
  noise(g, w, h, 30000, 0.035);
  g.fillStyle = "rgba(0,0,0,.08)"; for (let x = 0; x < w; x += 64) g.fillRect(x, 0, 1.5, h); for (let y = 0; y < h; y += 128) g.fillRect(0, y, w, 1.5);
  g.fillStyle = "#c8461b"; g.fillRect(0, 26, w, 10); g.fillRect(0, h - 36, w, 10);
  g.fillStyle = "#1f2735"; g.fillRect(w * 0.12, 60, 42, h - 120); g.fillRect(w * 0.62, 60, 42, h - 120);
  g.save(); g.translate(w * 0.37, h / 2); g.rotate(-Math.PI / 2); g.fillStyle = "#1f2735"; g.font = "bold 46px Inter, Arial"; g.textAlign = "center"; g.fillText("LAUNCH LAB", 0, 16); g.restore();
  g.fillStyle = "rgba(60,40,20,.10)"; for (let i = 0; i < 40; i++) { const x = Math.random() * w; g.fillRect(x, h * 0.75, 3, h * 0.25 * Math.random()); } // soot near the bottom
});
const roughTex = canvasTex(512, 256, (g, w, h) => { g.fillStyle = "#777"; g.fillRect(0, 0, w, h); noise(g, w, h, 20000, 0.18); }, null, false);
const bellTex = canvasTex(64, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#3a2d22"); gr.addColorStop(0.35, "#6b4a2a"); gr.addColorStop(0.7, "#2c2f36"); gr.addColorStop(1, "#16181c"); g.fillStyle = gr; g.fillRect(0, 0, w, h); noise(g, w, h, 3000, 0.08); });
const bellVTex = canvasTex(64, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#5a4632"); gr.addColorStop(0.3, "#c08a3e"); gr.addColorStop(0.75, "#4a6a9a"); gr.addColorStop(1, "#2a2f3a"); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
const stripeTex = canvasTex(128, 32, (g, w, h) => { g.fillStyle = "#111318"; g.fillRect(0, 0, w, h); noise(g, w, h, 1500, 0.06); g.fillStyle = "#e0b100"; g.fillRect(0, 2, w, 3); g.fillRect(0, h - 5, w, 3); }, [8, 1]);
const foilTex = canvasTex(256, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, "#f7d06b"); gr.addColorStop(0.5, "#a8790b"); gr.addColorStop(1, "#ffe08a");
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 400; i++) { g.strokeStyle = `rgba(${Math.random() > 0.5 ? "255,240,180" : "90,60,0"},.35)`; g.beginPath(); const x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); g.lineTo(x + rnd(24), y + rnd(24)); g.stroke(); }
});
const panelTex = canvasTex(256, 128, (g, w, h) => { g.fillStyle = "#0c1f4f"; g.fillRect(0, 0, w, h); g.strokeStyle = "#7ea6ff"; g.lineWidth = 1.5; for (let i = 0; i <= w; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); } for (let i = 0; i <= h; i += 16) { g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } });
const floorTex = canvasTex(1024, 1024, (g, w, h) => { g.fillStyle = "#1b1f27"; g.fillRect(0, 0, w, h); noise(g, w, h, 40000, 0.05); g.strokeStyle = "rgba(255,255,255,.06)"; g.lineWidth = 2; for (let i = 0; i <= w; i += 128) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } g.strokeStyle = "rgba(255,200,0,.35)"; g.lineWidth = 6; g.beginPath(); g.arc(w / 2, h / 2, 300, 0, 7); g.stroke(); }, [4, 4]);
const concreteTex = canvasTex(512, 512, (g, w, h) => { g.fillStyle = "#9a9ca0"; g.fillRect(0, 0, w, h); noise(g, w, h, 30000, 0.06); g.strokeStyle = "rgba(0,0,0,.25)"; g.lineWidth = 2; for (let i = 0; i <= w; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } }, [3, 3]);
const glowTex = canvasTex(64, 64, (g, w, h) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.3, "rgba(255,255,255,.6)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
const puffTex = canvasTex(128, 128, (g, w, h) => { for (let i = 0; i < 26; i++) { const x = 64 + rnd(26), y = 64 + rnd(26), r = 14 + Math.random() * 26; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, "rgba(255,255,255,.35)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); } });
const grassTex = canvasTex(512, 512, (g, w, h) => { const gr = g.createRadialGradient(256, 256, 30, 256, 256, 256); gr.addColorStop(0, "rgba(120,124,104,1)"); gr.addColorStop(0.45, "rgba(98,112,64,1)"); gr.addColorStop(1, "rgba(98,112,64,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); for (let i = 0; i < 20000; i++) { const x = Math.random() * w, y = Math.random() * h, d = Math.hypot(x - 256, y - 256) / 256; if (d > 1) continue; g.fillStyle = `rgba(${40 + Math.random() * 50},${60 + Math.random() * 50},${20 + Math.random() * 30},${0.25 * (1 - d)})`; g.fillRect(x, y, 2, 2); } });

// ================================================================ materials (physically based, reflect the environment)
const M = {
  paint: new THREE.MeshPhysicalMaterial({ map: tankTex, roughnessMap: roughTex, roughness: 0.42, metalness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.25 }),
  white: new THREE.MeshPhysicalMaterial({ color: 0xf1f3f6, roughnessMap: roughTex, roughness: 0.38, metalness: 0.05, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
  red: new THREE.MeshStandardMaterial({ color: 0xc9341e, roughness: 0.45 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x23272f, roughness: 0.5, metalness: 0.7 }),
  carbon: new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.55, metalness: 0.3 }),
  bell: new THREE.MeshStandardMaterial({ map: bellTex, roughness: 0.3, metalness: 0.95, side: THREE.DoubleSide }),
  bellV: new THREE.MeshStandardMaterial({ map: bellVTex, roughness: 0.22, metalness: 1, side: THREE.DoubleSide }),
  foil: new THREE.MeshStandardMaterial({ map: foilTex, roughness: 0.25, metalness: 1 }),
  panel: new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.2, metalness: 0.8 }),
  silver: new THREE.MeshStandardMaterial({ color: 0xd2d6de, roughness: 0.18, metalness: 1 }),
  fin: new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.45, metalness: 0.4 }),
};

// ================================================================ 3D parts (radius 1 ≈ 2.5 m, origin at the part's bottom)
function bellGeo(top, bot, h) {
  const pts = [];
  for (let i = 0; i <= 20; i++) { const k = i / 20; pts.push(new THREE.Vector2(lerp(bot, top, Math.pow(k, 0.5)), k * h)); }
  return new THREE.LatheGeometry(pts, 48);
}
function partMesh(item) {
  const d = PARTS[item.id], g = new THREE.Group(), h = d.h;
  const add = (geo, mat, y = 0, x = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  switch (d.kind) {
    case "nose": {
      const pts = [];
      for (let i = 0; i <= 32; i++) { const k = i / 32; pts.push(new THREE.Vector2(Math.max(0.001, Math.cos((k * Math.PI) / 2) ** 0.75), k * h)); }
      const a = add(new THREE.LatheGeometry(pts, 48, 0, Math.PI), M.white), b = add(new THREE.LatheGeometry(pts, 48, Math.PI, Math.PI), M.white);
      a.userData.half = 1; b.userData.half = -1;
      add(new THREE.CylinderGeometry(1.005, 1.005, 0.06, 48), M.dark, 0.03);
      break;
    }
    case "payload": {
      add(new THREE.CylinderGeometry(1, 1, 0.14, 48), M.carbon, 0.07);
      if (item.id === "cubesat") { add(new THREE.CylinderGeometry(0.5, 0.75, 0.3, 32), M.silver, 0.29); add(new THREE.BoxGeometry(0.5, 0.45, 0.5), M.foil, 0.67); }
      else if (item.id === "commsat") { add(new THREE.BoxGeometry(1.2, 1.1, 1.2), M.foil, 0.7); const dish = add(new THREE.SphereGeometry(0.45, 32, 12, 0, Math.PI * 2, 0, Math.PI / 3), M.white, 1.25); dish.rotation.x = Math.PI; }
      else {
        const marsy = item.id === "marsprobe";
        add(new THREE.CylinderGeometry(0.75, 0.75, 0.9, 32), marsy ? M.foil : M.silver, 0.6);
        add(new THREE.SphereGeometry(marsy ? 0.42 : 0.25, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), marsy ? M.white : M.foil, 1.05);
        if (!marsy) for (let i = 0; i < 3; i++) { const l = add(new THREE.CylinderGeometry(0.04, 0.04, 0.8, 6), M.dark, 0.35, Math.cos(i * 2.09) * 0.8, Math.sin(i * 2.09) * 0.8); l.rotation.z = Math.cos(i * 2.09) * 0.4; l.rotation.x = -Math.sin(i * 2.09) * 0.4; }
      }
      break;
    }
    case "solar": {
      add(new THREE.CylinderGeometry(0.95, 0.95, h, 48), M.dark, h / 2);
      for (let i = 0; i < 8; i++) { const p = add(new THREE.BoxGeometry(0.6, h * 0.8, 0.04), M.panel, h / 2, Math.cos((i * Math.PI) / 4) * 0.98, Math.sin((i * Math.PI) / 4) * 0.98); p.rotation.y = -(i * Math.PI) / 4 + Math.PI / 2; }
      break;
    }
    case "tank": {
      const t = add(new THREE.CylinderGeometry(1, 1, h, 64, 1, false), M.paint, h / 2);
      t.material = M.paint.clone(); t.material.map = tankTex.clone(); t.material.map.needsUpdate = true; t.material.map.repeat.set(1, h / 3);
      add(new THREE.CylinderGeometry(1.012, 1.012, 0.08, 64), M.dark, 0.04);
      add(new THREE.CylinderGeometry(1.012, 1.012, 0.08, 64), M.dark, h - 0.04);
      break;
    }
    case "engine": {
      const n = item.n || 1, vac = item.id === "engineV";
      add(new THREE.CylinderGeometry(1, 0.92, 0.45, 48), M.carbon, h - 0.22);
      const pos = n === 1 ? [[0, 0]] : n === 2 ? [[-0.48, 0], [0.48, 0]] : [[0, 0.55], [-0.5, -0.3], [0.5, -0.3]];
      const r = n === 1 ? (vac ? 0.75 : 0.82) : 0.46;
      g.userData.nozzles = [];
      pos.forEach(([x, z]) => {
        add(new THREE.CylinderGeometry(r * 0.32, r * 0.4, 0.32, 24), M.dark, h - 0.6, x, z);
        add(bellGeo(r * 0.38, r, h - 0.65), vac ? M.bellV : M.bell, 0, x, z);
        g.userData.nozzles.push(V(x, 0, z));
      });
      g.userData.nozzleR = r;
      break;
    }
    case "decoupler": add(new THREE.CylinderGeometry(1.02, 1.02, h, 64), M.carbon, h / 2); break;
    case "fins": {
      add(new THREE.CylinderGeometry(1, 1.05, h, 48), M.white, h / 2);
      const s = new THREE.Shape();
      s.moveTo(0, 0); s.lineTo(1.1, -0.35); s.lineTo(1.1, 0.35); s.lineTo(0, h * 1.25); s.lineTo(0, 0);
      const geo = new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
      for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(geo, M.fin); f.castShadow = true; f.position.y = 0.05; const a = (i * Math.PI) / 2 + Math.PI / 4; f.position.x = Math.cos(a) * 0.98; f.position.z = Math.sin(a) * 0.98; f.rotation.y = -a; g.add(f); }
      break;
    }
  }
  g.userData.h = h;
  g.userData.item = item;
  return g;
}
function rocketMesh(stack) {
  const grp = new THREE.Group(), parts = [];
  let y = 0;
  for (let i = stack.length - 1; i >= 0; i--) {
    const m = partMesh(stack[i]);
    m.position.y = y;
    m.userData.index = i;
    y += m.userData.h;
    grp.add(m);
    parts.push(m);
  }
  grp.userData.height = y;
  grp.userData.parts = parts;
  return grp;
}
function partIcon(id) {
  const k = PARTS[id].kind, c = { nose: "#f2f4f7", payload: "#e6b23c", solar: "#3b6fe0", tank: "#f2f4f7", engine: "#4a5160", decoupler: "#ffcc00", fins: "#1c2433" }[k];
  const shapes = {
    nose: `<path d="M15 3 C 22 10 24 18 24 27 H6 C6 18 8 10 15 3Z" fill="${c}"/>`,
    payload: id === "commsat" ? `<rect x="8" y="9" width="14" height="14" fill="${c}"/><path d="M10 9 q5 -7 10 0" fill="#fff"/>` : id === "moonprobe" ? `<rect x="9" y="8" width="12" height="12" rx="3" fill="#c9ced8"/><path d="M10 20 l-4 7 M20 20 l4 7 M15 20 v7" stroke="#2a2f3a" stroke-width="2"/>` : id === "marsprobe" ? `<rect x="9" y="10" width="12" height="12" rx="2" fill="${c}"/><path d="M8 10 q7 -9 14 0z" fill="#fff"/><circle cx="25" cy="7" r="3" fill="#c1440e"/>` : `<rect x="11" y="10" width="8" height="8" fill="${c}"/><rect x="9" y="19" width="12" height="4" fill="#c9ced8"/>`,
    solar: `<rect x="5" y="11" width="20" height="8" fill="#2a2f3a"/><path d="M6 12h4v6H6zM11 12h4v6h-4zM16 12h4v6h-4zM21 12h3v6h-3z" fill="${c}"/>`,
    tank: `<rect x="7" y="${id === "tankS" ? 10 : id === "tankL" ? 6 : 2}" width="16" height="${id === "tankS" ? 10 : id === "tankL" ? 18 : 26}" rx="2" fill="${c}" stroke="#e05a1e" stroke-width="1.5"/>`,
    engine: `<rect x="8" y="5" width="14" height="5" fill="#2a2f3a"/><path d="M12 10 h6 l${id === "engineV" ? "5 17 h-16" : "4 15 h-14"}z" fill="${id === "engineV" ? "#a8742c" : "#5a6070"}"/>`,
    decoupler: `<rect x="5" y="12" width="20" height="6" fill="#151515"/><path d="M5 13h20M5 17h20" stroke="${c}" stroke-width="1.2"/>`,
    fins: `<rect x="11" y="6" width="8" height="18" fill="#f2f4f7"/><path d="M11 10 L4 24 H11Z M19 10 L26 24 H19Z" fill="${c}"/>`,
  };
  return `<svg viewBox="0 0 30 30">${shapes[k]}</svg>`;
}

// ================================================================ particles (fire, smoke, sparks)
class Particles {
  constructor(max, additive, map = glowTex) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3); this.c0 = new Float32Array(max * 3); this.c1 = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.alpha = new Float32Array(max); this.a0 = new Float32Array(max); this.rot = new Float32Array(max);
    this.life = new Float32Array(max); this.ttl = new Float32Array(max); this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    g.setAttribute("size", new THREE.BufferAttribute(this.size, 1));
    g.setAttribute("alpha", new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute("rot", new THREE.BufferAttribute(this.rot, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, scale: { value: innerHeight / 2 } },
      vertexShader: `attribute float size; attribute float alpha; attribute float rot; varying vec3 vC; varying float vA; varying float vR; uniform float scale;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main(){ vC=color; vA=alpha; vR=rot; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=min(size*scale/max(0.001,-mv.z), 900.); gl_Position=projectionMatrix*mv;
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA; varying float vR;
        #include <logdepthbuf_pars_fragment>
        void main(){
        #include <logdepthbuf_fragment>
        vec2 p=gl_PointCoord-.5; float c=cos(vR), s=sin(vR); p=vec2(c*p.x-s*p.y, s*p.x+c*p.y)+.5;
        vec4 t=texture2D(map,p); gl_FragColor=vec4(vC,t.a*vA); }`,
      vertexColors: true, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
  }
  emit(p, v, ttl, s0, s1, c0, c1, drag = 0.5, grav = 0, a0 = 1) {
    const i = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max);
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3);
    this.c0.set(c0, i * 3); this.c1.set(c1, i * 3);
    this.s0[i] = s0; this.s1[i] = s1; this.life[i] = 0; this.ttl[i] = ttl; this.drag[i] = drag; this.grav[i] = grav; this.a0[i] = a0; this.rot[i] = Math.random() * 6.28;
  }
  update(dt) {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.ttl[i]) continue;
      if (w !== i) {
        for (const a of [this.pos, this.vel, this.c0, this.c1]) a.copyWithin(w * 3, i * 3, i * 3 + 3);
        for (const a of [this.s0, this.s1, this.life, this.ttl, this.drag, this.grav, this.a0, this.rot]) a[w] = a[i];
      }
      const k = this.life[w] / this.ttl[w], dr = Math.exp(-this.drag[w] * dt);
      for (let j = 0; j < 3; j++) { this.vel[w * 3 + j] *= dr; this.pos[w * 3 + j] += this.vel[w * 3 + j] * dt; }
      this.vel[w * 3 + 1] -= this.grav[w] * dt;
      for (let j = 0; j < 3; j++) this.col[w * 3 + j] = lerp(this.c0[w * 3 + j], this.c1[w * 3 + j], k);
      this.size[w] = lerp(this.s0[w], this.s1[w], Math.sqrt(k));
      this.alpha[w] = this.a0[w] * (k < 0.08 ? k / 0.08 : 1 - (k - 0.08) / 0.92);
      this.rot[w] += dt * 0.3;
      w++;
    }
    this.n = w;
    for (const a of ["position", "color", "size", "alpha", "rot"]) this.points.geometry.attributes[a].needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.n);
  }
  clear() { this.n = 0; this.points.geometry.setDrawRange(0, 0); }
}

// ================================================================ realistic Earth (day/night, oceans, clouds, haze)
function earthMaterial(day, opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: day }, nightMap: { value: T.night }, specMap: { value: T.spec },
      sunDir: { value: V(1, 0.4, 0.6).normalize() }, useNight: { value: opts.night === false ? 0 : 1 },
      hazeColor: { value: new THREE.Color(0x9cc5ee) }, hazeDensity: { value: 0 }, edgeFade: { value: opts.edgeFade ? 1 : 0 },
    },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main(){ vUv=uv; vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w;
      #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `uniform sampler2D dayMap, nightMap, specMap; uniform vec3 sunDir, hazeColor; uniform float useNight, hazeDensity, edgeFade;
      varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      #include <logdepthbuf_pars_fragment>
      void main(){
      #include <logdepthbuf_fragment>
        vec3 N=normalize(vN), Vd=normalize(cameraPosition-vW), L=normalize(sunDir);
        float nl=dot(N,L);
        vec3 day=texture2D(dayMap,vUv).rgb;
        float sea=useNight>0.5 ? texture2D(specMap,vUv).r : smoothstep(.05,.25,day.b-day.r);
        vec3 col=day*(max(nl,0.)*1.25+0.04);
        vec3 H=normalize(L+Vd); col+=vec3(1.,.95,.85)*pow(max(dot(N,H),0.),60.)*sea*0.6*step(0.,nl);
        if(useNight>0.5){ vec3 nightC=texture2D(nightMap,vUv).rgb; col+=nightC*vec3(1.,.82,.55)*1.4*(1.-smoothstep(-.18,.08,nl)); }
        float rim=pow(1.-max(dot(N,Vd),0.),3.); col=mix(col, vec3(.35,.6,1.)*max(nl+.3,0.), rim*.55);
        float dist=length(cameraPosition-vW); col=mix(col, hazeColor, 1.-exp(-dist*hazeDensity));
        float a=1.; if(edgeFade>0.5){ vec2 e=min(vUv,1.-vUv); a=smoothstep(0.,.08,min(e.x,e.y)); }
        gl_FragColor=vec4(col,a);
      }`,
    transparent: !!opts.edgeFade,
  });
}
function atmosphere(r, color = 0x4fa8ff, power = 3, strength = 1.1) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 96, 48), new THREE.ShaderMaterial({
    uniforms: { c: { value: new THREE.Color(color) }, p: { value: power }, s: { value: strength }, sunDir: { value: V(1, 0.4, 0.6).normalize() } },
    vertexShader: `varying vec3 vN; varying vec3 vW;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main(){ vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w;
      #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `uniform vec3 c, sunDir; uniform float p, s; varying vec3 vN; varying vec3 vW;
      #include <logdepthbuf_pars_fragment>
      void main(){
      #include <logdepthbuf_fragment>
      vec3 Vd=normalize(cameraPosition-vW); float f=pow(1.-abs(dot(normalize(vN),Vd)),p); float lit=clamp(dot(normalize(vN),normalize(sunDir))+.45,0.,1.); gl_FragColor=vec4(c*lit,f*s); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
  }));
}
function dirLL(lat, lon) {
  const u = (lon + 180) / 360, v = (lat + 90) / 180, phi = u * Math.PI * 2, th = (1 - v) * Math.PI;
  return V(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th));
}
function starField(n, r, size = 1.6) {
  const g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    p.set(V(rnd(), rnd(), rnd()).normalize().multiplyScalar(r).toArray(), i * 3);
    const t = Math.random(); c.set(t < 0.15 ? [1, 0.85, 0.7] : t < 0.3 ? [0.75, 0.85, 1] : [1, 1, 1], i * 3);
  }
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  const s = new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, transparent: true, opacity: 0.9, vertexColors: true, depthWrite: false }));
  s.frustumCulled = false;
  return s;
}
function earthGlobe(R) {
  const g = new THREE.Group();
  const ground = new THREE.Mesh(new THREE.SphereGeometry(R, 192, 96), earthMaterial(T.earth));
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(R * 1.006, 160, 80), new THREE.MeshStandardMaterial({ color: 0xffffff, alphaMap: T.clouds, transparent: true, depthWrite: false, roughness: 1, opacity: 0.95 }));
  const atmo = atmosphere(R * 1.045);
  g.add(ground, clouds, atmo);
  g.userData = { ground, clouds, atmo };
  return g;
}
// Moon / Mars with real NASA imagery and displaced terrain (same data as Planet Explorer)
const bodyCache = {};
async function bodyGlobe(name, R) {
  if (!bodyCache[name]) bodyCache[name] = fetch(`data/${name}-elev.bin`).then((r) => r.arrayBuffer()).then((b) => new Int16Array(b));
  const E = await bodyCache[name], radiusKm = name === "moon" ? 1737.4 : 3389.5, ex = name === "moon" ? 8 : 6, W = 1440, H = 720;
  const geo = new THREE.SphereGeometry(1, 720, 360), pos = geo.attributes.position, uv = geo.attributes.uv, v = V();
  for (let i = 0; i < pos.count; i++) {
    const x = Math.min(W - 1, Math.floor(uv.getX(i) * W)), y = Math.min(H - 1, Math.floor((1 - uv.getY(i)) * H));
    v.fromBufferAttribute(pos, i).multiplyScalar(R * (1 + (ex * E[y * W + x]) / 1000 / radiusKm));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const map = name === "moon" ? T.moon : T.mars;
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, bumpMap: map, bumpScale: 1.2, roughness: 1, metalness: 0 }));
  const g = new THREE.Group();
  g.add(mesh);
  if (name === "mars") g.add(atmosphere(R * 1.03, 0xd9875a, 4, 0.7));
  return g;
}

// ================================================================ state
let mode = "build", stack = [], selected = -1, site = SITES[0], audioOn = true;
try { stack = JSON.parse(localStorage.getItem("ll-stack") || "[]").filter((x) => PARTS[x.id]); } catch {}
const save = () => { try { localStorage.setItem("ll-stack", JSON.stringify(stack)); } catch {} };

// ================================================================ BUILD SCENE (hangar)
const build = new THREE.Scene();
build.background = new THREE.Color(0x0b0f17);
build.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
build.environmentIntensity = 0.45;
build.fog = new THREE.Fog(0x0b0f17, 70, 180);
build.add(new THREE.HemisphereLight(0xbfd4ff, 0x1a1408, 0.35));
const key = new THREE.SpotLight(0xfff4e6, 650, 120, 0.5, 0.6, 1.6);
key.position.set(16, 40, 22); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0002;
build.add(key, key.target);
const rim = new THREE.SpotLight(0xff8a3d, 420, 100, 0.6, 0.8, 1.6); rim.position.set(-22, 18, -16); build.add(rim, rim.target);
const fill = new THREE.SpotLight(0x6ea8ff, 220, 100, 0.7, 0.9, 1.6); fill.position.set(-14, 6, 24); build.add(fill, fill.target);
const floor = new THREE.Mesh(new THREE.CircleGeometry(140, 96), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55, metalness: 0.3 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; build.add(floor);
const padMat = new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.95 });
const pad = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 0.8, 64), padMat);
pad.position.y = 0.4; pad.receiveShadow = pad.castShadow = true; build.add(pad);
const towerMat = new THREE.MeshStandardMaterial({ color: 0xb7352a, roughness: 0.55, metalness: 0.5 });
function tower(scene, x, h) {
  const t = new THREE.Group();
  const leg = new THREE.BoxGeometry(0.18, h, 0.18), bar = new THREE.BoxGeometry(1.8, 0.1, 0.1), diag = new THREE.BoxGeometry(2.3, 0.07, 0.07);
  for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) { const p = new THREE.Mesh(leg, towerMat); p.position.set(dx, h / 2, dz); p.castShadow = true; t.add(p); }
  for (let y = 1.4; y < h; y += 1.6) for (let s = 0; s < 4; s++) {
    const a = (s * Math.PI) / 2, b = new THREE.Mesh(bar, towerMat), dg = new THREE.Mesh(diag, towerMat);
    b.position.set(Math.sin(a) * 0.8, y, Math.cos(a) * 0.8); b.rotation.y = a + Math.PI / 2;
    dg.position.set(Math.sin(a) * 0.8, y + 0.8, Math.cos(a) * 0.8); dg.rotation.y = a + Math.PI / 2; dg.rotation.z = 0.72;
    b.castShadow = dg.castShadow = true; t.add(b, dg);
  }
  const arm = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.3, 0.6), towerMat); arm.position.set(2.5, h * 0.82, 0); t.add(arm);
  t.position.x = x;
  scene.add(t);
  return t;
}
tower(build, -5.8, 34);
let buildRocket = null;
const ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.06, 8, 48), new THREE.MeshBasicMaterial({ color: 0xffb347 }));
ring.rotation.x = Math.PI / 2; ring.visible = false; build.add(ring);

function rebuildRocket() {
  if (buildRocket) build.remove(buildRocket);
  buildRocket = rocketMesh(stack);
  buildRocket.position.y = 0.8;
  build.add(buildRocket);
  highlight();
  const h = buildRocket.userData.height;
  key.target.position.set(0, h / 2, 0); rim.target.position.copy(key.target.position); fill.target.position.copy(key.target.position);
  if (mode === "build") {
    controls.target.set(0, 0.8 + Math.max(h, 6) / 2, 0);
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, Math.max(16, h * 1.7 + 8));
  }
}
const selCache = new Map();
function selMat(m) { if (!selCache.has(m)) { const c = m.clone(); c.emissive = new THREE.Color(0xff7a2f); c.emissiveIntensity = 0.35; selCache.set(m, c); } return selCache.get(m); }
function highlight() {
  if (!buildRocket) return;
  buildRocket.userData.parts.forEach((p) => p.traverse((o) => { if (o.isMesh) { if (!o.userData.mat0) o.userData.mat0 = o.material; o.material = p.userData.index === selected ? selMat(o.userData.mat0) : o.userData.mat0; } }));
}

// ---------------- build UI
const ORDER = ["nose", "cubesat", "commsat", "moonprobe", "marsprobe", "solar", "tankS", "tankL", "tankXL", "engineV", "engineB", "decoupler", "fins"];
$("#parts").innerHTML = ORDER.map((id) => {
  const d = PARTS[id];
  const stat = d.kind === "engine" ? `${d.thrustSL.toLocaleString()} kN on ground · ${d.thrustVac.toLocaleString()} kN in space` : d.fuel ? `${d.fuel} t fuel + ${d.mass} t tank` : `${d.mass} t`;
  return `<button class="part" draggable="true" data-id="${id}"><span class="ic">${partIcon(id)}</span><span><b>${d.name}</b><small>${esc(d.desc)}<br>${stat}</small></span></button>`;
}).join("");
$("#parts").addEventListener("click", (e) => { const b = e.target.closest(".part"); if (b) insert(b.dataset.id, 0); });
$("#parts").addEventListener("dragstart", (e) => { const b = e.target.closest(".part"); if (b) e.dataTransfer.setData("text/plain", b.dataset.id); });
function insert(id, at) {
  stack.splice(at, 0, { id, ...(PARTS[id].kind === "engine" ? { n: 1 } : {}) });
  selected = at;
  changed();
  sfx.click();
}
function changed() { save(); rebuildRocket(); renderStack(); renderStats(); $("#hinttext").hidden = true; }
function renderStack() {
  const el = $("#stack");
  if (!stack.length) { el.innerHTML = `<li class="empty">Empty. Start from the bottom: fins, then an engine, then fuel…</li>`; return; }
  el.innerHTML = stack.map((x, i) => {
    const d = PARTS[x.id];
    return `<li class="${i === selected ? "sel" : ""} ${d.kind === "decoupler" ? "sep" : ""}" data-i="${i}"><span class="nm">${esc(d.name)}</span>${d.kind === "engine" ? `<button class="n" data-a="n" title="Number of engines">×${x.n || 1}</button>` : ""}<button data-a="up" title="Move up">▲</button><button data-a="down" title="Move down">▼</button><button data-a="del" title="Remove">✕</button></li>`;
  }).join("");
}
$("#stack").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-i]");
  if (!li) return;
  const i = +li.dataset.i, a = e.target.dataset.a;
  if (a === "del") { stack.splice(i, 1); selected = -1; }
  else if (a === "up" && i > 0) { [stack[i - 1], stack[i]] = [stack[i], stack[i - 1]]; selected = i - 1; }
  else if (a === "down" && i < stack.length - 1) { [stack[i + 1], stack[i]] = [stack[i], stack[i + 1]]; selected = i + 1; }
  else if (a === "n") { stack[i].n = ((stack[i].n || 1) % 3) + 1; selected = i; }
  else selected = i === selected ? -1 : i;
  changed();
});
addEventListener("keydown", (e) => {
  if (mode !== "build" || selected < 0 || e.target.tagName === "INPUT") return;
  if (e.key === "Delete" || e.key === "Backspace") { stack.splice(selected, 1); selected = -1; changed(); }
});
function renderStats() {
  const a = analyse(stack, site), t = TARGETS[a.target];
  const height = stack.reduce((s, x) => s + PARTS[x.id].h, 0) * 2.5;
  $("#mission").innerHTML = a.payloads.length ? `Mission: <b>${t.name}</b> · needs a speed budget of about <b>${(t.dv / 1000).toFixed(1)} km/s</b>` : `Add a <b>payload</b> to choose the mission (satellite → Earth orbit, probes → Moon or Mars).`;
  const pct = clamp(((a.dv + a.bonus) / a.need) * 100, 0, 140);
  $("#kpis").innerHTML = `
    <div class="kpi"><small>Height</small><b>${height.toFixed(0)} m</b></div>
    <div class="kpi"><small>Weight</small><b>${a.total.toFixed(1)} t</b></div>
    <div class="kpi"><small>Lift-off push ÷ weight</small><b style="color:${a.twr >= 1.15 ? "var(--ok)" : a.twr >= 1 ? "var(--accent2)" : "var(--bad)"}">${a.twr.toFixed(2)}×</b></div>
    <div class="kpi"><small>Stages</small><b>${a.stages.length}</b></div>
    <div class="kpi wide"><small>Speed budget, Δv (incl. Earth's spin at ${esc(site.place.split(",")[0])})</small><b>${((a.dv + a.bonus) / 1000).toFixed(2)} km/s</b><div class="bar"><i style="width:${(pct / 140) * 100}%"></i><em style="left:${(100 / 140) * 100}%"></em></div><small style="margin-top:6px">About 1.5 km/s of it is lost to gravity and air on the way up, so the actual speed in orbit is 7.8 km/s.</small></div>`;
  $("#toSite").disabled = !stack.length;
}
$("#clear").onclick = () => { stack = []; selected = -1; changed(); };
$("#sample").onclick = () => ($("#samples").hidden = !$("#samples").hidden);
$("#samples").onclick = (e) => { const s = e.target.dataset.s; if (!s) return; stack = SAMPLES[s].map((x) => ({ ...x })); selected = -1; $("#samples").hidden = true; changed(); toast(s === "broken" ? "This rocket has mistakes. Launch it to find out, or fix it first!" : "Sample loaded"); };
$("#hint").onclick = () => {
  const o = outcome(stack, site), el = $("#hinttext");
  el.hidden = false;
  el.innerHTML = o.ok ? "Looks good to me. Choose a launch site and launch! 🚀" : `💡 ${esc(o.fail.fix)}`;
  if (!o.ok && o.fail.part) flashPart(o.fail.part);
};
function flashPart(id) { const b = $(`.part[data-id="${id}"]`); if (b) { b.classList.remove("flash"); void b.offsetWidth; b.classList.add("flash"); b.scrollIntoView({ block: "nearest", behavior: "smooth" }); } }
function insertIndexAt(clientY) {
  if (!buildRocket || !stack.length) return 0;
  const ys = [];
  let y = 0.8;
  for (let i = stack.length - 1; i >= -1; i--) { ys.push({ idx: i + 1, y: V(0, y, 0).project(camera) }); if (i >= 0) y += PARTS[stack[i].id].h; }
  let best = ys[0], bd = Infinity;
  for (const b of ys) { const sy = ((1 - b.y.y) / 2) * innerHeight, d = Math.abs(sy - clientY); if (d < bd) { bd = d; best = b; } }
  return best.idx;
}
renderer.domElement.addEventListener("dragover", (e) => {
  if (mode !== "build") return;
  e.preventDefault();
  const idx = insertIndexAt(e.clientY);
  let y = 0.8;
  for (let i = stack.length - 1; i >= idx; i--) y += PARTS[stack[i].id].h;
  ring.position.y = y; ring.visible = true;
});
renderer.domElement.addEventListener("dragleave", () => (ring.visible = false));
renderer.domElement.addEventListener("drop", (e) => { e.preventDefault(); ring.visible = false; const id = e.dataTransfer.getData("text/plain"); if (PARTS[id]) insert(id, insertIndexAt(e.clientY)); });
const ray = new THREE.Raycaster();
let downAt = null;
renderer.domElement.addEventListener("pointerdown", (e) => (downAt = [e.clientX, e.clientY]));
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  ray.setFromCamera(V((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1, 0), camera);
  if (mode === "build" && buildRocket) {
    let o = ray.intersectObjects(buildRocket.userData.parts, true)[0]?.object;
    while (o && o.userData.index === undefined) o = o.parent;
    selected = o ? o.userData.index : -1;
    renderStack(); highlight();
  } else if (mode === "site") pickSite(e);
});

// ================================================================ SPACE SCENE (launch-site globe, Earth orbit, trips to the Moon/Mars)
const space = new THREE.Scene();
space.background = new THREE.Color(0x000000);
space.add(new THREE.AmbientLight(0xffffff, 0.04));
const sunS = new THREE.DirectionalLight(0xffffff, 3.2); space.add(sunS);
const stars = starField(6000, 900); space.add(stars);
const ER = 2;
const globe = earthGlobe(ER); space.add(globe);
const pins = SITES.map((s) => {
  const g = new THREE.Group(), d = dirLL(s.lat, s.lon);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.14, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  stick.position.y = 0.07;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 8), new THREE.MeshBasicMaterial({ color: 0xff7a2f }));
  head.position.y = 0.15;
  g.add(stick, head);
  g.position.copy(d.clone().multiplyScalar(ER));
  g.quaternion.setFromUnitVectors(V(0, 1, 0), d);
  const lab = new CSS2DObject(Object.assign(document.createElement("div"), { className: "label", textContent: s.place.split(",")[0] }));
  lab.position.y = 0.2;
  g.add(lab);
  g.userData = { site: s, head, lab };
  globe.add(g);
  return g;
});
const trip = new THREE.Group(); space.add(trip); // everything for the orbit / Moon / Mars part
function setSun(dir) {
  sunS.position.copy(dir).multiplyScalar(50);
  globe.userData.ground.material.uniforms.sunDir.value.copy(dir).normalize();
  globe.userData.atmo.material.uniforms.sunDir.value.copy(dir).normalize();
}

function renderSiteCard() {
  const b = siteBonus(site);
  $("#sitecard").innerHTML = `<h3>Step 2 · Launch site</h3><h2>${esc(site.name)}</h2><div style="color:var(--muted)">${esc(site.place)} · ${Math.abs(site.lat).toFixed(1)}°${site.lat >= 0 ? "N" : "S"}</div>
    <div class="bonus ${b ? "" : "zero"}">${b ? `🌍 Earth spins east here at <b>${b} m/s</b>. Launching east, your rocket gets that speed for free.` : `🧭 Polar launches go north–south, so they get <b>no</b> speed boost from Earth's spin.`}</div>
    <p style="color:var(--muted);font-size:13px;margin:0">Sites near the equator get the biggest boost. Click a pin on the globe or pick one below.</p>
    <div class="sitelist">${SITES.map((s) => `<button data-id="${s.id}" class="${s.id === site.id ? "on" : ""}"><span>${esc(s.place)}</span><small>+${siteBonus(s)} m/s</small></button>`).join("")}</div>`;
  $("#sitecard").querySelectorAll("[data-id]").forEach((x) => (x.onclick = () => chooseSite(SITES.find((s) => s.id === x.dataset.id))));
  pins.forEach((p) => { p.userData.head.material.color.set(p.userData.site.id === site.id ? 0x3ddc84 : 0xff7a2f); p.userData.lab.element.classList.toggle("on", p.userData.site.id === site.id); });
  $("#toLaunch").disabled = false;
}
let camFly = null;
function chooseSite(s) {
  site = s;
  renderSiteCard();
  renderStats();
  camFly = { from: camera.position.clone(), to: dirLL(s.lat, s.lon).multiplyScalar(6.2), t: 0 };
  sfx.click();
}
function pickSite(e) {
  let best = null, bd = 24;
  for (const p of pins) {
    const w = p.userData.head.getWorldPosition(V());
    if (w.clone().normalize().dot(camera.position.clone().normalize()) < 0.1) continue;
    const s = w.project(camera), d = Math.hypot(((s.x + 1) / 2) * innerWidth - e.clientX, ((1 - s.y) / 2) * innerHeight - e.clientY);
    if (d < bd) { bd = d; best = p; }
  }
  if (best) chooseSite(best.userData.site);
}

// ================================================================ FLIGHT SCENE (launch pad → orbit)
const flight = new THREE.Scene();
const UNIT = 2.5; // metres per scene unit
const RE = 6371000 / UNIT;
const sky = new Sky();
sky.scale.setScalar(1e6);
sky.material.depthTest = false; sky.material.depthWrite = false; sky.renderOrder = -10; sky.frustumCulled = false;
flight.add(sky);
const skyU = sky.material.uniforms;
skyU.turbidity.value = 2.2; skyU.rayleigh.value = 2.4; skyU.mieCoefficient.value = 0.003; skyU.mieDirectionalG.value = 0.85;
const SUN = V(0.45, 0.62, -0.64).normalize(); // morning sun, a little behind the camera's left
skyU.sunPosition.value.copy(SUN);
const fHemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a4a30, 0.6); flight.add(fHemi);
const fSun = new THREE.DirectionalLight(0xfff1dc, 3.0); fSun.castShadow = true; fSun.shadow.mapSize.set(2048, 2048);
Object.assign(fSun.shadow.camera, { left: -60, right: 60, top: 80, bottom: -20, far: 600 });
flight.add(fSun, fSun.target);
const fStars = starField(4000, 4e5, 1.4); fStars.material.opacity = 0; flight.add(fStars);
const bigEarth = new THREE.Group();
const bigGround = new THREE.Mesh(new THREE.SphereGeometry(RE, 360, 180), earthMaterial(T.earth));
const bigClouds = new THREE.Mesh(new THREE.SphereGeometry(RE + 4000, 256, 128), new THREE.MeshStandardMaterial({ color: 0xffffff, alphaMap: T.clouds, transparent: true, depthWrite: false, roughness: 1, opacity: 0.55 }));
const bigAtmo = atmosphere(RE * 1.018, 0x5fa9ff, 2.2, 1.0);
bigEarth.add(bigGround, bigClouds, bigAtmo);
bigEarth.position.y = -RE;
flight.add(bigEarth);
let hdPatch = null; // NASA GIBS imagery around the launch site
const localGround = new THREE.Mesh(new THREE.CircleGeometry(1400, 96), new THREE.MeshStandardMaterial({ map: grassTex, transparent: true, roughness: 1, depthWrite: false }));
localGround.rotation.x = -Math.PI / 2; localGround.position.y = 0.06; localGround.receiveShadow = true; localGround.renderOrder = 1; flight.add(localGround);
const apron = new THREE.Mesh(new THREE.CircleGeometry(60, 64), new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.95 }));
apron.rotation.x = -Math.PI / 2; apron.position.y = 0.1; apron.receiveShadow = true; flight.add(apron);
const fPad = pad.clone(); fPad.scale.set(3, 1, 3); fPad.position.y = 0.4; flight.add(fPad);
const trench = new THREE.Mesh(new THREE.BoxGeometry(6, 0.3, 40), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 1 })); trench.position.set(0, 0.25, 22); flight.add(trench);
tower(flight, -8, 44);
const roadMat = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 1 });
for (const [x, z, w, l, r] of [[0, 120, 8, 200, 0], [140, 40, 8, 280, Math.PI / 2], [-120, -60, 8, 240, 0.4]]) { const rd = new THREE.Mesh(new THREE.PlaneGeometry(w, l), roadMat); rd.rotation.x = -Math.PI / 2; rd.rotation.z = r; rd.position.set(x, 0.12, z); flight.add(rd); }
for (let i = 0; i < 8; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(10 + Math.random() * 14, 5 + Math.random() * 12, 10 + Math.random() * 10), new THREE.MeshStandardMaterial({ color: i % 3 ? 0xdcdfe4 : 0xb9bec7, roughness: 0.8 })); b.position.set(110 + i * 26, 4, -70 + rnd(50)); b.castShadow = b.receiveShadow = true; flight.add(b); }
const vab = new THREE.Mesh(new THREE.BoxGeometry(40, 46, 36), new THREE.MeshStandardMaterial({ color: 0xe6e8ec, roughness: 0.7 })); vab.position.set(-150, 23, 140); vab.castShadow = true; flight.add(vab);
const fire = new Particles(6000, true), smoke = new Particles(4500, false, puffTex), sparks = new Particles(1500, true);
flight.add(fire.points, smoke.points, sparks.points);
const flash = new THREE.PointLight(0xffa040, 0, 600, 1.4); flight.add(flash);
const flameLight = new THREE.PointLight(0xffa45a, 0, 200, 1.6); flight.add(flameLight);

// local frame at the launch site: x = launch direction, y = up
function siteFrame(s) {
  const up = dirLL(s.lat, s.lon), north = dirLL(s.lat + 0.01, s.lon).sub(dirLL(s.lat - 0.01, s.lon)).normalize();
  const east = north.clone().cross(up).normalize().negate(); // up × north… = east
  const heading = s.east ? east : north.clone().negate(); // polar sites launch south
  const side = heading.clone().cross(up).normalize();
  // rotation taking Earth-model coordinates to the flight scene: heading→+X, up→+Y, side→+Z
  const m = new THREE.Matrix4().makeBasis(heading, up, side).transpose();
  return new THREE.Quaternion().setFromRotationMatrix(m);
}
// NASA GIBS Blue Marble 500 m tiles (geographic grid: level z tiles are 288/2^z degrees)
async function loadHdPatch(s) {
  const z = 7, tileDeg = 288 / 2 ** z, n = 6;
  const c0 = Math.floor((s.lon + 180) / tileDeg) - n / 2 + 1, r0 = Math.floor((90 - s.lat) / tileDeg) - n / 2 + 1;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = n * 512;
  const ctx = canvas.getContext("2d");
  await Promise.all([...Array(n * n)].map((_, i) => new Promise((ok) => {
    const cx = c0 + (i % n), ry = r0 + Math.floor(i / n), im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => { ctx.drawImage(im, (i % n) * 512, Math.floor(i / n) * 512); ok(); };
    im.onerror = ok;
    im.src = `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_NextGeneration/default/500m/${z}/${ry}/${((cx % 160) + 160) % 160}.jpeg`;
  })));
  const lon0 = c0 * tileDeg - 180, lat0 = 90 - r0 * tileDeg, span = n * tileDeg, N = 160;
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const lat = lat0 - (j / N) * span, lon = lon0 + (i / N) * span;
    pos.push(...dirLL(lat, lon).multiplyScalar(RE - 1.5).toArray()); // just under the pad, above the coarse globe facets
    uv.push(i / N, 1 - j / N);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
  const mesh = new THREE.Mesh(g, earthMaterial(t, { night: false, edgeFade: true }));
  mesh.renderOrder = 0;
  return mesh;
}

// ---------------- the mission timeline (real seconds after lift-off), played fast-forward
// [t, altitude km, velocity km/s, downrange km, flight-path angle°]
const ASCENT = [[0, 0, 0, 0, 90], [10, 0.25, 0.05, 0, 90], [30, 2.2, 0.18, 0.5, 84], [70, 12, 0.45, 9, 62], [110, 35, 1.2, 40, 42], [150, 70, 2.4, 95, 30], [190, 110, 2.9, 170, 22], [300, 165, 4.6, 560, 9], [420, 192, 6.3, 1100, 3], [520, 200, 7.8, 1650, 0]];
function interp(keys, t, col) {
  if (t <= keys[0][0]) return keys[0][col];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) {
    const a = keys[i - 1], b = keys[i], k = (t - a[0]) / (b[0] - a[0]);
    // smooth (Hermite) between keys using neighbour slopes
    const p = keys[i - 2] || a, q = keys[i + 1] || b;
    const m0 = ((b[col] - p[col]) / (b[0] - p[0] || 1)) * (b[0] - a[0]), m1 = ((q[col] - a[col]) / (q[0] - a[0] || 1)) * (b[0] - a[0]);
    const k2 = k * k, k3 = k2 * k;
    return (2 * k3 - 3 * k2 + 1) * a[col] + (k3 - 2 * k2 + k) * m0 + (-2 * k3 + 3 * k2) * b[col] + (k3 - k2) * m1;
  }
  return keys[keys.length - 1][col];
}
const timeAtV = (v) => { let lo = 0, hi = 520; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; interp(ASCENT, m, 2) < v ? (lo = m) : (hi = m); } return (lo + hi) / 2; };
const fmtT = (t) => { const s = Math.max(0, Math.floor(Math.abs(t))), m = Math.floor(s / 60); return `${t < 0 ? "T−" : "T+"}${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

let F = null;
async function startFlight() {
  const o = outcome(stack, site);
  if (F) { flight.remove(F.root); F.extra.forEach((x) => x.parent?.remove(x)); }
  fire.clear(); smoke.clear(); sparks.clear();
  bigEarth.quaternion.copy(siteFrame(site));
  flight.environment = pmrem.fromScene((() => { const sc = new THREE.Scene(); const s2 = new Sky(); s2.scale.setScalar(1000); Object.assign(s2.material.uniforms.sunPosition.value, SUN); s2.material.uniforms.turbidity.value = 4; s2.material.uniforms.rayleigh.value = 1.6; sc.add(s2); return sc; })()).texture;
  if (hdPatch) bigGround.remove(hdPatch);
  hdPatch = null;
  loadHdPatch(site).then((m) => { if (F && F.site === site) { hdPatch = m; bigGround.add(m); } });
  const root = new THREE.Group(), rk = rocketMesh(stack);
  rk.position.y = 0.8;
  root.add(rk);
  flight.add(root);
  const groups = [[]];
  for (const p of rk.userData.parts) { groups[groups.length - 1].push(p); if (PARTS[p.userData.item.id].kind === "decoupler") groups.push([]); }
  // flame plumes
  const plumeTex = canvasTex(64, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.12, "rgba(255,240,190,.95)"); gr.addColorStop(0.45, "rgba(255,150,50,.6)"); gr.addColorStop(1, "rgba(255,70,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const plumes = [];
  rk.userData.parts.forEach((p) => (p.userData.nozzles || []).forEach((n) => {
    const r = p.userData.nozzleR, vac = p.userData.item.id === "engineV", grp = new THREE.Group();
    for (const [rr, len, op] of [[r * 0.95, r * 8, 0.85], [r * 0.55, r * 4.5, 1]]) {
      const geo = new THREE.ConeGeometry(rr, len, 32, 1, true);
      geo.rotateX(Math.PI); geo.translate(0, -len / 2, 0);
      grp.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: plumeTex, color: vac ? 0xc6d8ff : 0xffffff, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })));
    }
    // shock diamonds for the sea-level engines
    if (!vac) for (let d = 1; d <= 3; d++) { const s = new THREE.Mesh(new THREE.SphereGeometry(r * 0.28, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })); s.scale.y = 1.8; s.position.y = -r * 1.3 * d; grp.add(s); }
    grp.position.copy(n);
    grp.visible = false;
    p.add(grp);
    plumes.push({ grp, part: p, vac });
  }));
  const st = o.stages, upper = st.slice(1).map((s) => s.dv), upTot = upper.reduce((a, b) => a + b, 0) || 1;
  // stage separation times: first at 150 s, later ones split the rest by their share of Δv
  const sepT = [];
  if (st.length > 1) { sepT.push(150); let acc = 0; for (let i = 0; i < upper.length - 1; i++) { acc += upper[i]; sepT.push(timeAtV(2.4 + 5.4 * (acc / upTot))); } }
  const reach = o.ok || o.partial ? 1 : o.fail.code === "lowDv" ? clamp((o.dv + o.bonus) / o.need, 0.3, 0.97) : 1;
  F = {
    o, site, root, rk, groups, plumes, extra: [], sepT, reach, cutT: o.fail?.code === "lowDv" ? timeAtV(7.8 * reach ** 1.6) : 520,
    tm: -10, phase: "ready", alt: 0, v: 0, down: 0, gamma: 90, stage: 0, events: new Set(), done: false, fall: null, camOff: null,
  };
  renderMilestones();
  controls.target.set(0, rk.userData.height * 0.5, 0);
  camera.position.set(34, 12, 46);
  controls.enabled = true;
  $("#launchcta").hidden = false;
  $("#tclock").textContent = "READY";
  setHud(0, 0, 1, "Everything set. Press LAUNCH!");
  setRate(1);
}
function renderMilestones() {
  const tgt = F.o.target;
  const ms = ["Lift-off", "Max-Q", "Stage sep.", "Fairing", "Orbit", ...(tgt === "moon" ? ["To the Moon", "Moon orbit"] : tgt === "mars" ? ["To Mars", "Mars orbit"] : [])];
  $("#milestones").innerHTML = ms.map((m, i) => `${i ? "<i></i>" : ""}<span data-m="${i}">${m}</span>`).join("");
}
function mile(i, bad) { const s = $(`#milestones [data-m="${i}"]`); if (s) s.className = bad ? "bad" : "done"; }
function setHud(alt, v, stage, ev, altLabel = "Altitude", vLabel = "Velocity") {
  $("#halt").textContent = alt < 1 ? `${Math.round(alt * 1000)} m` : alt < 100000 ? `${alt.toFixed(1)} km` : `${Math.round(alt).toLocaleString()} km`;
  $("#hspd").textContent = `${v.toFixed(2)} km/s`;
  $("#hstg").textContent = stage;
  $("#hud").querySelectorAll(".g small")[0].textContent = altLabel;
  $("#hud").querySelectorAll(".g small")[1].textContent = vLabel;
  if (ev !== undefined && $("#hev").textContent !== ev) { const e = $("#hev"); e.textContent = ev; e.classList.remove("pop"); void e.offsetWidth; e.classList.add("pop"); }
}
let rate = 1;
function setRate(r) { rate = r; $("#hrate").textContent = r > 1.05 ? `▶▶ ×${Math.round(r)} time` : "▶ real time"; }
$("#launchBtn").onclick = () => {
  if (!F || F.phase !== "ready") return;
  $("#launchcta").hidden = true;
  F.phase = "countdown"; F.tm = -10;
  controls.enabled = false;
  sfx.start();
};
function activeNozzles() {
  const out = [];
  for (const p of F.groups[F.stage] || []) if (p.userData.nozzles) for (const n of p.userData.nozzles) out.push({ p: p.localToWorld(n.clone()), r: p.userData.nozzleR, vac: p.userData.item.id === "engineV" });
  return out;
}
function plumesOn(k) {
  const active = new Set(F.groups[F.stage] || []), air = clamp(1 - F.alt / 60, 0, 1);
  for (const pl of F.plumes) {
    const on = k > 0 && active.has(pl.part);
    pl.grp.visible = on;
    if (on) { const f = 0.88 + Math.random() * 0.24, wide = 1 + (1 - air) * 2.2; pl.grp.scale.set(k * wide * f, k * f * (1 + (1 - air) * 0.8), k * wide * f); pl.grp.children.forEach((c, i) => { if (i > 1) c.visible = air > 0.4; }); }
  }
  flameLight.intensity = k * 900 * (air * 0.8 + 0.2);
}
function emitExhaust(dt, k) {
  sfx.level(k);
  plumesOn(k);
  if (k <= 0) return;
  const air = clamp(1 - F.alt / 60, 0, 1), down = F.dir.clone().negate();
  const nz = activeNozzles();
  if (nz[0]) flameLight.position.copy(nz[0].p).addScaledVector(down, 6);
  for (const n of nz) {
    const N = Math.ceil(30 * k * (dt * 60) * (n.vac ? 0.6 : 1));
    for (let i = 0; i < N; i++) {
      const p = n.p.clone().add(V(rnd(n.r * 0.5), 0, rnd(n.r * 0.5))).addScaledVector(F.velScene || V(), -Math.random() * dt);
      const sp = 60 + Math.random() * 40, spread = 0.07 + (1 - air) * 0.6;
      const v = down.clone().multiplyScalar(sp).add(V(rnd(sp * spread), rnd(sp * spread * 0.4), rnd(sp * spread)));
      fire.emit(p, v, 0.18 + Math.random() * 0.14, n.r * 2.4, n.r * (5 + (1 - air) * 7), n.vac ? [0.8, 0.88, 1] : [1, 0.85, 0.45], n.vac ? [0.3, 0.45, 1] : [1, 0.32, 0.04], 2);
    }
    if (air > 0.05) {
      const near = F.alt < 0.35;
      for (let i = 0; i < (near ? 14 : 3) * k * (dt * 60); i++) {
        const p = n.p.clone().addScaledVector(down, 5 + Math.random() * 4).addScaledVector(F.velScene || V(), -Math.random() * dt);
        const v = near ? V(rnd(34), 1 + Math.random() * 5, rnd(34)) : down.clone().multiplyScalar(8).add(V(rnd(3), rnd(3), rnd(3)));
        const base = near ? [0.96, 0.95, 0.93] : [0.97, 0.96, 0.95];
        smoke.emit(p, v, near ? 8 + Math.random() * 5 : 7, near ? 14 : 5, near ? 60 + Math.random() * 30 : 26, base.map((c) => c * air + 0.06), [0.8, 0.8, 0.82].map((c) => c * air + 0.05), near ? 0.42 : 0.2, -0.35, near ? 0.5 : 0.6);
      }
    }
  }
}
function explode(at, big = 1) {
  F.dead = true;
  plumesOn(0);
  sfx.boom();
  flash.position.copy(at); flash.intensity = 4000 * big;
  for (let i = 0; i < 1000 * big; i++) { const v = V(rnd(), rnd(), rnd()).normalize().multiplyScalar(20 + Math.random() * 70 * big); fire.emit(at, v, 0.8 + Math.random() * 1.4, 4 + Math.random() * 5, 16 + Math.random() * 18, [1, 0.95, 0.65], [0.85, 0.2, 0.02], 1.5, -3); }
  for (let i = 0; i < 450 * big; i++) { const v = V(rnd(), rnd() + 0.4, rnd()).normalize().multiplyScalar(8 + Math.random() * 25); smoke.emit(at, v, 4 + Math.random() * 4, 8, 40 + Math.random() * 30, [0.3, 0.28, 0.27], [0.12, 0.12, 0.12], 0.7, -1, 0.9); }
  for (let i = 0; i < 350; i++) sparks.emit(at, V(rnd(), rnd() + 0.3, rnd()).normalize().multiplyScalar(40 + Math.random() * 90), 1.5 + Math.random(), 0.9, 0.4, [1, 0.9, 0.5], [1, 0.4, 0.1], 0.3, 25);
  const parts = [];
  F.rk.children.forEach((o) => { if (o.userData.h !== undefined) parts.push(o); });
  for (const p of parts) { flight.attach(p); p.userData.vel = V(rnd(25), 10 + Math.random() * 30, rnd(25)); p.userData.spin = V(rnd(4), rnd(4), rnd(4)); F.extra.push(p); }
  F.root.visible = false;
}
function separate() {
  const g = F.groups[F.stage];
  if (!g) return;
  const holder = new THREE.Group();
  flight.add(holder);
  g.forEach((p) => holder.attach(p));
  holder.userData.vel = (F.velScene || V()).clone().multiplyScalar(0.985).addScaledVector(F.dir, -6);
  holder.userData.spin = V(rnd(0.5), rnd(0.2), rnd(0.5));
  F.extra.push(holder);
  F.stage++;
  sfx.thunk();
  const at = F.root.position.clone();
  for (let i = 0; i < 90; i++) smoke.emit(at, V(rnd(12), rnd(12), rnd(12)), 1.4, 3, 10, [0.95, 0.95, 0.95], [0.7, 0.7, 0.7], 1, 0, 0.7);
}
function dropFairing() {
  const nose = F.rk.children.find((p) => p.userData.item?.id === "nose");
  if (!nose) return;
  nose.children.filter((c) => c.userData.half).forEach((half) => {
    flight.attach(half);
    half.userData.vel = (F.velScene || V()).clone().multiplyScalar(0.995).add(F.side.clone().multiplyScalar(half.userData.half * 8));
    half.userData.spin = V(0, 0, half.userData.half * 1.4);
    F.extra.push(half);
  });
  nose.visible = false;
  sfx.thunk();
}
// put the rocket on the curved Earth from altitude, downrange and flight-path angle
function placeRocket(alt, down, gamma) {
  const phi = (down * 1000) / UNIT / RE, rr = RE + (alt * 1000) / UNIT;
  const centre = V(0, -RE, 0);
  const up = V(Math.sin(phi), Math.cos(phi), 0);
  const fwd = V(Math.cos(phi), -Math.sin(phi), 0);
  const prev = F.root.position.clone();
  F.root.position.copy(centre).addScaledVector(up, rr);
  if (alt < 0.0005) F.root.position.y = 0;
  const g = gamma * D2R;
  F.dir = up.clone().multiplyScalar(Math.sin(g)).addScaledVector(fwd, Math.cos(g)).normalize();
  F.up = up; F.fwd = fwd; F.side = V(0, 0, 1);
  F.root.quaternion.setFromUnitVectors(V(0, 1, 0), F.dir);
  return prev;
}

function flightStep(dt) {
  if (!F) return;
  fire.update(dt); smoke.update(dt); sparks.update(dt);
  flash.intensity *= Math.exp(-dt * 4);
  for (const x of F.extra) if (x.userData.vel) { x.position.addScaledVector(x.userData.vel, dt); x.userData.vel.y -= (9.8 / UNIT) * dt * (F.alt > 60 ? 0.2 : 1); x.rotation.x += x.userData.spin.x * dt; x.rotation.y += x.userData.spin.y * dt; x.rotation.z += x.userData.spin.z * dt; }
  if (F.phase === "ready") return;
  const o = F.o, code = o.fail?.code;
  // mission clock: real time near the pad, then fast-forward
  if (F.phase === "countdown") {
    F.tm += dt;
    $("#tclock").textContent = fmtT(F.tm);
    F.dir = V(0, 1, 0);
    if (F.tm > -3 && code !== "noEngine") emitExhaust(dt, code === "noFuel" ? (F.tm < -2.2 ? 0.45 : 0) : clamp((F.tm + 3) / 3, 0, 1));
    setHud(0, 0, 1, F.tm > -3 && code !== "noEngine" ? "Main engine start" : "Counting down");
    if (F.tm >= 0) {
      if (code === "noEngine") return finish("Nothing lit up…");
      if (code === "noFuel") return finish("The engines died: no fuel");
      if (code === "noLift") { F.phase = "strain"; F.tm = 0; setHud(0, 0, 1, "Full power… the rocket won't move"); return; }
      F.phase = "fly"; F.tm = 0; mile(0); setHud(0, 0, 1, "Lift-off!");
      return;
    }
    return;
  }
  if (F.phase === "strain") {
    F.tm += dt;
    emitExhaust(dt, 1);
    F.root.position.set(rnd(0.08), 0, rnd(0.08));
    $("#tclock").textContent = fmtT(F.tm);
    if (F.tm > 6) { sfx.stop(); plumesOn(0); finish("Engines shut down"); }
    return;
  }
  if (F.phase === "fly") {
    // time-lapse speed: real time for the first 20 s, then up to ×25
    const want = F.fall ? (F.fall.reentry ? 4 : 18) : F.tm < 20 ? 1 : F.tm < 60 ? lerp(1, 25, (F.tm - 20) / 40) : 25;
    setRate(want);
    F.tm += dt * want;
    let alt, v, down, gamma, burning = true;
    if (code === "tooHeavy") {
      setRate(1);
      const T0 = 16, k = clamp(F.tm / T0, 0, 1);
      alt = 0.32 * 4 * k * (1 - k); v = 0.32 * 4 * (1 - 2 * k) / T0 * 1000 / 1000 * 0.25; down = 0; gamma = 90;
      burning = k < 0.55;
      if (k >= 1) { placeRocket(0, 0, 90); explode(F.root.position.clone().add(V(0, 8, 0)), 1.3); F.phase = "after"; F.tm2 = 0; setHud(0, 0.05, 1, "It fell back and exploded on the pad"); mile(1, true); return; }
      if (!burning && !F.events.has("cut")) { F.events.add("cut"); setHud(alt, Math.abs(v), 1, "Not enough push… it's falling back!"); }
    } else if (F.fall) {
      // engines off: a ballistic arc (gravity minus the "centrifugal" help from horizontal speed), then re-entry
      const f = F.fall, tau = F.tm - f.t0, g = 0.0098 * (1 - (f.vh / 7.9) ** 2);
      alt = f.alt + f.vz * tau - 0.5 * g * tau * tau;
      down = f.down + f.vh * tau;
      const vz = f.vz - g * tau;
      v = Math.hypot(vz, f.vh) + (alt < 90 ? (90 - alt) * 0.002 : 0);
      gamma = Math.atan2(vz, f.vh) / D2R;
      burning = false;
      if (vz < 0 && alt < 95 && !f.reentry) { f.reentry = true; setHud(alt, v, F.stage + 1, "Falling back into the atmosphere… it's burning up"); }
      if (f.reentry) { const p = F.root.position.clone(); for (let i = 0; i < 20; i++) fire.emit(p.clone().addScaledVector(F.dir, F.rk.userData.height * Math.random()), F.dir.clone().multiplyScalar(-40).add(V(rnd(8), rnd(8), rnd(8))), 0.5, 5, 18, [1, 0.85, 0.5], [1, 0.25, 0.05], 0.5); }
      if (alt < 45) { placeRocket(alt, down, gamma); explode(F.root.position.clone(), 0.8); F.phase = "after"; F.tm2 = 0; setHud(alt, v, F.stage + 1, "Burned up and broke apart"); return; }
    } else {
      const t = F.tm;
      alt = interp(ASCENT, t, 1); v = interp(ASCENT, t, 2); down = interp(ASCENT, t, 3); gamma = interp(ASCENT, t, 4);
      if (code === "unstable" && t > 30) {
        F.wob = (F.wob || 0) + dt;
        gamma -= Math.sin(F.wob * 5) * F.wob * 12 + F.wob * F.wob * 18;
        setHud(alt, v, 1, "Wobbling… no fins to keep it straight!");
        if (F.wob > 3.2) { placeRocket(alt, down, gamma); explode(F.root.position.clone().addScaledVector(F.dir, F.rk.userData.height * 0.5), 1); F.phase = "after"; F.tm2 = 0; mile(1, true); return; }
      }
      if (code === "noNose" && t >= 70) { placeRocket(alt, down, gamma); explode(F.root.position.clone().addScaledVector(F.dir, F.rk.userData.height * 0.85), 1); F.phase = "after"; F.tm2 = 0; setHud(alt, v, 1, "Broke apart at Max-Q"); mile(1, true); return; }
      if (t >= 70 && !F.events.has("maxq")) { F.events.add("maxq"); mile(1); setHud(alt, v, F.stage + 1, "Max-Q: the biggest squeeze from the air. Holding together!"); }
      // staging
      if (F.sepT[F.stage] !== undefined && t >= F.sepT[F.stage]) {
        if (code === "noDecoupler" || (code === "upperNoFuel" && F.stage === 0)) {
          if (code === "upperNoFuel") { separate(); mile(2); }
          F.fall = { t0: t, alt, down, vz: v * Math.sin(gamma * D2R), vh: v * Math.cos(gamma * D2R) };
          setHud(alt, v, F.stage + 1, code === "noDecoupler" ? "Stage 1 is empty… but it didn't separate!" : "Separated… but the upper engine won't start");
          if (code === "noDecoupler") mile(2, true);
          sfx.stop();
        } else { separate(); mile(2); setHud(alt, v, F.stage + 1, `Stage ${F.stage} separated · stage ${F.stage + 1} burning`); }
      }
      if (t >= 190 && !F.events.has("fair") && !F.fall) { F.events.add("fair"); dropFairing(); mile(3); setHud(alt, v, F.stage + 1, "Fairing jettisoned: the payload sees space"); }
      if (!F.fall && t >= F.cutT && code === "lowDv") {
        F.fall = { t0: t, alt, down, vz: v * Math.sin(gamma * D2R), vh: v * Math.cos(gamma * D2R) };
        setHud(alt, v, F.stage + 1, "Out of fuel before reaching orbit speed…"); mile(4, true); sfx.stop();
      }
      if (!F.fall && t >= 520) { F.phase = "insert"; F.tm2 = 0; mile(4); setHud(200, 7.8, F.stage + 1, "Engine cut-off: ORBIT reached at 7.8 km/s"); sfx.stop(); plumesOn(0); return; }
    }
    F.alt = alt; F.v = v;
    const prev = placeRocket(Math.max(alt, 0), down || 0, gamma);
    F.velScene = F.root.position.clone().sub(prev).divideScalar(Math.max(dt, 1e-3));
    if (burning) emitExhaust(dt, 1); else { sfx.level(0); plumesOn(0); }
    setHud(Math.max(alt, 0), Math.abs(v), F.stage + 1);
    $("#tclock").textContent = fmtT(F.tm);
    return;
  }
  if (F.phase === "insert") { F.tm2 += dt; if (F.tm2 > 1.8) startTrip(); return; }
  if (F.phase === "after") { F.tm2 += dt; if (!F.done && F.tm2 > 3) finish(); }
}

// ================================================================ after orbit: Earth orbit view, then (maybe) the Moon or Mars
let TRIP = null;
function payloadOf() {
  const firstSep = stack.findIndex((y) => PARTS[y.id].kind === "decoupler");
  const top = firstSep < 0 ? stack : stack.slice(0, firstSep);
  return { top, payload: top.find((x) => PARTS[x.id].kind === "payload"), solar: top.some((x) => PARTS[x.id].kind === "solar") };
}
function spacecraft(scale) {
  const { payload, solar } = payloadOf(), sat = new THREE.Group();
  if (payload && F.o.fail?.code !== "payloadDropped") {
    const body = partMesh(payload); body.scale.setScalar(scale); body.position.y = -0.7 * scale; sat.add(body);
    if (solar) for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(3.6 * scale, 0.04 * scale, 1.1 * scale), M.panel); w.position.x = s * 2.4 * scale; w.scale.x = 0.02; w.userData.unfold = true; sat.add(w); }
    else sat.userData.dead = true;
  } else { const stg = new THREE.Mesh(new THREE.CylinderGeometry(scale, scale, 3 * scale, 24), M.paint); sat.add(stg); sat.userData.empty = true; }
  return sat;
}
function startTrip() {
  setMode("orbit");
  trip.clear();
  pins.forEach((p) => (p.visible = false));
  const o = F.o, tgt = o.ok ? o.target : "leo";
  const rOrb = ER * (1 + 200 / 6371), incl = (site.east ? Math.abs(site.lat) : 90) * D2R;
  const plane = new THREE.Group(); plane.rotation.x = incl; trip.add(plane);
  const pts = []; for (let i = 0; i <= 256; i++) { const a = (i / 256) * Math.PI * 2; pts.push(V(Math.cos(a) * rOrb, 0, Math.sin(a) * rOrb)); }
  const orbitLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x6ea8ff, transparent: true, opacity: 0.35 }));
  plane.add(orbitLine);
  const sat = spacecraft(0.0012);
  plane.add(sat);
  setSun(V(1, 0.3, 0.5).normalize());
  TRIP = { tgt, plane, sat, rOrb, a: 0, t: 0, phase: "orbit", o };
  setRate(30);
  setHud(200, 7.8, F.stage + 1, sat.userData.empty ? "In orbit… with nothing to deliver" : "In orbit around Earth", "Altitude", "Velocity");
}
function tripStep(dt) {
  const R = TRIP;
  if (!R) return;
  R.t += dt;
  const satWorld = () => R.sat.getWorldPosition(V());
  if (R.phase === "orbit") {
    R.a += dt * 0.07;
    R.sat.position.set(Math.cos(R.a) * R.rOrb, 0, Math.sin(R.a) * R.rOrb);
    R.sat.lookAt(R.plane.localToWorld(V()));
    R.sat.children.forEach((c) => { if (c.userData.unfold) c.scale.x = clamp(c.scale.x + dt * 0.45, 0.02, 1); });
    if (R.sat.userData.dead && R.t > 1.5 && R.t < 4) R.sat.traverse((m) => { if (m.isMesh) { if (!m.userData.m0) { m.userData.m0 = m.material; m.material = m.material.clone(); } m.material.emissive = new THREE.Color(Math.sin(R.t * 10) > 0 ? 0x661010 : 0); } });
    // camera rides just behind the spacecraft with Earth below
    const sw = satWorld(), up = sw.clone().normalize();
    const fwdDir = R.plane.localToWorld(V(-Math.sin(R.a), 0, Math.cos(R.a))).sub(R.plane.localToWorld(V())).normalize();
    const pull = clamp((R.t - 3) / 3, 0, 1);
    const off = up.clone().multiplyScalar(lerp(0.004, 1.2, ease(pull))).addScaledVector(fwdDir, -lerp(0.012, 2.2, ease(pull))).add(fwdDir.clone().cross(up).multiplyScalar(lerp(0.006, 1.4, ease(pull))));
    camera.position.copy(sw).add(off);
    controls.target.copy(sw.clone().lerp(V(), ease(pull) * 0.6));
    $("#tclock").textContent = fmtT(520 + R.t * 30);
    if (R.t > 6.5) {
      if (R.tgt === "leo") { R.phase = "done"; finish(); }
      else { R.phase = "burn"; R.t = 0; setHud(200, 7.8, F.stage + 1, R.tgt === "moon" ? "Trans-lunar injection burn: heading for the Moon" : "Trans-Mars injection burn: heading for Mars"); mile(5); }
    }
    return;
  }
  if (R.phase === "burn") {
    const dv = R.tgt === "moon" ? 3.1 : 3.6, k = clamp(R.t / 5, 0, 1);
    const v = 7.8 + dv * ease(k);
    R.a += dt * 0.07 * (1 + k);
    const rr = R.rOrb * (1 + k * k * 0.5);
    R.sat.position.set(Math.cos(R.a) * rr, 0, Math.sin(R.a) * rr);
    const sw = satWorld();
    // engine glow behind the spacecraft
    if (!R.glow) { R.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xaecbff, blending: THREE.AdditiveBlending, depthWrite: false })); space.add(R.glow); }
    R.glow.position.copy(sw); R.glow.scale.setScalar(0.03 * (0.8 + Math.random() * 0.4));
    camera.position.lerp(sw.clone().add(sw.clone().normalize().multiplyScalar(1.4)).add(V(0, 1.2, 0)), 1 - Math.exp(-dt * 1.2));
    controls.target.lerp(sw, 1 - Math.exp(-dt * 2));
    setHud(200 + k * 400, v, F.stage + 1, undefined);
    $("#tclock").textContent = fmtT(520 + 1800 + R.t * 72);
    if (k >= 1) { space.remove(R.glow); R.glow = null; R.tgt === "moon" ? startMoonCruise() : startMarsCruise(); }
  }
  if (R.phase === "cruiseMoon" || R.phase === "cruiseMars") cruiseStep(dt);
  if (R.phase === "arrive") arriveStep(dt);
}
// --- Earth → Moon, distances to scale (Earth radius 2 → the Moon is 120 units away)
async function startMoonCruise() {
  const R = TRIP;
  R.phase = "loading";
  const moon = await bodyGlobe("moon", ER * 0.2727);
  const moonPos = V(-110, 14, -50);
  moon.position.copy(moonPos);
  trip.add(moon);
  R.moon = moon;
  const start = R.sat.getWorldPosition(V());
  R.curve = new THREE.CatmullRomCurve3([start, start.clone().multiplyScalar(4).add(V(0, 6, 8)), V(-50, 16, -10), moonPos.clone().add(V(10, 3, 12)), moonPos.clone().add(V(1.2, 0, 0.9))]);
  const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints(R.curve.getPoints(200)), new THREE.LineDashedMaterial({ color: 0xffb347, dashSize: 1.2, gapSize: 0.8, transparent: true, opacity: 0.8 }));
  path.computeLineDistances(); trip.add(path);
  R.plane.attach(R.sat); trip.attach(R.sat);
  R.phase = "cruiseMoon"; R.t = 0; R.days = 3;
  setRate(86400);
  setHud(600, 10.9, F.stage + 1, "Coasting to the Moon: 3 days, 384,000 km", "Distance from Earth", "Velocity");
}
// --- Earth → Mars: a Hohmann transfer around the Sun (~7 months)
function startMarsCruise() {
  const R = TRIP;
  trip.clear();
  globe.visible = false;
  const sunMesh = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff1c0, blending: THREE.AdditiveBlending, depthWrite: false }));
  sunMesh.scale.setScalar(5); trip.add(sunMesh);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.9, 32, 16), new THREE.MeshBasicMaterial({ color: 0xfff6dc })); trip.add(core);
  const ring = (r, c) => { const p = []; for (let i = 0; i <= 256; i++) { const a = (i / 256) * Math.PI * 2; p.push(V(Math.cos(a) * r, 0, Math.sin(a) * r)); } const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(p), new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.35 })); trip.add(l); };
  ring(10, 0x6ea8ff); ring(15.2, 0xff8a5c);
  const planet = (map, r) => new THREE.Mesh(new THREE.SphereGeometry(r, 48, 24), new THREE.MeshStandardMaterial({ map, roughness: 1 }));
  R.earthP = planet(T.earth, 0.8); R.marsP = planet(T.mars, 0.6); trip.add(R.earthP, R.marsP); // sizes enlarged so they can be seen
  R.probe = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffd27a, blending: THREE.AdditiveBlending, depthWrite: false })); R.probe.scale.setScalar(0.5); trip.add(R.probe);
  const a = 12.6, e = (15.2 - 10) / (15.2 + 10), pts = [];
  for (let i = 0; i <= 128; i++) { const th = (i / 128) * Math.PI, r = (a * (1 - e * e)) / (1 + e * Math.cos(th)); pts.push(V(Math.cos(th) * r, 0, -Math.sin(th) * r)); }
  const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0xffb347, dashSize: 0.5, gapSize: 0.3 })); path.computeLineDistances(); trip.add(path);
  R.transfer = { a, e };
  sunS.position.set(0, 0, 0);
  R.sunLight = new THREE.PointLight(0xffffff, 300, 0, 1.2); trip.add(R.sunLight);
  camera.position.set(4, 26, 22); controls.target.set(0, 0, -2);
  R.phase = "cruiseMars"; R.t = 0; R.days = 210;
  setRate(86400 * 7);
  setHud(0, 11.4, F.stage + 1, "Flying to Mars around the Sun: about 7 months", "Distance from Earth", "Velocity");
}
function cruiseStep(dt) {
  const R = TRIP, dur = 9;
  R.t += dt;
  const k = clamp(R.t / dur, 0, 1);
  if (R.phase === "cruiseMoon") {
    const p = R.curve.getPoint(ease(k));
    R.sat.position.copy(p);
    const tan = R.curve.getTangent(ease(k));
    R.sat.lookAt(p.clone().add(tan));
    // start near the probe, then a wide shot with Earth, the path and the Moon, then close in on the Moon
    const wide = V(-45, 62, 70), nearP = p.clone().add(V(6, 5, 12)), nearM = R.moon.position.clone().add(V(4, 2.5, 6));
    const goal = k < 0.12 ? nearP : k < 0.82 ? wide : nearM;
    camera.position.lerp(goal, 1 - Math.exp(-dt * (k < 0.82 ? 0.9 : 1.6)));
    controls.target.lerp(k < 0.12 ? p : k < 0.82 ? V(-50, 8, -22) : R.moon.position, 1 - Math.exp(-dt * 1.2));
    const distKm = 6371 + 378000 * ease(k), v = k < 0.85 ? lerp(10.9, 0.9, Math.sqrt(k / 0.85)) : lerp(0.9, 2.3, (k - 0.85) / 0.15);
    setHud(distKm, v, F.stage + 1, undefined, "Distance from Earth", "Velocity");
    $("#tclock").textContent = `Day ${(k * 3).toFixed(1)}`;
  } else {
    const th = Math.PI * ease(k), { a, e } = R.transfer, r = (a * (1 - e * e)) / (1 + e * Math.cos(th));
    R.probe.position.set(Math.cos(th) * r, 0, -Math.sin(th) * r);
    const eA = (k * 210 * 360) / 365 * D2R, mA = (44 + (k * 210 * 360) / 687) * D2R + (136 - 44 - 210 * 360 / 687 + 44) * D2R * 0; // Mars leads by ~44° at launch
    const marsA = (44 + k * 136) * D2R;
    R.earthP.position.set(Math.cos(eA) * 10, 0, -Math.sin(eA) * 10);
    R.marsP.position.set(Math.cos(marsA) * 15.2, 0, -Math.sin(marsA) * 15.2);
    R.earthP.rotation.y += dt; R.marsP.rotation.y += dt;
    void mA;
    const distKm = R.probe.position.distanceTo(R.earthP.position) * 15e6;
    const rAU = r / 10, aAU = a / 10; // vis-viva: v = 29.78 km/s × √(2/r − 1/a), r and a in AU
    setHud(distKm, 29.78 * Math.sqrt(2 / rAU - 1 / aAU), F.stage + 1, undefined, "Distance from Earth", "Speed around the Sun");
    $("#tclock").textContent = `Day ${Math.round(k * 210)} · ${["Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"][Math.min(7, Math.floor(k * 7))]}`;
  }
  if (k >= 1) arrive();
}
// --- arrival: the real Moon or Mars, orbit-insertion burn, then circle it
async function arrive() {
  const R = TRIP, name = R.tgt;
  R.phase = "loadingArrive";
  trip.clear();
  globe.visible = false;
  const Rb = 2, body = await bodyGlobe(name, Rb);
  trip.add(body);
  R.body = body;
  if (name === "moon") { const earthFar = earthGlobe(7.3); earthFar.position.set(-300, 60, -320); earthFar.userData.ground.material.uniforms.sunDir.value.set(1, 0.3, 0.5).normalize(); trip.add(earthFar); }
  sunS.position.set(60, 20, 40);
  const craft = spacecraft(0.02);
  trip.add(craft);
  R.craft = craft;
  R.rOrb = Rb * (name === "moon" ? 1.06 : 1.09);
  R.phase = "arrive"; R.t = 0;
  globe.visible = false;
  camera.position.set(5.5, 2.2, 6.5); controls.target.set(0, 0, 0); // clean cut to the new world
  setRate(60);
  mile(6);
  setHud(name === "moon" ? 100 : 400, name === "moon" ? 2.3 : 5.5, F.stage + 1, name === "moon" ? "Arriving at the Moon: braking burn to enter orbit" : "Arriving at Mars: braking burn to enter orbit", "Altitude", "Velocity");
}
function arriveStep(dt) {
  const R = TRIP, name = R.tgt;
  R.t += dt;
  const k = clamp(R.t / 4, 0, 1);
  const ang = -1.2 + R.t * 0.22;
  const rr = lerp(R.rOrb * 2.4, R.rOrb, ease(k));
  R.craft.position.set(Math.cos(ang) * rr, Math.sin(ang * 0.5) * 0.15, Math.sin(ang) * rr);
  R.craft.lookAt(V());
  R.craft.children.forEach((c) => { if (c.userData.unfold) c.scale.x = clamp(c.scale.x + dt * 0.4, 0.02, 1); });
  if (k < 1) {
    if (!R.glow) { R.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xaecbff, blending: THREE.AdditiveBlending, depthWrite: false })); trip.add(R.glow); }
    R.glow.position.copy(R.craft.position).addScaledVector(V(-Math.sin(ang), 0, Math.cos(ang)), 0.04);
    R.glow.scale.setScalar(0.12 * (0.8 + Math.random() * 0.4));
  } else if (R.glow) { trip.remove(R.glow); R.glow = null; }
  const v = name === "moon" ? lerp(2.3, 1.63, ease(k)) : lerp(5.5, 3.4, ease(k));
  const alt = name === "moon" ? 100 : 400;
  setHud(alt, v, F.stage + 1, k >= 1 ? (name === "moon" ? "In orbit around the Moon!" : "In orbit around Mars!") : undefined, "Altitude", "Velocity");
  const cp = R.craft.position.clone();
  // follow the probe in, then pull back to show it circling the whole world
  const pull = clamp((R.t - 4.2) / 2.5, 0, 1);
  const camGoal = cp.clone().multiplyScalar(lerp(1.45, 2.9, ease(pull))).add(V(0.6, lerp(0.9, 2.2, pull), 0.6));
  camera.position.lerp(camGoal, 1 - Math.exp(-dt * 1.6));
  controls.target.lerp(cp.clone().multiplyScalar(lerp(0.45, 0, ease(pull))), 1 - Math.exp(-dt * 1.6));
  if (!R.orbitLine && k >= 1) { const p = []; for (let i = 0; i <= 128; i++) { const a2 = (i / 128) * Math.PI * 2; p.push(V(Math.cos(a2) * R.rOrb, 0, Math.sin(a2) * R.rOrb)); } R.orbitLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(p), new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.5 })); trip.add(R.orbitLine); }
  $("#tclock").textContent = name === "moon" ? "Day 3" : "Day 210";
  if (R.t > 8.5 && !F.done) { mile(7); R.phase = "done"; finish(); }
}

// ================================================================ result card
function finish(msg) {
  if (!F || F.done) return;
  F.done = true;
  sfx.stop();
  setRate(1);
  const o = F.o, ok = o.ok, partial = o.partial;
  if (msg) setHud(F.alt, F.v, F.stage + 1, msg);
  const where = { leo: "Earth orbit", moon: "the Moon", mars: "Mars" }[o.target];
  const nums = `<div class="nums"><span>Weight ${o.total.toFixed(1)} t</span><span>Push ÷ weight ${o.twr.toFixed(2)}×</span><span>Speed budget ${((o.dv + o.bonus) / 1000).toFixed(2)} / ${(o.need / 1000).toFixed(1)} km/s</span><span>${esc(site.place.split(",")[0])} +${o.bonus} m/s</span></div>`;
  const el = $("#result");
  el.className = "result " + (ok ? "ok" : "bad");
  el.innerHTML = `<div class="card">
    <div class="em">${ok ? { leo: "🛰️", moon: "🌕", mars: "🔴" }[o.target] : partial ? "⚠️" : "💥"}</div>
    <h2>${ok ? { leo: "Mission success!", moon: "In orbit around the Moon!", mars: "In orbit around Mars!" }[o.target] : esc(o.fail.title)}</h2>
    <p class="why">${ok ? { leo: "Your satellite is in orbit 200 km up, moving at 7.8 km/s, with its solar panels open.", moon: "Your probe crossed 384,000 km in 3 days and braked into orbit 100 km above the Moon.", mars: "Your probe flew around the Sun for 7 months and braked into orbit 400 km above Mars." }[o.target] : esc(o.fail.why)}</p>
    ${ok ? "" : `<div class="fix"><b>How to fix it:</b> ${esc(o.fail.fix)}</div>`}
    ${nums}
    <div class="row">
      ${ok ? `<button class="primary" id="rNext">${o.target === "leo" ? "Next challenge: the Moon 🌕" : o.target === "moon" ? "Next challenge: Mars 🔴" : "Build another rocket"}</button>` : `<button class="primary" id="rFix">🔧 Fix my rocket</button>`}
      <button class="ghost" id="rAgain">🔁 Launch again</button><button class="ghost" id="rSite">🌍 Other site</button>
      ${ok && o.target !== "leo" ? `<a class="ghost" id="rExpl" href="planets/">Explore ${where} in 3D ↗</a>` : ""}
    </div></div>`;
  el.hidden = false;
  postMission(o, ok, partial);
  if (ok) confetti();
  const close = () => (el.hidden = true);
  el.querySelector("#rFix")?.addEventListener("click", () => { close(); setMode("build"); if (o.fail.part) setTimeout(() => flashPart(o.fail.part), 400); toast(o.fail.fix, 5000); });
  el.querySelector("#rNext")?.addEventListener("click", () => { close(); setMode("build"); toast(o.target === "leo" ? "Swap the satellite for the Moon probe: about 11.6 km/s needed. Try the 3-stage Moon sample." : o.target === "moon" ? "Mars needs 12.8 km/s: try the Mars sample (3 boosters, 3 stages) from an equator site." : "Try a different rocket or site!", 6500); });
  el.querySelector("#rExpl")?.addEventListener("click", (e) => { if (window.parent !== window) { e.preventDefault(); window.parent.postMessage({ source: "launch-lab", type: "navigate", to: o.target === "moon" ? "/moon" : "/mars" }, location.origin); } });
  el.querySelector("#rAgain").onclick = () => { close(); setMode("flight"); };
  el.querySelector("#rSite").onclick = () => { close(); setMode("site"); };
}
function postMission(o, ok, partial) {
  // Report the finished flight to the app shell so it can be persisted.
  if (window.parent === window) return;
  try {
    window.parent.postMessage({
      source: "launch-lab",
      type: "mission-complete",
      mission: {
        siteId: site.id,
        target: o.target,
        success: !!ok,
        partial: !!partial,
        speedBudgetMps: Math.round(o.dv + o.bonus),
        requiredSpeedMps: o.need,
        twr: Math.round(o.twr * 100) / 100,
        weightT: Math.round(o.total * 10) / 10,
        stages: o.stages.length,
        parts: stack.map((x) => x.id),
        failureCode: o.fail ? o.fail.code : null,
      },
    }, location.origin);
  } catch {}
}
function confetti() {
  const c = document.createElement("canvas");
  Object.assign(c.style, { position: "fixed", inset: 0, zIndex: 25, pointerEvents: "none" });
  c.width = innerWidth; c.height = innerHeight;
  document.body.appendChild(c);
  const g = c.getContext("2d"), bits = Array.from({ length: 160 }, () => ({ x: innerWidth / 2, y: innerHeight * 0.4, vx: rnd(9), vy: -Math.random() * 12 - 3, c: ["#ff7a2f", "#ffb347", "#3ddc84", "#6ea8ff", "#fff"][Math.floor(Math.random() * 5)], r: Math.random() * 6 + 3, a: Math.random() * 6 }));
  let n = 0;
  (function f() { g.clearRect(0, 0, c.width, c.height); for (const b of bits) { b.vy += 0.3; b.x += b.vx; b.y += b.vy; b.a += 0.2; g.save(); g.translate(b.x, b.y); g.rotate(b.a); g.fillStyle = b.c; g.fillRect(-b.r / 2, -b.r / 4, b.r, b.r / 2); g.restore(); } if (++n < 160) requestAnimationFrame(f); else c.remove(); })();
}
function toast(t, ms = 2600) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), ms); }

// ================================================================ sound (made in code)
const sfx = (() => {
  let ctx, noiseSrc, gain, filt;
  const init = () => {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0; for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    noiseSrc = ctx.createBufferSource(); noiseSrc.buffer = buf; noiseSrc.loop = true;
    filt = ctx.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = 400;
    gain = ctx.createGain(); gain.gain.value = 0;
    noiseSrc.connect(filt).connect(gain).connect(ctx.destination); noiseSrc.start();
  };
  const tone = (f, dur, type = "sine", vol = 0.15) => { if (!audioOn) return; init(); const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = f; g.gain.setValueAtTime(vol, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur); o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + dur); };
  return {
    click: () => tone(660, 0.08, "triangle", 0.06),
    thunk: () => tone(90, 0.35, "square", 0.12),
    start: () => { if (!audioOn) return; init(); ctx.resume(); },
    level: (k) => { if (!ctx || !audioOn) return; gain.gain.setTargetAtTime(0.9 * k * clamp(1 - (F?.alt || 0) / 80, 0.05, 1), ctx.currentTime, 0.1); filt.frequency.setTargetAtTime(250 + 500 * k, ctx.currentTime, 0.2); },
    stop: () => { if (ctx) gain.gain.setTargetAtTime(0, ctx.currentTime, 0.3); },
    boom: () => { if (!audioOn) return; init(); const g = ctx.createGain(); g.gain.setValueAtTime(1.4, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.5); const s = ctx.createBufferSource(); s.buffer = noiseSrc.buffer; const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 180; s.connect(f).connect(g).connect(ctx.destination); s.start(); s.stop(ctx.currentTime + 2.6); tone(50, 1.2, "sine", 0.4); },
  };
})();
$("#mute").onclick = () => { audioOn = !audioOn; $("#mute").textContent = audioOn ? "🔊" : "🔇"; if (!audioOn) sfx.stop(); };

// ================================================================ modes
let scene = build;
function setMode(m) {
  mode = m;
  document.querySelectorAll("[data-for]").forEach((el) => (el.hidden = el.dataset.for !== (m === "orbit" ? "flight" : m)));
  $("#launchcta").hidden = true;
  const idx = { build: 0, site: 1, flight: 2, orbit: 2 }[m];
  document.querySelectorAll("#steps li").forEach((li, i) => { li.classList.toggle("on", i === idx); li.classList.toggle("done", i < idx); });
  labels.domElement.style.display = m === "site" ? "" : "none";
  controls.enabled = true;
  controls.minDistance = 0.0001; controls.maxDistance = 1e6;
  bloom.strength = m === "build" ? 0.2 : 0.6; bloom.enabled = true;
  if (m !== "orbit") { trip.clear(); TRIP = null; globe.visible = true; pins.forEach((p) => (p.visible = m === "site")); }
  if (m === "build") {
    scene = build;
    camera.near = 0.1; camera.far = 1000; camera.updateProjectionMatrix();
    camera.position.set(18, 14, 26);
    rebuildRocket(); renderStack(); renderStats();
    controls.minDistance = 6; controls.maxDistance = 120;
    renderer.toneMappingExposure = 0.85;
  } else if (m === "site") {
    scene = space;
    camera.near = 0.01; camera.far = 3000; camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    camera.position.copy(dirLL(site.lat, site.lon).multiplyScalar(6.2));
    controls.minDistance = 2.6; controls.maxDistance = 14;
    renderer.toneMappingExposure = 1.0;
    renderSiteCard();
  } else if (m === "flight") {
    scene = flight;
    camera.near = 0.5; camera.far = 5e7; camera.updateProjectionMatrix();
    renderer.toneMappingExposure = 0.55;
    startFlight();
  } else if (m === "orbit") {
    scene = space;
    camera.near = 0.00005; camera.far = 3000; camera.updateProjectionMatrix();
    controls.enabled = false;
    renderer.toneMappingExposure = 1.0;
  }
  renderPass.scene = scene;
}
$("#toSite").onclick = () => setMode("site");
$("#backBuild").onclick = () => setMode("build");
$("#toLaunch").onclick = () => setMode("flight");
document.querySelectorAll("#steps li").forEach((li) => (li.onclick = () => {
  const m = li.dataset.m;
  if (m === "build") setMode("build");
  else if (m === "site" && stack.length) setMode("site");
  else if (m === "flight" && stack.length) setMode("flight");
}));

// ================================================================ loop
const clock = new THREE.Clock();
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05) * SPEEDUP();
  if (mode === "build" && buildRocket) buildRocket.rotation.y += dt * 0.12;
  if (mode === "site" || mode === "orbit") {
    globe.userData.clouds.rotation.y += dt * 0.004;
    if (mode === "site") {
      if (camFly) { camFly.t = Math.min(1, camFly.t + dt * 1.2); camera.position.copy(camFly.from.clone().normalize().lerp(camFly.to.clone().normalize(), ease(camFly.t)).normalize().multiplyScalar(lerp(camFly.from.length(), camFly.to.length(), ease(camFly.t)))); if (camFly.t >= 1) camFly = null; }
      setSun(camera.position.clone().normalize().applyAxisAngle(V(0, 1, 0), 0.6).add(V(0, 0.3, 0)).normalize());
      const cd = camera.position.clone().normalize();
      pins.forEach((p) => { const front = p.getWorldPosition(V()).normalize().dot(cd) > 0.12; p.userData.lab.visible = front; });
    }
    if (mode === "orbit") { globe.rotation.y += dt * 0.01; tripStep(dt); if (F?.phase === "after" && !F.done) F.tm2 += dt; }
  }
  if (mode === "flight" && F) {
    flightStep(dt);
    if (mode === "flight") {
      const a = F.alt; // km
      // sky: blue → dark as the air thins; stars come out
      const k = clamp((a - 8) / 55, 0, 1);
      skyU.rayleigh.value = lerp(2.4, 0.0, k); skyU.mieCoefficient.value = lerp(0.003, 0, k); skyU.turbidity.value = lerp(2.2, 0.1, k);
      sky.visible = k < 0.999;
      sky.position.copy(camera.position);
      fStars.material.opacity = clamp((a - 30) / 40, 0, 0.95);
      fStars.position.copy(camera.position);
      bigGround.material.uniforms.hazeDensity.value = lerp(0.00009, 0, clamp(a / 40, 0, 1));
      bigGround.material.uniforms.sunDir.value.copy(SUN);
      if (hdPatch) { hdPatch.material.uniforms.sunDir.value.copy(SUN); hdPatch.material.uniforms.hazeDensity.value = bigGround.material.uniforms.hazeDensity.value; }
      bigAtmo.material.uniforms.sunDir.value.copy(SUN);
      localGround.material.opacity = clamp(1 - a / 6, 0, 1);
      fHemi.intensity = lerp(0.6, 0.12, k);
      renderer.toneMappingExposure = lerp(0.5, 0.9, k);
      // glow only once the sky is dark (the bright daytime sky would bloom everything white)
      bloom.strength = lerp(0, 0.65, clamp((a - 15) / 40, 0, 1)); bloom.enabled = bloom.strength > 0.01;
      // camera rides with the rocket (offset smoothed, never the position)
      if (F.phase !== "ready" && F.phase !== "countdown") {
        const tgt = F.root.visible ? F.root.position.clone().addScaledVector(F.dir || V(0, 1, 0), F.rk.userData.height * 0.5) : controls.target.clone();
        const h = F.rk.userData.height, dist = h * 2.2 + 18 + Math.min(a * 0.12, 16);
        const up = F.up || V(0, 1, 0), fwd = F.fwd || V(1, 0, 0);
        const want = F.tm < 12 ? up.clone().multiplyScalar(-dist * 0.12).addScaledVector(fwd, dist * 0.55).add(V(0, 0, dist * 1.25)) : up.clone().multiplyScalar(dist * 0.18).addScaledVector(fwd, -dist * 0.55).add(V(0, 0, dist));
        F.camOff = (F.camOff || camera.position.clone().sub(tgt)).lerp(want, 1 - Math.exp(-dt * 1.2));
        if (!F.freeCam) { controls.target.copy(tgt); camera.position.copy(tgt).add(F.camOff); camera.up.copy(up); }
        if (F.phase === "after" && !F.freeCam && F.tm2 > 1.5) { F.freeCam = true; controls.enabled = true; }
      } else camera.up.set(0, 1, 0);
      const fp = F.root.position;
      fSun.target.position.copy(fp); fSun.position.copy(fp).addScaledVector(SUN, 200);
    }
  } else camera.up.set(0, 1, 0);
  controls.update();
  composer.render();
  if (mode === "site") labels.render(space, camera);
  requestAnimationFrame(loop);
}
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); labels.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  [fire, smoke, sparks].forEach((p) => (p.points.material.uniforms.scale.value = innerHeight / 2));
});
setMode("build");
if (!stack.length) toast("Build your rocket: tap parts on the left, from the bottom up. Or load a sample.", 5000);
loop();
document.querySelector(".top .navlink")?.addEventListener("click", (e) => {
  if (window.parent !== window) { e.preventDefault(); window.parent.postMessage({ source: "launch-lab", type: "navigate", to: "/moon" }, location.origin); }
});
window.__ll = { bloom, renderer, skyU, get bigGround() { return bigGround; }, get stack() { return stack; }, set stack(s) { stack = s; changed(); }, setMode, chooseSite: (id) => chooseSite(SITES.find((s) => s.id === id)), get F() { return F; }, get TRIP() { return TRIP; }, outcome: () => outcome(stack, site) };
