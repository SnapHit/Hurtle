/* ==========================================================================
   NIGHT CIRCUIT

   The portal renderer. Exports init(canvas, overlayRoot) and render(view).
   It never runs on the live site, which keeps its 2D painter and loads
   nothing from here.

   Ported from tools/hd-reference/anim.html, which produced every still that
   was reviewed and approved. The numbers in this file are that file's numbers.
   The difference is that anim.html rebuilt a whole recorded world up front and
   this draws a live one: the view brings a window of track, towers, gaps and
   tunnels each frame, and this builds what arrives and drops what falls behind.
   Anything random on this side comes from a hash of where the thing is, so the
   same world looks the same no matter which frame first brought it in. Nothing
   here reads or writes the simulation; render(view) only reads the snapshot.
   ========================================================================== */
import * as THREE from 'three';
import { createScreens } from './screens.js';
import { EffectComposer } from './vendor/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from './vendor/postprocessing/ShaderPass.js';
import { OutputPass } from './vendor/postprocessing/OutputPass.js';
import { RGBShiftShader } from './vendor/shaders/RGBShiftShader.js';

/* ---------------- palette, by speed tier (W7) ---------------- */
const TIERS = [
  // realistic sky only, getting later as you go faster: golden hour, sunset, after sunset, blue hour, night, deep night
  { top: 0x1c4688, mid: 0x4f84c4, hor: 0xf4b47a, low: 0x5c6684, fog: 0x6a6c88, sun: 1.0,  stars: 0.0,  hemi: 0.95, hemiSky: 0x9ab8e8, dir: 0xffc48a, dirI: 1.3,  win: 0.35, bloom: 0.5,  accent: 0xff9a40, cloud: 0xc89a84 },  // DRIFT
  { top: 0x182e6a, mid: 0x5a5c9c, hor: 0xff8a48, low: 0x4c3a56, fog: 0x523e58, sun: 0.85, stars: 0.0,  hemi: 0.8,  hemiSky: 0x8a90d0, dir: 0xff9a60, dirI: 1.1,  win: 0.5,  bloom: 0.58, accent: 0xff7a40, cloud: 0xb0706a },  // RUSH
  { top: 0x101a48, mid: 0x34387a, hor: 0xc86a5c, low: 0x2a2442, fog: 0x2c2644, sun: 0.35, stars: 0.15, hemi: 0.65, hemiSky: 0x6a70b8, dir: 0xc08aa0, dirI: 0.7,  win: 0.65, bloom: 0.66, accent: 0xff5a7a, cloud: 0x5e4a6a },  // PLUNGE
  { top: 0x0a1238, mid: 0x1e2a62, hor: 0x4a5a9a, low: 0x141a36, fog: 0x161c38, sun: 0.1,  stars: 0.55, hemi: 0.55, hemiSky: 0x4a5ab0, dir: 0x8a9cff, dirI: 0.55, win: 0.78, bloom: 0.74, accent: 0x5ab8ff, cloud: 0x343a68 },  // FREEFALL
  { top: 0x04060f, mid: 0x0a1028, hor: 0x1c2648, low: 0x070a18, fog: 0x0a0e1e, sun: 0.0,  stars: 1.0,  hemi: 0.5,  hemiSky: 0x3a44a0, dir: 0x8a9cff, dirI: 0.5,  win: 0.85, bloom: 0.78, accent: 0x2ee0ff, cloud: 0x3a3048 },  // TERMINAL
  { top: 0x020308, mid: 0x060a1a, hor: 0x10183a, low: 0x04050c, fog: 0x05070f, sun: 0.0,  stars: 1.0,  hemi: 0.45, hemiSky: 0x2a3490, dir: 0x8a9cff, dirI: 0.45, win: 0.9,  bloom: 0.8,  accent: 0xffffff, cloud: 0x2a2436 }   // ESCAPE VELOCITY
];
const TIER_BLEND_T = 2.5;        // s, smoothstep (W7)

/* ---------------- quality (D4; the switch lands in phase 5) ---------------- */
const Q = { bloom: true, boards: true, traffic: true, beams: true, prCap: 2, cloudMul: 1, streakMul: 1 };

/* ---------------- streaming geometry ---------------- */
const CZ   = 360;          // z per road chunk: 20 slices of 18
const CT   = 600;          // z per tower chunk
const T    = 26;           // the deck's thickness, as drawn
const RW = 9, RH = 5;      // rail width and height
const LANE_Z = 700, BEAM_Z = 1000, CRAFT_Z = 1400, CLOUD_Z = 250;
const BEHIND = 1200;       // road kept this far behind the camera: the title's high camera sees the deck under it
const ROAD_AHEAD = 1100;   // road built this far past the view distance, as the reference did, so fog ends it rather than an edge.
                           //   The view supplies slices to far + 900, so above 3600 the last chunk waits for them; the end is still fogged.

/* ---------------- random, but tied to place rather than to order ---------------- */
function hash(a, b, c) {
  let h = (Math.imul(Math.floor(a * 7.13) | 0, 374761393) ^ Math.imul(Math.floor(b * 3.71) | 0, 668265263) ^ Math.imul((c | 0) + 1, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/* the sequential stream anim.html used for its textures, same seed */
const R = (() => { let s = 1234567; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
const V = (x, y, z) => new THREE.Vector3(x, y, -z);
const P3 = (x, y, z) => [x, y, -z];

/* ---------------- state ---------------- */
let renderer = null, scene = null, cam = null, composer = null, bloom = null, rgb = null, gl = null, uiRoot = null;
let sky = null, skyU = null, hemi = null, moon = null;
let W = 0, H = 0, ZOOM = 1, DPR = 1, PXW = 0, PXH = 0;
let winLevel = 0.75, bloomBase = 0.75;
let tierFrom = 0, lastTier = 0, tierBlend = 1, haveTier = false;
let SL = [];                           // this frame's slices, sorted by z
let SL0 = 0, SLDZ = 18;
let world = { gaps: [], tunnels: [] };
const dummy = new THREE.Object3D();
const stats = { chunks: 0, towerChunks: 0, towers: 0, lanes: 0, beams: 0, crafts: 0, clouds: 0, rings: 0, lips: 0, calls: 0, tris: 0, drops: 0, builds: 0, towerBuilds: 0 };

/* ---------------- track helpers over this frame's slices ---------------- */
function tr(z) {
  const n = SL.length;
  if (!n) return { cx: 0, hw: 120, y: 0, bank: 0 };
  let i = Math.floor((z - SL0) / SLDZ);
  if (i < 0) i = 0; if (i > n - 2) i = n - 2;
  const a = SL[i], b = SL[Math.min(i + 1, n - 1)];
  const f = b.z > a.z ? Math.min(1, Math.max(0, (z - a.z) / (b.z - a.z))) : 0;
  return { cx: a.cx + (b.cx - a.cx) * f, hw: a.hw + (b.hw - a.hw) * f, y: a.y + (b.y - a.y) * f, bank: a.bank + (b.bank - a.bank) * f };
}
const surf = (z, x) => { const t = tr(z); return t.y + t.bank * (t.cx - x); };
const gapAt = z => world.gaps.some(g => z >= g.z0 && z <= g.z1);
const inTunnel = z => world.tunnels.some(t => z > t.z0 && z < t.z1);
function frameAt(z, x) {
  const p0 = V(x, surf(z - 10, x), z - 10), p1 = V(x, surf(z + 10, x), z + 10);
  const pl = V(x - 10, surf(z, x - 10), z), pr = V(x + 10, surf(z, x + 10), z);
  const fwd = p1.clone().sub(p0).normalize(), right = pr.clone().sub(pl).normalize();
  return { fwd, right, up: new THREE.Vector3().crossVectors(right, fwd).normalize() };
}

/* ---------------- canvas textures ---------------- */
function tex(w, h, paint, ru = 1, rv = 1, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(ru, rv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.userData.canvas = c; return t;
}
function noise(c, w, h, base, amt, n) { c.fillStyle = base; c.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) { const v = (R() - 0.5) * amt; c.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`; c.fillRect(R() * w, R() * h, 1 + R() * 2, 1 + R() * 2); } }
const radial = (col, a0 = 1) => tex(128, 128, (c, w, h) => { const g = c.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, col.replace('A', a0)); g.addColorStop(0.35, col.replace('A', a0 * 0.45)); g.addColorStop(1, col.replace('A', 0)); c.fillStyle = g; c.fillRect(0, 0, w, h); });

let roadMat, sideMat, railMat, pulse, chevMat, faceMat, ringMouthMat, ringMat, wallMat, winMats, spireMat, beaconMesh, boardTexs, boardMats, carGeo, carMatW, carMatR, cloudMat, cloudTex;
let GLOW_C, GLOW_M, GLOW_W, GLOW_O, GLOW_G;

/* ---------------- the actors: obstacles, ball, shield, pickup, particles, deaths ---------------- */
const KIND_COL = [0xff2e88, 0xff2e88, 0xffb020, 0x9a6aff];     // O1 static, O2 sliding, O3 rising, O4 dropping
const OB = new Map();                                            // obstacles by the view's id
let edgeTex, arrowTex, haloTex, shadowTex, BR = 20;
let ball, ballLight, ballGlow, shadow, shield, burstRing, pick, crystal, pickBeam, pickHalo, pickRing;
let trail = [], hist = [], TRN = 22;
let spkGeo, spkPos, sparksPts, shardMesh, fragMesh, frag = [], deathEdge, shock, streaks, stGeo, stPos, stSeed = [], NST = 260, lipDeadMat;
let prevView = null, flashT = -1, burstT = -1, shockT = -1, fragT = -1, fallShakeT = -1, killerId = null, deadLip = null;
let vig = null, vigBg = null, screens = null;
const SPK = 600;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _m = new THREE.Matrix4(), _c1 = new THREE.Color(), _c2 = new THREE.Color(), _c3 = new THREE.Color();

function buildMaterials() {
  const roadMap = tex(512, 512, (c, w, h) => { noise(c, w, h, '#14161d', 0.16, 16000);
    c.fillStyle = 'rgba(255,255,255,0.03)'; for (let y = 0; y < h; y += 128) c.fillRect(0, y, w, 3); });
  const roadEm = tex(512, 512, (c, w, h) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#29d8ff'; for (const u of [1 / 3, 2 / 3]) for (let y = 0; y < h; y += 128) c.fillRect(u * w - 3, y, 6, 66);
    c.fillStyle = 'rgba(41,216,255,0.22)'; c.fillRect(0, 0, w, 3); });
  const roadRough = tex(256, 256, (c, w, h) => { noise(c, w, h, '#5a5a5a', 0.5, 6000); }, 1, 1, false);
  /* T1: glossy dark surface reflecting the night environment, cyan dashes at thirds, a faint grid */
  roadMat = new THREE.MeshStandardMaterial({ map: roadMap, emissiveMap: roadEm, emissive: 0xffffff, emissiveIntensity: 0.85, roughness: 0.22, roughnessMap: roadRough, metalness: 0.55, side: THREE.DoubleSide });
  sideMat = new THREE.MeshStandardMaterial({ color: 0x0b0d16, roughness: 0.45, metalness: 0.7, side: THREE.DoubleSide,
    emissiveMap: tex(16, 64, (c, w, h) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); c.fillStyle = '#ff6a10'; c.fillRect(0, 0, w, 5); }), emissive: 0xffffff, emissiveIntensity: 0.6 });
  /* T2: light strips with pulses running downhill */
  pulse = tex(16, 256, (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#ff5a00'); g.addColorStop(0.75, '#ff7a1a'); g.addColorStop(0.9, '#ffe2b0'); g.addColorStop(1, '#ff5a00'); c.fillStyle = g; c.fillRect(0, 0, w, h); });
  railMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xffffff, emissiveMap: pulse, emissiveIntensity: 2.0, roughness: 0.4, side: THREE.DoubleSide });
  /* T3: chevrons on both lips of every hole, and the lit cut face */
  const chevTex = tex(256, 64, (c, w, h) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffd23a';
    for (let x = -40; x < w + 40; x += 48) { c.beginPath(); c.moveTo(x, h); c.lineTo(x + 20, h); c.lineTo(x + 44, h / 2); c.lineTo(x + 20, 0); c.lineTo(x, 0); c.lineTo(x + 24, h / 2); c.closePath(); c.fill(); } });
  chevMat = new THREE.MeshBasicMaterial({ map: chevTex, color: 0xffffff, transparent: true });
  faceMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
  /* T4: the mouth frame, the dim rings, the dark glass walls */
  ringMouthMat = new THREE.MeshStandardMaterial({ color: 0x0a0c14, emissive: 0x18d0ff, emissiveIntensity: 1.8, roughness: 0.5, metalness: 0.5 });
  ringMat = new THREE.MeshStandardMaterial({ color: 0x0a0c14, emissive: 0x1870c0, emissiveIntensity: 0.25, roughness: 0.5, metalness: 0.5 });
  wallMat = new THREE.MeshStandardMaterial({ color: 0x0a0c14, roughness: 0.55, metalness: 0.5, side: THREE.DoubleSide });
  /* W1: four window patterns, one material each so the repeat can live in the UVs */
  const winTexs = [0, 1, 2, 3].map(() => tex(128, 512, (c, w, h) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    for (let y = 6; y < h; y += 14) for (let x = 6; x < w; x += 16) if (R() < 0.3) { const p = R(); c.fillStyle = p < 0.7 ? '#ffd29a' : (p < 0.85 ? '#7fe8ff' : '#ff8fd0'); c.fillRect(x, y, 9, 7); } }));
  winMats = winTexs.map(wt => new THREE.MeshStandardMaterial({ color: 0x0b1222, roughness: 0.18, metalness: 0.75, emissiveMap: wt, emissive: 0xffffff, emissiveIntensity: 0.75 }));
  spireMat = new THREE.MeshStandardMaterial({ color: 0x000223, emissive: 0x2ee0ff, emissiveIntensity: 1.5 });
  beaconMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(5, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), 320);
  beaconMesh.frustumCulled = false; beaconMesh.count = 0; scene.add(beaconMesh);
  /* W4: three animated abstract patterns, repainted at most 15 times a second */
  boardTexs = [0, 1, 2].map(() => tex(256, 128, () => {}));
  boardMats = boardTexs.map(bt => new THREE.MeshBasicMaterial({ map: bt, color: 0xffffff, fog: true }));
  /* W2 */
  carGeo = new THREE.BoxGeometry(14, 3, 5);
  carMatW = new THREE.MeshBasicMaterial({ color: 0xfff4e0 }); carMatR = new THREE.MeshBasicMaterial({ color: 0xff3040 });
  /* W6 */
  cloudTex = tex(256, 128, (c, w, h) => { for (let i = 0; i < 40; i++) { const x = 30 + R() * (w - 60), y = 40 + R() * (h - 70), r = 18 + R() * 30;
    const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); } });
  cloudMat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, opacity: 0.8 });
  GLOW_C = radial('rgba(80,230,255,A)'); GLOW_M = radial('rgba(255,60,160,A)'); GLOW_W = radial('rgba(255,255,255,A)');
  GLOW_O = radial('rgba(255,150,60,A)'); GLOW_G = radial('rgba(60,255,140,A)');
}
function paintBoards(t) {
  boardTexs.forEach((bt, k) => { const c = bt.userData.canvas.getContext('2d'), w = 256, h = 128;
    c.fillStyle = '#05010a'; c.fillRect(0, 0, w, h);
    if (k === 0) { for (let i = 0; i < 12; i++) { const y = ((i * 22 + t * 90) % (h + 40)) - 20; const g = c.createLinearGradient(0, y, w, y); g.addColorStop(0, '#ff2e88'); g.addColorStop(1, '#2ee0ff'); c.fillStyle = g; c.globalAlpha = 0.85; c.fillRect(0, y, w, 8); } }
    if (k === 1) { c.lineWidth = 6; for (let i = 0; i < 4; i++) { c.strokeStyle = ['#2ee0ff', '#ff2e88', '#ffb020', '#8a5aff'][i]; c.beginPath();
        for (let x = 0; x <= w; x += 8) c.lineTo(x, h / 2 + Math.sin(x * 0.04 + t * (2 + i) + i) * (20 + i * 8)); c.stroke(); } }
    if (k === 2) { const n = 8; for (let i = 0; i < n; i++) { const v = 0.5 + 0.5 * Math.sin(t * 4 + i * 1.3); c.fillStyle = i % 2 ? '#2ee0ff' : '#ff8a2a'; c.fillRect(i * w / n + 4, h - v * h, w / n - 8, v * h); } }
    c.globalAlpha = 1; bt.needsUpdate = true; });
}

function buildActors(K) {
  BR = K.BALL_R * 1.9;                                            // D1: drawn at 1.9 times true size; collision unchanged
  edgeTex = tex(256, 256, (c, w, h) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); c.strokeStyle = '#ffffff'; c.lineWidth = 16; c.strokeRect(0, 0, w, h);
    c.lineWidth = 3; c.globalAlpha = 0.35; for (let y = 40; y < h; y += 40) { c.beginPath(); c.moveTo(16, y); c.lineTo(w - 16, y); c.stroke(); } });
  arrowTex = tex(128, 128, (c, w, h) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff';
    for (const x of [10, 52]) { c.beginPath(); c.moveTo(x, 20); c.lineTo(x + 30, 20); c.lineTo(x + 66, 64); c.lineTo(x + 30, 108); c.lineTo(x, 108); c.lineTo(x + 36, 64); c.closePath(); c.fill(); } });
  haloTex = radial('rgba(255,60,160,A)'); shadowTex = radial('rgba(0,0,0,A)', 0.85);
  /* E1: metallic silver, a soft white light, a contact shadow, a trail of fading sprites */
  ball = new THREE.Mesh(new THREE.SphereGeometry(BR, 48, 32), new THREE.MeshPhysicalMaterial({ color: 0xd4d8de, metalness: 1.0, roughness: 0.16, clearcoat: 0.6,
    emissiveMap: tex(256, 128, (c, w, h) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.fillRect(0, h / 2 - 5, w, 10); for (let x = 0; x < w; x += 64) c.fillRect(x, 0, 6, h); }),
    emissive: 0xffffff, emissiveIntensity: 0 }));
  scene.add(ball);
  ballLight = new THREE.PointLight(0xdfe8ff, 5000, 360, 1.7); scene.add(ballLight);
  ballGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_W, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.18 })); scene.add(ballGlow);
  for (let i = 0; i < TRN; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_W, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); scene.add(s); trail.push(s); }
  shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })); scene.add(shadow);
  /* E4: a slowly turning green wireframe cage with a rim glow */
  shield = new THREE.Group();
  shield.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(BR * 1.85, 1)), new THREE.LineBasicMaterial({ color: 0x5cff9a, transparent: true, opacity: 0.9 })));
  shield.add(new THREE.Mesh(new THREE.SphereGeometry(BR * 1.8, 32, 16), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.5); gl_FragColor = vec4(0.25, 1.0, 0.55, f * 0.9); }` })));
  scene.add(shield);
  /* E3: the collect ring */
  burstRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64), new THREE.MeshBasicMaterial({ color: 0x5cff9a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  burstRing.visible = false; scene.add(burstRing);
  /* E2: the pickup, a crystal with a ring, a halo and a tall beam */
  pick = new THREE.Group();
  crystal = new THREE.Mesh(new THREE.OctahedronGeometry(14, 0), new THREE.MeshStandardMaterial({ color: 0x2bff7a, emissive: 0x2bff7a, emissiveIntensity: 1.8, roughness: 0.2, metalness: 0.3, flatShading: true }));
  pick.add(crystal);
  pickBeam = new THREE.Mesh((() => { const g = new THREE.CylinderGeometry(10, 22, 900, 16, 1, true); g.translate(0, 450, 0); return g; })(), beamMat()); pickBeam.material.uniforms.col.value.set(0x40ff90); pick.add(pickBeam);
  pickHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_G, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); pickHalo.scale.set(110, 110, 1); pick.add(pickHalo);
  pickRing = new THREE.Mesh(new THREE.TorusGeometry(26, 1.6, 8, 48), new THREE.MeshBasicMaterial({ color: 0x5cff9a })); pick.add(pickRing);
  pick.visible = false; scene.add(pick);
  /* E6: the game's own sparks as additive points; the game's own shards; the crash fragments */
  spkPos = new Float32Array(SPK * 3); spkGeo = new THREE.BufferGeometry(); spkGeo.setAttribute('position', new THREE.BufferAttribute(spkPos, 3)); spkGeo.setDrawRange(0, 0);
  sparksPts = new THREE.Points(spkGeo, new THREE.PointsMaterial({ map: GLOW_O, size: 14, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffd0a0 }));
  sparksPts.frustumCulled = false; scene.add(sparksPts);
  shardMesh = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(7), new THREE.MeshStandardMaterial({ color: 0x220812, emissive: 0xff2e88, emissiveIntensity: 2.2 }), 200);
  shardMesh.frustumCulled = false; shardMesh.count = 0; scene.add(shardMesh);
  fragMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(3.2, 0), new THREE.MeshStandardMaterial({ color: 0xbfefff, emissive: 0x2ee0ff, emissiveIntensity: 2.5, metalness: 0.9, roughness: 0.2 }), 140);
  fragMesh.frustumCulled = false; fragMesh.count = 0; scene.add(fragMesh);
  /* E9: the stretch of edge you went over; E8: the tier shockwave */
  deathEdge = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xff2040, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })); deathEdge.visible = false; deathEdge.frustumCulled = false; scene.add(deathEdge);
  lipDeadMat = new THREE.MeshBasicMaterial({ map: chevMat.map, color: 0xff2040, transparent: true });
  shock = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 96), new THREE.MeshBasicMaterial({ color: 0xff9a40, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); shock.visible = false; scene.add(shock);
  /* E7: rain-like streaks past the camera, denser and longer with speed */
  stPos = new Float32Array(NST * 6); for (let i = 0; i < NST; i++) stSeed.push([hash(i, 13, 1) * Math.PI * 2, 60 + hash(i, 13, 2) * 420, hash(i, 13, 3) * 1400, 0.5 + hash(i, 13, 4)]);
  stGeo = new THREE.BufferGeometry(); stGeo.setAttribute('position', new THREE.BufferAttribute(stPos, 3));
  streaks = new THREE.LineSegments(stGeo, new THREE.LineBasicMaterial({ color: 0xbfefff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  streaks.frustumCulled = false; scene.add(streaks);
  vig = document.createElement('div'); vig.id = 'hdvig'; vig.style.cssText = 'position:absolute;inset:0;pointer-events:none'; uiRoot.appendChild(vig);
}
function obstacle(o) {
  let e = OB.get(o.id); if (e) return e;
  const col = KIND_COL[o.kind] ?? 0xff2e88;
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, OBST_D), new THREE.MeshStandardMaterial({ color: 0x0c0612, metalness: 0.6, roughness: 0.15, emissiveMap: edgeTex, emissive: col, emissiveIntensity: 2.6 }));
  g.add(box);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(1, OBST_D * 0.6), new THREE.MeshBasicMaterial({ map: arrowTex, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  top.rotation.x = -Math.PI / 2; top.visible = o.kind === 1; g.add(top);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(1, OBST_D * 1.2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
  pad.visible = o.kind >= 2; scene.add(pad);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.35 }));
  g.add(halo);
  scene.add(g);
  e = { g, box, top, pad, halo, lastX: o.x, col, unseen: 0 }; OB.set(o.id, e); return e;
}
function dropObstacle(id, e) {
  scene.remove(e.g, e.pad);
  e.box.geometry.dispose(); e.box.material.dispose(); e.top.geometry.dispose(); e.top.material.dispose(); e.pad.geometry.dispose(); e.pad.material.dispose(); e.halo.material.dispose();
  OB.delete(id);
}
let OBST_D = 78, OBST_H = 42;
function resetRun() {
  hist.length = 0; frag.length = 0; fragT = -1; flashT = -1; burstT = -1; fallShakeT = -1; killerId = null;
  fragMesh.count = 0; deathEdge.visible = false; burstRing.visible = false;
  if (deadLip) { for (const m of deadLip.meshes) if (m.material === lipDeadMat) m.material = chevMat; deadLip = null; }
  ball.material.emissiveIntensity = 0; ballGlow.material.opacity = 0.18;
  for (const [id, e] of OB) dropObstacle(id, e);
}

/* ---------------- a strip of quads between two edge functions, over some slices ---------------- */
function strip(sl, fnL, fnR, uvScale, skipGaps, into) {
  const pos = into ? into.pos : [], uv = into ? into.uv : [];
  for (let i = 0; i < sl.length - 1; i++) {
    const a = sl[i], b = sl[i + 1];
    if (skipGaps && gapAt((a.z + b.z) / 2)) continue;
    pos.push(...fnL(a), ...fnR(a), ...fnL(b), ...fnR(a), ...fnR(b), ...fnL(b));
    const va = a.z / uvScale, vb = b.z / uvScale;
    uv.push(0, va, 1, va, 0, vb, 1, va, 1, vb, 0, vb);
  }
  if (into) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals(); return g;
}
const edgeY = (s, side) => s.y - side * s.bank * s.hw;
const yAt = (s, x) => s.y + s.bank * (s.cx - x);

/* ---------------- road chunks: deck, sides, rails, tunnel walls, rings ---------------- */
const chunks = new Map();
/* The world can be regenerated under the same z range: a restart, or the
   settings preview rebuilding the title track. Every cache here is keyed by z
   and assumes a slice at a given z never changes, so each built chunk keeps a
   fingerprint of its first slice and the lot is dropped the moment one of them
   no longer matches what the view brings. */
function slicePrint(s) { return s.z + ':' + s.cx.toFixed(2) + ':' + s.y.toFixed(2) + ':' + s.hw.toFixed(2); }
function worldChanged() {
  for (const ch of chunks.values()) {
    if (!ch.print) continue;
    const i = Math.round((ch.printZ - SL0) / SLDZ);
    if (i < 0 || i >= SL.length) continue;
    if (slicePrint(SL[i]) !== ch.print) return true;
  }
  return false;
}
function dropWorld() {
  for (const ch of chunks.values()) disposeGroup(ch.g); chunks.clear();
  for (const l of lips.values()) for (const m of l.meshes) { m.geometry.dispose(); scene.remove(m); } lips.clear();
  for (const tc of towerChunks.values()) disposeGroup(tc.g); towerChunks.clear();
  for (const L of lanes.values()) { scene.remove(L.m); L.m.dispose(); } lanes.clear();
  for (const b of beams.values()) { scene.remove(b.m); b.m.material.dispose(); } beams.clear();
  for (const c of crafts.values()) { scene.remove(c.g, c.trail); c.trail.geometry.dispose(); c.trail.material.dispose(); c.g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); } crafts.clear();
  for (const c of clouds.values()) scene.remove(c.sp); clouds.clear();
  deadLip = null;
}
function chunkSig(z0, z1) {
  let s = '';
  for (const g of world.gaps) if (g.z1 >= z0 && g.z0 <= z1) s += 'g' + g.z0.toFixed(1);
  for (const t of world.tunnels) if (t.z1 >= z0 && t.z0 <= z1) s += 't' + t.z0.toFixed(1);
  return s;
}
function disposeGroup(g) {
  g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.userData.own) o.material.dispose(); });
  scene.remove(g);
}
function buildChunk(ci) {
  const z0 = ci * CZ, z1 = z0 + CZ;
  const i0 = Math.max(0, Math.floor((z0 - SL0) / SLDZ) - 1), i1 = Math.min(SL.length - 1, Math.ceil((z1 - SL0) / SLDZ) + 1);
  if (i1 - i0 < 2) return null;
  const sl = SL.slice(i0, i1 + 1);
  const g = new THREE.Group(); g.name = 'chunk' + ci;
  g.add(new THREE.Mesh(strip(sl, s => P3(s.cx - s.hw, edgeY(s, -1), s.z), s => P3(s.cx + s.hw, edgeY(s, 1), s.z), 240, true), roadMat));
  /* both sides and all six rail strips go into one geometry each: one draw call per material per chunk */
  const sides = { pos: [], uv: [] }, rails = { pos: [], uv: [] };
  for (const side of [-1, 1]) {
    strip(sl, s => P3(s.cx + side * s.hw, edgeY(s, side), s.z), s => P3(s.cx + side * s.hw, edgeY(s, side) - T, s.z), 200, true, sides);
    const out = s => s.cx + side * s.hw, inn = s => s.cx + side * (s.hw - RW);
    strip(sl, s => P3(inn(s), yAt(s, inn(s)) + RH, s.z), s => P3(out(s), yAt(s, out(s)) + RH, s.z), 420, true, rails);
    strip(sl, s => P3(inn(s), yAt(s, inn(s)), s.z), s => P3(inn(s), yAt(s, inn(s)) + RH, s.z), 420, true, rails);
    strip(sl, s => P3(out(s), yAt(s, out(s)) - 4, s.z), s => P3(out(s), yAt(s, out(s)) + RH, s.z), 420, true, rails);
  }
  for (const [part, mat] of [[sides, sideMat], [rails, railMat]]) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(part.pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(part.uv, 2));
    geo.computeVertexNormals(); g.add(new THREE.Mesh(geo, mat));
  }
  /* T4: walls and roof for any tunnel crossing this chunk, and its rings */
  const rings = [];
  for (const tn of world.tunnels) {
    if (tn.z1 < z0 || tn.z0 > z1) continue;
    const roof = [], wl = [], wr = [];
    for (let i = 0; i < sl.length - 1; i++) { const a = sl[i], b = sl[i + 1]; if (a.z < tn.z0 || b.z > tn.z1) continue;
      const la = a.cx - a.hw - 35, ra = a.cx + a.hw + 35, lb = b.cx - b.hw - 35, rb = b.cx + b.hw + 35, ya = a.y + 250, yb = b.y + 250;
      roof.push(la, ya, -a.z, ra, ya, -a.z, lb, yb, -b.z, ra, ya, -a.z, rb, yb, -b.z, lb, yb, -b.z);
      for (const [side, arr] of [[-1, wl], [1, wr]]) { const xa = a.cx + side * (a.hw + 35), xb = b.cx + side * (b.hw + 35);
        arr.push(xa, a.y - T, -a.z, xa, a.y + 250, -a.z, xb, b.y - T, -b.z, xa, a.y + 250, -a.z, xb, b.y + 250, -b.z, xb, b.y - T, -b.z); } }
    for (const arr of [roof, wl, wr]) if (arr.length) { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); geo.computeVertexNormals(); g.add(new THREE.Mesh(geo, wallMat)); }
    for (let z = tn.z0, k = 0; z < tn.z1; z += 150, k++) {
      if (z < z0 || z >= z1) continue;
      const s = tr(z), w = s.hw * 2 + 70, h = 250, o = k === 0 ? 16 : 7, mouth = k === 0;
      const shape = new THREE.Shape();
      shape.moveTo(-w / 2 - o, -T); shape.lineTo(w / 2 + o, -T); shape.lineTo(w / 2 + o, h + o); shape.lineTo(-w / 2 - o, h + o);
      const hole = new THREE.Path(); hole.moveTo(-w / 2, -T + 1); hole.lineTo(-w / 2, h); hole.lineTo(w / 2, h); hole.lineTo(w / 2, -T + 1); shape.holes.push(hole);
      const mat = mouth ? ringMouthMat : ringMat.clone(); if (!mouth) mat.userData.own = true;
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: mouth ? 40 : 10, bevelEnabled: false }), mat);
      m.position.copy(V(s.cx, s.y, z)); m.rotation.z = Math.atan(-s.bank);
      g.add(m); rings.push({ m, z, mouth });
    }
  }
  scene.add(g);
  const first = sl[Math.min(1, sl.length - 1)];
  return { g, rings, sig: chunkSig(z0, z1), z0, z1, print: slicePrint(first), printZ: first.z };
}
function streamChunks(camZ, far) {
  const c0 = Math.floor((camZ - BEHIND) / CZ), c1 = Math.floor(far / CZ);
  for (const [ci, ch] of chunks) if (ch.z1 < camZ - BEHIND || ci > c1 + 2) { disposeGroup(ch.g); chunks.delete(ci); }
  for (let ci = c0; ci <= c1; ci++) {
    const z0 = ci * CZ, z1 = z0 + CZ;
    if (z1 + SLDZ > SL[SL.length - 1].z) break;          // slices for it have not arrived yet
    const have = chunks.get(ci);
    if (have) { if (z1 > camZ && have.sig !== chunkSig(z0, z1)) { disposeGroup(have.g); chunks.delete(ci); } else continue; }
    const ch = buildChunk(ci); if (ch) { chunks.set(ci, ch); stats.builds++; }
  }
}

/* ---------------- gap lips (T3) ---------------- */
const lips = new Map();
function streamLips(camZ, far) {
  for (const [k, l] of lips) if (l.z1 < camZ - 900) { for (const m of l.meshes) { m.geometry.dispose(); scene.remove(m); } lips.delete(k); }
  for (const g of world.gaps) {
    if (g.z1 < camZ - 900 || g.z0 > far + 900 || lips.has(g.z0)) continue;
    if (g.z1 + 20 > SL[SL.length - 1].z || g.z0 - 20 < SL0) continue;
    const meshes = [];
    for (const zz of [g.z0, g.z1]) {
      const s = tr(zz), off = zz === g.z0 ? -9 : 9;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s.hw * 2, 16), chevMat);
      const f = frameAt(zz + off, s.cx);
      m.position.copy(V(s.cx, s.y, zz + off)).addScaledVector(f.up, 0.8);
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.right, f.fwd.clone().negate(), f.up));
      scene.add(m); meshes.push(m);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(s.hw * 2, T), faceMat);
      face.position.copy(V(s.cx, s.y - T / 2, zz)); face.rotation.z = Math.atan(-s.bank); scene.add(face); meshes.push(face);
    }
    lips.set(g.z0, { z1: g.z1, meshes });
  }
}

/* ---------------- the city (W1, W4), merged per chunk ---------------- */
const towerChunks = new Map();
const beaconList = [];
function boxFaces(pos, uv, nrm, x, y0, z, w, h, d, ru, rv) {
  /* five faces of a box with the window repeat baked into the UVs; the bottom is never seen */
  const x0 = x - w / 2, x1 = x + w / 2, y1 = y0 + h, zc = -z, z0 = zc - d / 2, z1 = zc + d / 2;
  const quad = (a, b, c, e, n, uw, vh) => { pos.push(...a, ...b, ...c, ...a, ...c, ...e); for (let k = 0; k < 6; k++) nrm.push(...n);
    uv.push(0, 0, uw, 0, uw, vh, 0, 0, uw, vh, 0, vh); };
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], ru, rv);     // front (faces the camera, +z in three)
  quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], ru, rv);    // back
  quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], ru, rv);    // left
  quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], ru, rv);     // right
  quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], ru, rv);     // roof
}
function buildTowerChunk(ci, towers, portrait) {
  const parts = [[], [], [], []].map(() => ({ pos: [], uv: [], nrm: [] })), spires = { pos: [], uv: [], nrm: [] };
  const g = new THREE.Group(); g.name = 'towers' + ci;
  const beacons = [], boards = []; let kept = 0;
  for (const t of towers) {
    const s = tr(t.z);
    if (Math.abs(t.x - s.cx) - t.w / 2 < s.hw + (portrait ? 20 : 240)) continue;
    const k = Math.floor((t.tone || 0.5) * 4) % 4;
    const p = parts[k];
    boxFaces(p.pos, p.uv, p.nrm, t.x, t.base, t.z, t.w, t.h, t.d, Math.max(1, t.w / 70), Math.max(1, t.h / 260));
    kept++;
    let top = t.base + t.h;
    if (t.h > 1300) { boxFaces(spires.pos, spires.uv, spires.nrm, t.x, top, t.z, 5, 160, 5, 1, 1); top += 160; }
    beacons.push({ x: t.x, y: top + 8, z: t.z, ph: hash(t.z, t.x, 1) * 6 });
    if (hash(t.z, t.x, 2) < 0.35) {
      const bt = boardMats[Math.floor(hash(t.z, t.x, 3) * 3)];
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(t.w * 0.9, t.w * 0.45), bt);
      const side = Math.sign(s.cx - t.x) || 1;
      pl.position.copy(V(t.x + side * (t.w / 2 + 1.5), t.base + t.h * (0.45 + hash(t.z, t.x, 4) * 0.4), t.z)); pl.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      pl.visible = Q.boards; g.add(pl); boards.push(pl);
    }
  }
  const mesh = (p, mat) => { if (!p.pos.length) return; const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(p.nrm, 3));
    g.add(new THREE.Mesh(geo, mat)); };
  parts.forEach((p, k) => mesh(p, winMats[k])); mesh(spires, spireMat);
  scene.add(g);
  return { g, beacons, boards, kept, n: towers.length };
}
function streamTowers(camZ, far, towers, portrait) {
  /* A chunk is built only once the view window covers all of it and the track
     under it, so what it holds is complete; it is then kept until it falls
     behind, and rebuilt only if its towers change (the game generates them
     ahead over several frames) or the orientation flips the clearance rule. */
  const by = new Map();
  for (const t of towers) { const ci = Math.floor(t.z / CT); (by.get(ci) || by.set(ci, []).get(ci)).push(t); }
  const lo = camZ - 1600, hi = far + 800, slast = SL[SL.length - 1].z;
  for (const [ci, tc] of towerChunks) if ((ci + 1) * CT < lo) { disposeGroup(tc.g); towerChunks.delete(ci); }
  for (const [ci, list] of by) {
    const z0 = ci * CT, z1 = z0 + CT;
    if (z0 < lo || z1 > hi || z1 > slast || z0 < SL0) continue;       // not fully in the window, or no track under it yet
    let sig = list.length; for (const t of list) sig += t.z + t.x;
    const have = towerChunks.get(ci);
    if (have && have.sig === sig && have.portrait === portrait) continue;
    if (have) { disposeGroup(have.g); towerChunks.delete(ci); }
    const tc = buildTowerChunk(ci, list, portrait); tc.portrait = portrait; tc.sig = sig; towerChunks.set(ci, tc); stats.towerBuilds++;
  }
  beaconList.length = 0; stats.towers = 0;
  for (const tc of towerChunks.values()) { for (const b of tc.beacons) beaconList.push(b); stats.towers += tc.kept; }
}
function updateBeacons(t) {
  const n = Math.min(beaconList.length, beaconMesh.instanceMatrix.count);
  const col = _c3;
  for (let i = 0; i < n; i++) { const b = beaconList[i];
    dummy.position.set(b.x, b.y, -b.z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix(); beaconMesh.setMatrixAt(i, dummy.matrix);
    col.setRGB(Math.max(0.1, Math.sin(t * 3 + b.ph)) * 1.0, 0.08, 0.12); beaconMesh.setColorAt(i, col); }
  beaconMesh.count = n; beaconMesh.instanceMatrix.needsUpdate = true; if (beaconMesh.instanceColor) beaconMesh.instanceColor.needsUpdate = true;
}

/* ---------------- skylanes (W2) ---------------- */
const lanes = new Map();
function streamLanes(camZ, far) {
  for (const [k, L] of lanes) if (L.z < camZ - 2 * LANE_Z || L.z > far + LANE_Z) { scene.remove(L.m); L.m.dispose(); lanes.delete(k); }
  if (!Q.traffic) return;
  for (let z = Math.ceil((camZ - LANE_Z) / LANE_Z) * LANE_Z; z < far; z += LANE_Z) for (let j = 0; j < 2; j++) {
    const key = z + ':' + j; if (lanes.has(key)) continue;
    if (z < SL0 || z > SL[SL.length - 1].z) continue;
    const s = tr(z), h = (c) => hash(z, j, c);
    const y = s.y - 120 - h(1) * 520 - j * 160, zz = z + (h(2) - 0.5) * 300, dir = j ? 1 : -1;
    const n = 46, m = new THREE.InstancedMesh(carGeo, dir > 0 ? carMatW : carMatR, n);
    m.frustumCulled = false; scene.add(m);
    lanes.set(key, { m, y, z: zz, dir, sp: 260 + h(3) * 260, n, off: h(4) * 1000, x0: s.cx, yaw: (h(5) - 0.5) * 0.5 });
  }
}
function updateLanes(t) {
  for (const L of lanes.values()) {
    for (let i = 0; i < L.n; i++) {
      const span = 7000, u = ((i * 151.7 + L.off + t * L.sp * L.dir) % span + span) % span - span / 2;
      dummy.position.set(L.x0 + u, L.y + Math.sin(i * 1.7) * 6, -(L.z + u * L.yaw)); dummy.rotation.set(0, -L.yaw, 0); dummy.scale.setScalar(1); dummy.updateMatrix();
      L.m.setMatrixAt(i, dummy.matrix);
    }
    L.m.instanceMatrix.needsUpdate = true;
  }
}

/* ---------------- searchlights (W3) ---------------- */
const beamMat = () => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { col: { value: new THREE.Color(0x9fd8ff) } },
  vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = uv.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 col; varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float edge = pow(abs(dot(vN, vV)), 1.5); gl_FragColor = vec4(col, 0.10 * (1.0 - vY) * edge); }` });
const beams = new Map();
let beamGeo = null;
function streamBeams(camZ, far) {
  for (const [k, b] of beams) if (b.z < camZ - 2 * BEAM_Z || b.z > far + BEAM_Z) { scene.remove(b.m); b.m.material.dispose(); beams.delete(k); }
  if (!Q.beams) return;
  if (!beamGeo) { beamGeo = new THREE.CylinderGeometry(160, 8, 5200, 24, 1, true); beamGeo.translate(0, 2600, 0); }
  for (let k = Math.floor((camZ - BEAM_Z) / BEAM_Z); k * BEAM_Z < far; k++) {
    if (beams.has(k)) continue;
    const z = k * BEAM_Z + 500; if (z < SL0 || z > SL[SL.length - 1].z) continue;
    const s = tr(z), side = k % 2 ? 1 : -1, h = c => hash(k, 7, c);
    const m = new THREE.Mesh(beamGeo, beamMat());
    m.position.copy(V(s.cx + side * (700 + h(1) * 900), s.y - 1400 - h(2) * 600, z));
    scene.add(m); beams.set(k, { m, z, ph: h(3) * 6, sp: 0.25 + h(4) * 0.3, side });
  }
}
function updateBeams(t) { for (const b of beams.values()) b.m.rotation.set(0.35 + 0.18 * Math.sin(t * b.sp + b.ph), t * b.sp * 0.6 + b.ph, b.side * (0.25 + 0.15 * Math.cos(t * b.sp * 1.3 + b.ph))); }

/* ---------------- hover craft (W5) ---------------- */
const crafts = new Map();
function streamCrafts(camZ, far) {
  for (const [k, c] of crafts) if (c.z < camZ - CRAFT_Z || c.z > far + CRAFT_Z) {
    scene.remove(c.g, c.trail); c.trail.geometry.dispose(); c.trail.material.dispose();
    c.g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    crafts.delete(k); }
  for (let k = Math.floor(camZ / CRAFT_Z); k * CRAFT_Z < far; k++) {
    if (crafts.has(k)) continue;
    const z = k * CRAFT_Z + 400; if (z < SL0 || z > SL[SL.length - 1].z) continue;
    const s = tr(z), h = c => hash(k, 9, c), odd = k % 2;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(10, 46, 4, 10), new THREE.MeshStandardMaterial({ color: 0x1a1f30, metalness: 0.8, roughness: 0.3 }));
    body.rotation.z = Math.PI / 2; g.add(body);
    const strip2 = new THREE.Mesh(new THREE.BoxGeometry(58, 2, 16), new THREE.MeshBasicMaterial({ color: odd ? 0xff2e88 : 0x2ee0ff })); strip2.position.y = -7; g.add(strip2);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: odd ? GLOW_M : GLOW_C, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); glow.scale.set(120, 50, 1); glow.position.y = -10; g.add(glow);
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 40), 3));
    const trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: odd ? 0xff2e88 : 0x2ee0ff, transparent: true, opacity: 0.5 })); trail.frustumCulled = false;
    scene.add(g, trail);
    crafts.set(k, { g, trail, y: s.y + 140 + h(1) * 260, z, x0: s.cx, dir: odd ? 1 : -1, sp: 380 + h(2) * 200, ph: h(3) * 2000 });
  }
}
function updateCrafts(t) {
  for (const c of crafts.values()) {
    const xAt = tt => c.x0 + c.dir * (((tt * c.sp + c.ph) % 4000) - 2000);
    const x = xAt(t);
    c.g.position.copy(V(x, c.y + Math.sin(t * 1.3 + c.ph) * 8, c.z)); c.g.rotation.y = 0; c.g.rotation.z = Math.sin(t + c.ph) * 0.05;
    const a = c.trail.geometry.attributes.position.array;
    for (let i = 0; i < 40; i++) { const tt = t - i * 0.03, xx = xAt(tt); a[i * 3] = Math.abs(xx - x) < 900 ? xx : x; a[i * 3 + 1] = c.y + Math.sin(tt * 1.3 + c.ph) * 8 - 7; a[i * 3 + 2] = -c.z; }
    c.trail.geometry.attributes.position.needsUpdate = true;
  }
}

/* ---------------- low cloud (W6) ---------------- */
const clouds = new Map();
function streamClouds(camZ, far) {
  for (const [k, c] of clouds) if (c.z < camZ - 1200 || c.z > far + 1200) { scene.remove(c.sp); clouds.delete(k); }
  const step = CLOUD_Z / Q.cloudMul;
  for (let k = Math.floor((camZ - 1000) / step); k * step < far + 1000; k++) {
    if (clouds.has(k)) continue;
    const z = k * step + hash(k, 11, 0) * step; if (z < SL0 || z > SL[SL.length - 1].z) continue;
    const s = tr(z), h = c => hash(k, 11, c);
    const sp = new THREE.Sprite(cloudMat);
    const x0 = s.cx + (h(1) - 0.5) * 4000;
    sp.position.copy(V(x0, s.y - 500 - h(2) * 900, z)); const kk = 900 + h(3) * 1200; sp.scale.set(kk * 2, kk, 1);
    scene.add(sp); clouds.set(k, { sp, z, x0, vx: (h(4) - 0.5) * 40, ph: h(5) * 6.3 });
  }
}

/* ---------------- sky dome (W6, W7) ---------------- */
function buildSky() {
  skyU = { top: { value: new THREE.Color(TIERS[0].top) }, mid: { value: new THREE.Color(TIERS[0].mid) }, hor: { value: new THREE.Color(TIERS[0].hor) },
           low: { value: new THREE.Color(TIERS[0].low) }, t: { value: 0 }, sun: { value: 1 }, stars: { value: 0 },
           sunDir: { value: new THREE.Vector3(-0.55, 0.035, -1).normalize() } };
  sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top, mid, hor, low, sunDir; uniform float t, sun, stars; varying vec3 vD;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        float e = vD.y;
        vec3 c = e > 0.0 ? mix(hor, mix(mid, top, smoothstep(0.08, 0.5, e)), smoothstep(0.0, 0.08, e))
                         : mix(hor, low, smoothstep(0.0, -0.45, e));
        // stars above the haze
        vec2 g = floor(vec2(atan(vD.z, vD.x) * 400.0, e * 400.0));
        float s = step(0.996, h(g)) * smoothstep(0.03, 0.15, e) * (0.6 + 0.4 * sin(t * 3.0 + h(g + 1.0) * 30.0));
        c += vec3(s) * stars;
        // the low sun's warm glow along the horizon, and the sun itself just above it
        float d = max(dot(vD, sunDir), 0.0);
        c += vec3(1.0, 0.62, 0.32) * sun * (pow(d, 8.0) * 0.32 + pow(d, 90.0) * 0.22) * smoothstep(-0.25, 0.05, e);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }` }));
  sky.renderOrder = -10; scene.add(sky);
}
function setTierColours(dt) {
  const a = TIERS[tierFrom], b = TIERS[lastTier]; tierBlend = Math.min(1, tierBlend + dt / TIER_BLEND_T);
  const k = tierBlend * tierBlend * (3 - 2 * tierBlend);
  const mix = (x, y) => _c1.set(x).lerp(_c2.set(y), k), num = (x, y) => x + (y - x) * k;
  skyU.top.value.copy(mix(a.top, b.top)); skyU.hor.value.copy(mix(a.hor, b.hor)); skyU.mid.value.copy(mix(a.mid, b.mid)); skyU.low.value.copy(mix(a.low, b.low));
  skyU.sun.value = num(a.sun, b.sun); skyU.stars.value = num(a.stars, b.stars);
  scene.fog.color.copy(mix(a.fog, b.fog));
  hemi.color.copy(mix(a.hemiSky, b.hemiSky)); hemi.intensity = num(a.hemi, b.hemi);
  moon.color.copy(mix(a.dir, b.dir)); moon.intensity = num(a.dirI, b.dirI);
  winLevel = num(a.win, b.win); bloomBase = num(a.bloom, b.bloom);
  cloudMat.color.copy(mix(a.cloud, b.cloud));
}

/* ---------------- camera ---------------- */
function placeCamera(c, shakeX, shakeY) {
  const Hf = 2 * Math.max(c.projBase, H - c.projBase);
  cam.fov = 2 * Math.atan(Hf / 2 / c.FOC) * 180 / Math.PI;
  cam.aspect = W / Hf;
  cam.setViewOffset(W, Hf, -shakeX, Hf / 2 - c.projBase - shakeY, W, H);
  cam.position.copy(V(c.x, c.y, c.z));
  cam.rotation.x = -c.pitch; cam.rotation.z = c.roll;
  cam.updateProjectionMatrix(); cam.updateMatrixWorld();
}

/* ---------------- size ---------------- */
function ensureSize(v) {
  if (v.W === W && v.H === H && v.ZOOM === ZOOM && v.DPR === DPR) return;
  W = v.W; H = v.H; ZOOM = v.ZOOM; DPR = v.DPR;
  const cw = Math.max(1, Math.round(W * ZOOM)), ch = Math.max(1, Math.round(H * ZOOM));
  const pr = Math.min(DPR, Q.prCap);
  renderer.setPixelRatio(pr); renderer.setSize(cw, ch, false);
  composer.setPixelRatio(pr); composer.setSize(cw, ch);
  PXW = Math.round(cw * pr); PXH = Math.round(ch * pr);
  gl.style.width = cw + 'px'; gl.style.height = ch + 'px';
}

/* ==========================================================================
   init(canvas, overlayRoot)
   ========================================================================== */
let dead = false;
export function init(canvas, overlayRoot, action) {
  try { return initInner(canvas, overlayRoot, action); }
  catch (e) {
    /* WebGL probed fine but the renderer still could not stand up. The game
       must not be left with a canvas nobody paints: everything this made is
       removed and render() hands each frame to the game's own 2D painter. */
    dead = true;
    try { if (gl && gl.parentNode) gl.parentNode.removeChild(gl); if (uiRoot && uiRoot.parentNode) uiRoot.parentNode.removeChild(uiRoot); } catch (e2) {}
    renderer = null;
    return false;
  }
}
function initInner(canvas, overlayRoot, action) {
  gl = document.createElement('canvas'); gl.id = 'hd';
  /* Over the 2D canvas, which is never painted while HD is set, and under the
     overlay. Pointer events pass through to the game's own canvas. */
  gl.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:1;display:block';
  (canvas.parentNode || document.body).insertBefore(gl, canvas.nextSibling);
  uiRoot = document.createElement('div'); uiRoot.id = 'hdui';
  uiRoot.style.cssText = 'position:fixed;inset:0;z-index:2;pointer-events:none';
  (overlayRoot || document.body).appendChild(uiRoot);

  /* no multisampling on the default framebuffer: the composer draws the scene
     into its own target, and the only thing ever drawn to the canvas is the
     output pass's full screen quad, so MSAA there costs memory and a resolve
     per frame for a picture that is the same to the pixel */
  renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: false, powerPreference: 'high-performance' });
  renderer.info.autoReset = false;      // the composer renders several passes; count the whole frame
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  cam = new THREE.PerspectiveCamera(60, 1, 6, 40000); cam.rotation.order = 'YXZ';
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(TIERS[0].fog, 700, 5600);

  /* a night environment for reflections: dark sky, a few coloured light panels */
  { const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ color: 0x0a0820, side: THREE.BackSide })));
    const panel = (c, x, y, z, s) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s * 0.5), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m); };
    panel(0xff2e88, -30, 10, -20, 30); panel(0x2ee0ff, 30, 6, -25, 30); panel(0xff8a2a, 0, 30, 10, 26); panel(0x6a4aff, 0, -10, -40, 40);
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(env, 0.02).texture; pm.dispose();
    scene.environmentIntensity = 0.8; }

  buildSky();
  hemi = new THREE.HemisphereLight(0x4a4ab0, 0x100810, 0.55); scene.add(hemi);
  moon = new THREE.DirectionalLight(0x8a9cff, 0.55); scene.add(moon, moon.target);
  buildMaterials();
  buildActors({ BALL_R: 10.5 });   // re-sized from the view's K on the first frame
  screens = createScreens(uiRoot, action);   // U1 to U6, over the vignette

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, cam));
  bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.75, 0.45, 0.74); composer.addPass(bloom);
  rgb = new ShaderPass(RGBShiftShader); rgb.uniforms.amount.value = 0; composer.addPass(rgb);
  composer.addPass(new OutputPass());
  return true;
}

/* ==========================================================================
   render(view): one frame from a read-only snapshot
   ========================================================================== */
let lastBoardT = -1;
export function render(v) {
  if (dead) { if (typeof draw === 'function') draw(); return; }
  if (!renderer) return;
  renderer.info.reset();
  ensureSize(v);
  /* effect timers run on game time, so they freeze behind the pause veil like
     the simulation they follow; the scenery keeps turning on animT */
  const t = v.animT, dt = v.paused ? 0 : v.dt;
  SL = v.world.slices; world = v.world;
  if (SL.length < 2) return;
  SL0 = SL[0].z; SLDZ = SL[1].z - SL[0].z || 18;
  const camZ = v.cam.z, far = camZ + Math.max(v.cam.viewZ, 3600), roadFar = camZ + Math.max(v.cam.viewZ + ROAD_AHEAD, 3600);
  const portrait = v.W < v.H;

  /* a new run: the clock goes back, or play follows a death or the settings
     screen, or the title comes up. Everything that remembered the last run
     starts over (updateActors), and the sky snaps to the run's tier the way
     the reference's first frame does: a tier that only went back to Drift
     is not a tier change and gets no E8 shock. */
  const restart = !!prevView && (v.t < prevView.t || (v.state === 'play' && prevView.state !== 'play' && prevView.state !== 'title') || (v.state === 'title' && prevView.state !== 'title'));
  /* W7: the sky follows the tier, blended over 2.5 s; the first frame snaps */
  const tier = v.hud.tier | 0;
  if (!haveTier || restart) { tierFrom = lastTier = tier; tierBlend = 1; haveTier = true; shockT = -1; shock.visible = false; }
  else if (tier !== lastTier) { tierFrom = lastTier; lastTier = tier; tierBlend = 0; if (v.state === 'play') shockT = 0; }   // E8
  setTierColours(dt);

  /* E9: a fall shakes the camera about 16 px, decaying over a second, on top of
     whatever the game's own shake is doing. Render-side randomness only. */
  const dying = v.state === 'dying' || v.state === 'dead', hitDead = dying && v.ball.overKind === 'hit';
  if (prevView && v.state === 'dying' && prevView.state === 'play' && !hitDead) fallShakeT = 0;
  if (fallShakeT >= 0) fallShakeT += dt;
  const fs = fallShakeT >= 0 ? 16 * Math.exp(-fallShakeT * 2.2) : 0;
  const gsx = v.cam.shakeX || 0, gsy = v.cam.shakeY || 0;
  placeCamera(v.cam, Math.abs(gsx) > fs ? gsx : (Math.random() * 2 - 1) * fs, Math.abs(gsy) > fs ? gsy : (Math.random() * 2 - 1) * fs);
  sky.position.copy(cam.position); skyU.t.value = t;
  moon.position.copy(cam.position).add(skyU.sunDir.value.clone().setY(0.35).normalize().multiplyScalar(4000)); moon.target.position.copy(cam.position);

  /* the world: build what has arrived, drop what is behind, and start over on
     a restart (a Random run regenerates the track, and the old lips and towers
     beyond the view's window are where worldChanged cannot see them) or when
     the track under an existing chunk is not the track it was built from */
  if (restart || worldChanged()) { dropWorld(); stats.drops++; }
  streamChunks(camZ, roadFar);
  streamLips(camZ, roadFar);
  streamTowers(camZ, far, v.world.towers, portrait);
  streamLanes(camZ, far);
  streamBeams(camZ, far);
  streamCrafts(camZ, far);
  streamClouds(camZ, far);

  /* background life */
  pulse.offset.y = -t * 1.6;
  if (Q.boards && t - lastBoardT >= 1 / 15) { paintBoards(t); lastBoardT = t; }
  for (const m of winMats) m.emissiveIntensity = winLevel + (shockT >= 0 && shockT < 0.6 ? (0.6 - shockT) * 0.7 : 0);   // E8: a brief lift
  updateBeacons(t);
  updateLanes(t); updateCrafts(t); updateBeams(t);
  for (const c of clouds.values()) c.sp.position.x = c.x0 + c.vx * 10 * Math.sin(t * 0.1 + c.ph);   // on the clock, at the reference's drift rate, within 200 units
  const inTun = world.tunnels.some(tn => camZ > tn.z0 + 40 && camZ < tn.z1);
  scene.fog.near = inTun ? 120 : 700; scene.fog.far = inTun ? 1400 : 5600; if (inTun) scene.fog.color.set(0x05060c);
  let nRings = 0;
  for (const ch of chunks.values()) for (const r of ch.rings) { nRings++; if (r.mouth) continue;
    const d = r.z - v.ball.z; r.m.material.emissiveIntensity = 0.12 + (d > 160 && d < 520 ? 0.5 * (1 - Math.abs(d - 340) / 180) : 0); }
  chevMat.color.setScalar(0.55 + 0.45 * Math.max(0, Math.sin(t * 10)));

  updateActors(v, t, dt, dying, hitDead, restart);

  /* post: bloom from the tier with a lift on a tier change (E8); chromatic split
     on a crash (E10) and on a tier change; never on a shield hit (E5) */
  let rgbA = 0;
  if (hitDead && fragT >= 0 && fragT < 0.5) rgbA = Math.max(rgbA, (0.5 - fragT) * 0.03);
  if (shockT >= 0 && shockT < 0.3) rgbA = Math.max(rgbA, (0.3 - shockT) * 0.02);
  rgb.uniforms.amount.value = rgbA; rgb.uniforms.angle.value = t * 3; rgb.enabled = rgbA > 0;
  bloom.strength = Q.bloom ? bloomBase + (shockT >= 0 ? Math.max(0, 0.4 - shockT) * 0.8 : 0) : 0;
  bloom.enabled = Q.bloom;
  /* the screens draw after the scene; a screen's own scrim replaces the
     vignette while it is up, and the style is written only when it changes */
  const scrim = (screens ? screens.update(v) : null) || (dying ? `radial-gradient(ellipse at center, rgba(40,0,10,0) 30%, rgba(40,0,10,${Math.min(0.75, 0.3 + (fragT >= 0 ? fragT : 0.4) * 0.4)}) 100%)`
                               : 'radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,8,0.45) 100%)');
  if (scrim !== vigBg) { vigBg = scrim; vig.style.background = scrim; }
  composer.render();
  prevView = { state: v.state, save: v.ball.save, flashT: v.flashT, t: v.t };

  stats.chunks = chunks.size; stats.towerChunks = towerChunks.size; stats.lanes = lanes.size; stats.beams = beams.size; stats.crafts = crafts.size;
  stats.clouds = clouds.size; stats.rings = nRings; stats.lips = lips.size; stats.calls = renderer.info.render.calls; stats.tris = renderer.info.render.triangles;
}

function updateActors(v, t, dt, dying, hitDead, restart) {
  const b = v.ball, K = v.K;
  if (BR !== K.BALL_R * 1.9 || OBST_D !== K.OBST_D) { OBST_D = K.OBST_D; OBST_H = K.OBST_H;
    if (BR !== K.BALL_R * 1.9) { BR = K.BALL_R * 1.9; ball.geometry.dispose(); ball.geometry = new THREE.SphereGeometry(BR, 48, 32);
      shield.children[0].geometry.dispose(); shield.children[0].geometry = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(BR * 1.85, 1));
      shield.children[1].geometry.dispose(); shield.children[1].geometry = new THREE.SphereGeometry(BR * 1.8, 32, 16); } }
  if (restart) resetRun();
  const title = v.state === 'title';

  /* obstacles (O1 to O4) */
  const seen = new Set();
  for (const o of v.obs) {
    seen.add(o.id);
    const e = obstacle(o); e.unseen = 0; const h = o.y1 - o.y0;
    e.g.visible = !o.dead && h > 1; e.pad.visible = o.kind >= 2 && !o.dead;
    const fa = frameAt(o.z, o.x);
    e.g.position.set(o.x, o.base + o.y0 + h / 2, -o.z);
    e.box.scale.set(o.hw * 2, Math.max(h, 0.1), 1);
    e.top.visible = o.kind === 1; e.top.scale.set(o.hw * 1.2, 1, 1); e.top.position.y = h / 2 + 1;
    const moving = o.x - e.lastX; if (Math.abs(moving) > 0.01) e.top.rotation.z = moving > 0 ? 0 : Math.PI; e.lastX = o.x;
    e.halo.scale.set(o.hw * 4, h * 3 + 20, 1);
    e.pad.position.set(o.x, surf(o.z, o.x) + 0.7, -o.z); e.pad.quaternion.setFromRotationMatrix(_m.makeBasis(fa.right, fa.fwd.clone().negate(), fa.up));
    e.pad.scale.set(o.hw * 2.2, 1, 1); e.pad.material.opacity = 0.15 + 0.5 * (o.f ?? 1) * (0.7 + 0.3 * Math.sin(t * 12));
    if (o.id !== killerId) { e.box.material.emissive.set(e.col); e.box.material.emissiveIntensity = 2.6; }
  }
  for (const [id, e] of OB) if (!seen.has(id)) { e.g.visible = false; e.pad.visible = false; if (++e.unseen > 90 && id !== killerId) dropObstacle(id, e); }

  /* pickup (E2) */
  pick.visible = !!v.pick && !title;
  if (v.pick) { pick.position.set(v.pick.x, v.pick.y + 30, -v.pick.z); crystal.rotation.y = t * 2.5; crystal.rotation.x = 0.3; pickRing.rotation.set(Math.PI / 2 + Math.sin(t) * 0.3, 0, t); pickHalo.material.opacity = 0.6 + 0.3 * Math.sin(t * 6); }

  /* ball (E1) */
  const fb = frameAt(b.z, b.x);
  const bp = _a.set(b.x, b.y, -b.z).addScaledVector(fb.up, BR);
  if (dying && !hitDead) bp.y += b.fallY;
  ball.position.copy(bp);
  ball.rotation.set(-(b.z / BR), 0, 0);
  ball.visible = !hitDead && !title; ballGlow.visible = ball.visible;
  ballLight.position.copy(bp).addScaledVector(fb.up, BR * 2); ballLight.intensity = (hitDead || title) ? 0 : 5000;
  ballGlow.position.copy(bp); ballGlow.scale.set(BR * 7, BR * 7, 1);
  if (!title && !v.paused) { hist.unshift(bp.clone()); if (hist.length > TRN + 2) hist.pop(); }   // the trail holds still with the ball
  trail.forEach((s, k) => { const p = hist[k + 1]; s.visible = !!p && !dying && !title; if (!p) return; const f = 1 - k / TRN; s.position.copy(p); s.scale.set(BR * 2.4 * f + 2, BR * 2.4 * f + 2, 1); s.material.opacity = 0.3 * f; });
  shadow.visible = !title && (!dying || hitDead);
  { const sz = BR * (b.air ? 3.2 : 2.6) * (b.air ? Math.max(0.5, 1 - b.h / 300) : 1);
    shadow.position.set(b.x, surf(b.z, b.x) + 0.5, -b.z); shadow.quaternion.setFromRotationMatrix(_m.makeBasis(fb.right, fb.fwd.clone().negate(), fb.up)); shadow.scale.set(sz, sz, 1); }

  /* shield (E4), collect (E3), absorb (E5) */
  shield.visible = b.save && !dying && !title; shield.position.copy(bp); shield.rotation.set(t * 0.7, t * 1.1, 0);
  if (prevView && b.save && !prevView.save) burstT = 0;
  if (prevView && v.flashT > 0 && !(prevView.flashT > 0) && !dying) flashT = 0;
  if (flashT >= 0) { flashT += dt; const on = flashT < 2 && Math.sin(flashT * 28) > 0;
    ball.material.emissiveIntensity = on ? 0.9 : 0; ballGlow.material.opacity = on ? 0.6 : 0.18; if (flashT >= 2) { flashT = -1; ball.material.emissiveIntensity = 0; ballGlow.material.opacity = 0.18; } }
  if (burstT >= 0) { burstT += dt; const k = burstT / 0.55; burstRing.visible = k < 1; burstRing.position.copy(bp); burstRing.lookAt(cam.position);
    const r = BR * (2 + 14 * k); burstRing.scale.set(r, r, r); burstRing.material.opacity = 1 - k; if (k >= 1) burstT = -1; } else burstRing.visible = false;

  /* sparks (E6) and the game's shards (E5) */
  let n = 0; for (const s of v.sparks) { if (n >= SPK) break; spkPos[n * 3] = s[0]; spkPos[n * 3 + 1] = s[1]; spkPos[n * 3 + 2] = -s[2]; n++; }
  spkGeo.setDrawRange(0, n); spkGeo.attributes.position.needsUpdate = true;
  shardMesh.count = Math.min(200, v.shards.length);
  for (let k = 0; k < shardMesh.count; k++) { const s = v.shards[k]; dummy.position.set(s[0], s[1], -s[2]); dummy.rotation.set(t * 5 + k, t * 3 + k * 2, k); dummy.scale.setScalar(1); dummy.updateMatrix(); shardMesh.setMatrixAt(k, dummy.matrix); }
  shardMesh.instanceMatrix.needsUpdate = true;

  /* speed streaks (E7) */
  const vf = Math.max(0, Math.min(1, (v.hud.v - 900) / 1600));
  const nst = Math.round(NST * Q.streakMul);
  if (!title) {
    const f = frameAt(b.z + 200, tr(b.z + 200).cx);
    for (let k = 0; k < nst; k++) { const [a, r, d0, sp] = stSeed[k]; const d = ((d0 - t * 2600 * sp) % 1400 + 1400) % 1400 + 40;
      _b.copy(cam.position).addScaledVector(f.fwd, d).addScaledVector(f.right, Math.cos(a) * r).addScaledVector(f.up, Math.sin(a) * r * 0.6 + 120);
      _c.copy(_b).addScaledVector(f.fwd, -60 - 140 * vf);
      stPos[k * 6] = _b.x; stPos[k * 6 + 1] = _b.y; stPos[k * 6 + 2] = _b.z; stPos[k * 6 + 3] = _c.x; stPos[k * 6 + 4] = _c.y; stPos[k * 6 + 5] = _c.z; }
    stGeo.setDrawRange(0, nst * 2); stGeo.attributes.position.needsUpdate = true; streaks.material.opacity = 0.05 + 0.5 * vf; streaks.visible = true;
  } else streaks.visible = false;

  /* deaths: E10 the crash, E9 the fall, and a gap */
  if (hitDead && fragT < 0) { fragT = 0; for (let k = 0; k < 140; k++) { const h = c => hash(k, b.z, c);
      const vel = new THREE.Vector3(h(1) - 0.5, h(2) * 0.9, h(3) - 0.5).normalize().multiplyScalar(80 + h(4) * 260); frag.push({ p: bp.clone(), v: vel, s: 0.6 + h(5) * 1.4 }); }
    /* only the block that was hit flashes: the one in line with the ball, nearest */
    let best = null, bd = 1e9; for (const o of v.obs) { if (Math.abs(o.x - b.x) > o.hw + 12) continue; const dz = Math.abs(o.z - b.z); if (dz < bd) { bd = dz; best = o.id; } } killerId = best; }
  if (fragT >= 0) { fragT += dt;   /* the fragments are gone by 2.2 s; after that only the vignette reads fragT */
    if (fragT >= 2.2) fragMesh.count = 0; else { fragMesh.count = frag.length;
    frag.forEach((f, k) => { f.v.y -= 500 * dt; f.v.multiplyScalar(0.985); f.p.addScaledVector(f.v, dt); dummy.position.copy(f.p); dummy.rotation.set(fragT * 9 + k, k, fragT * 7); dummy.scale.setScalar(f.s * Math.max(0, 1 - fragT / 2.2)); dummy.updateMatrix(); fragMesh.setMatrixAt(k, dummy.matrix); });
    fragMesh.instanceMatrix.needsUpdate = true; } }
  if (killerId !== null) { const e = OB.get(killerId); if (e) { e.g.visible = true; e.box.material.emissive.set(0xff2040); e.box.material.emissiveIntensity = 3 + 2 * Math.sin(t * 14); } }
  if (dying && b.overKind === 'fall' && !deathEdge.visible) {
    const s0 = tr(b.z), side = Math.sign(b.x - s0.cx) || 1, pos = [];
    for (const s of SL) { if (s.z < b.z - 260 || s.z > b.z + 120) continue; const xo = s.cx + side * s.hw, xi = s.cx + side * (s.hw - 70), y = x => s.y + s.bank * (s.cx - x);
      pos.push([xo, y(xo) + 1.5, s.z], [xi, y(xi) + 1.5, s.z]); }
    const arr = []; for (let k = 0; k < pos.length - 2; k += 2) { const [a, c1, b2, d] = [pos[k], pos[k + 1], pos[k + 2], pos[k + 3]]; for (const p of [a, c1, b2, c1, d, b2]) arr.push(p[0], p[1], -p[2]); }
    deathEdge.geometry.dispose(); deathEdge.geometry = new THREE.BufferGeometry(); deathEdge.geometry.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); deathEdge.visible = arr.length > 0;
  }
  if (deathEdge.visible) deathEdge.material.opacity = 0.55 + 0.4 * Math.sin(t * 14);
  if (dying && b.overKind === 'gap' && !deadLip) { for (const [z0, l] of lips) if (z0 <= b.z + 40 && l.z1 >= b.z - 40) { deadLip = l; for (const m of l.meshes) if (m.material === chevMat) m.material = lipDeadMat; break; } }
  if (deadLip) lipDeadMat.color.setRGB(1, 0.35 + 0.35 * Math.sin(t * 14), 0.4);

  /* the tier shockwave along the road (E8) */
  if (shockT >= 0) { shockT += dt; const k = shockT / 0.9; shock.visible = k < 1; shock.position.copy(bp); shock.quaternion.setFromRotationMatrix(_m.makeBasis(fb.right, fb.fwd.clone().negate(), fb.up));
    const r = 30 + 1400 * k; shock.scale.set(r, r, r); shock.material.color.set(TIERS[lastTier].accent); shock.material.opacity = (1 - k) * 0.9; if (k >= 1) { shockT = -1; shock.visible = false; } }
}

export function setQuality(level) {
  const low = level === 'low';
  Q.bloom = !low; Q.boards = !low; Q.traffic = !low; Q.beams = !low; Q.prCap = low ? 1 : 2; Q.cloudMul = low ? 0.5 : 1; Q.streakMul = low ? 0.5 : 1;
  for (const tc of towerChunks.values()) for (const b of tc.boards) b.visible = Q.boards;
  W = -1;   // force a size pass so the pixel ratio cap takes effect
}
export const debug = { stats, TIERS, Q, get scene() { return scene; }, get renderer() { return renderer; }, get screens() { return screens; },
  /* the effect timers, for scripted checks: a restart must not arm the E8 shock, a pause must freeze them */
  effects: () => ({ shockT, tierBlend, lastTier, tierFrom, flashT, burstT, fallShakeT, fragT, shockVisible: !!(shock && shock.visible), streaksVisible: !!(streaks && streaks.visible), streakOpacity: streaks ? streaks.material.opacity : null }) };
export default { init, render, setQuality, debug };
