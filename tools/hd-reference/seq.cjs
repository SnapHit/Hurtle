// Records a real run frame by frame: camera, ball, obstacles, pickups, particles and HUD state,
// plus every piece of track and scenery that came into view. An autopilot drives.
//   node seq.cjs <W> <H> <seconds> <tag> <seed> [die=fall|hit] [dieAt=s]
const { chromium } = require('playwright'); const fs = require('fs'); (async () => {
const [W, H, SECS, TAG, SEED, DIE, DIEAT] = [+process.argv[2], +process.argv[3], +process.argv[4], process.argv[5], process.argv[6], process.argv[7] || '', +(process.argv[8] || 0)];
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport:{width:W,height:H}, deviceScaleFactor:1 })).newPage();
await page.goto('http://localhost:8766/?seed=' + SEED); await page.waitForFunction(()=>typeof state!=='undefined');
await page.mouse.click(5,5); await page.waitForTimeout(800);
await page.keyboard.press('KeyR'); await page.waitForTimeout(30);
await page.evaluate(()=>{ try{taught.got=99}catch(e){}; window.requestAnimationFrame = cb => 0; last = 0; window.__t = performance.now(); });
const out = await page.evaluate(({SECS, DIE, DIEAT})=>{
  const FPS = 30, frames = [], world = { slices:{}, towers:{}, tunnels:{}, gaps:{} };
  let rammed = false, oid = new Map(), nid = 0;
  const idOf = o => { if (!oid.has(o)) oid.set(o, nid++); return oid.get(o); };
  function pilot(){
    if (state !== 'play') { keys.l = keys.r = false; return; }
    const t0 = sampleTrack(P.z + 40);
    let target = t0.cx;
    const dying = DIE && run.t > DIEAT;
    if (dying && DIE === 'fall'){ target = t0.cx + t0.hw * 2.5; }
    else {
      // chase a live pickup, then ram the next block once shielded, otherwise avoid
      if (save.live && save.z > P.z && save.z < P.z + 900) target = save.x;
      const ahead = obstacles.filter(o => !o.dead && o.z > P.z - 10 && o.z < P.z + 420).sort((a,b)=>a.z-b.z);
      const ram = (P.save && !rammed) || (dying && DIE === 'hit');
      if (ram && ahead.length){ target = ahead[0].x;
        // for the staged crash, line the ball up with the block so the real collision happens
        if (dying && DIE === 'hit' && !window.__lined){ const o = obstacles.filter(o => !o.dead && o.z - P.z > 150 && o.z - P.z < 700).sort((a,b)=>a.z-b.z)[0]; if (o){ P.x = o.x; P.vx = 0; P.save = false; window.__lined = o; } }
        if (window.__lined) target = window.__lined.x; }
      else for (const o of ahead){
        const tr = sampleTrack(o.z), m = o.hw + 34;
        if (Math.abs(target - o.x) < m){
          const L = o.x - m, R = o.x + m, lo = tr.cx - tr.hw + 30, hi = tr.cx + tr.hw - 30;
          target = (L > lo && (Math.abs(target - L) < Math.abs(target - R) || R > hi)) ? L : (R < hi ? R : L);
        }
      }
    }
    const d = target - P.x, tol = 6;
    keys.r = d > tol; keys.l = d < -tol;
  }
  for (let i = 0; i < SECS * FPS; i++){
    pilot();
    const wasSave = P && P.save;
    __t += 1000 / FPS; frame(__t);
    if (wasSave && !P.save && !run.over) rammed = true;
    // world collection
    for (let k = 0; k < gen.slices.length; k++){ const s = gen.slices[k], z = (gen.idx0 + k) * K.SLICE_DZ; world.slices[gen.idx0 + k] = { z, cx:s.cx, hw:s.hw, y:s.y, bank:s.bank }; }
    for (const t of towers) world.towers[t.z.toFixed(2) + '_' + t.x.toFixed(1)] = { z:t.z, x:t.x, w:t.w, d:t.d, base:t.base, h:t.h, tone:t.tone };
    for (const g of gaps) world.gaps[g.z0.toFixed(1)] = { z0:g.z0, z1:g.z1 };
    for (const g of tunnels) world.tunnels[g.z0.toFixed(1)] = { z0:g.z0, z1:g.z1 };
    const zMax = camZ + D.VIEW_Z;
    const bT = sampleTrack(rZ, {});
    frames.push({
      t: run.t, state, cam: { x:camX, y:camY, z:camZ, roll, pitch: Math.atan2(pitchS, pitchC), projBase, FOC: D.FOC, hY, viewZ: D.VIEW_Z },
      ball: { x:rX, z:rZ, h:rH, y: bT.y + bT.bank * (bT.cx - rX) + rH, air: !!P.air, save: !!P.save, burst: P.burst || 0,
              fallY: P.fallY || 0, overKind: run.overKind || null, freeze: run.freeze || 0, iframes: P.iframes || 0 },
      obs: obstacles.filter(o => o.z > camZ - 300 && o.z < zMax).map(o => { const sp = obstSpan(o, [0,0]); return { id:idOf(o), z:o.z, x:o.x, hw:o.hw, kind:o.kind, y0:sp[0], y1:sp[1], f: riseFrac(o), dead:o.dead, base:surfaceY(o.z, o.x) }; }),
      pick: save.live ? { x:save.x, z:save.z, y: surfaceY(save.z, save.x), spin: save.spin || 0 } : null,
      sparks: sparks.map(s => [s.x, s.y, s.z, s.life]),
      shards: shards.map(s => [s.x, s.y, s.z, s.vx || 0, s.vy || 0, s.vz || 0]),
      flashT: run.flashT || 0, flashO: run.flashO ? { z:run.flashO.z, x:run.flashO.x, hw:run.flashO.hw } : null,
      hud: { score: score(), mul: scoreMul() * chainMul(), chain: run.chain, chainT: run.chainT, tier: run.tier, tierT: run.tierT, v: speedNow(), daily: run.daily },
      gap: !!gapAt(rZ), shake: run.shake || 0
    });
    if (state === 'dead') { for (let k = 0; k < 45; k++){ __t += 1000/FPS; frame(__t); frames.push(Object.assign({}, frames[frames.length-1], { state, t: run.t })); } break; }
  }
  return { frames, world: { slices: Object.values(world.slices).sort((a,b)=>a.z-b.z), towers: Object.values(world.towers), gaps: Object.values(world.gaps), tunnels: Object.values(world.tunnels) },
           W, H, ZOOM, K: { OBST_D:K.OBST_D, OBST_H:K.OBST_H, LIP_W:K.LIP_W, BALL_R:K.BALL_R, TIER_V:K.TIER_V } };
}, {SECS, DIE, DIEAT});
fs.writeFileSync(`seq-${TAG}.json`, JSON.stringify(out));
const f = out.frames;
// an event log so clip windows can be chosen
const ev = [];
for (let i = 1; i < f.length; i++){
  const a = f[i-1], b = f[i];
  if (b.hud.tier > a.hud.tier) ev.push([i, 'tier ' + b.hud.tier]);
  if (b.ball.save && !a.ball.save) ev.push([i, 'shield on']);
  if (!b.ball.save && a.ball.save) ev.push([i, 'shield used']);
  if (b.gap && !a.gap) ev.push([i, 'gap']);
  if (b.ball.air && !a.ball.air) ev.push([i, 'air']);
  if (b.flashT > 0 && !(a.flashT > 0)) ev.push([i, 'flash']);
  if (b.state !== a.state) ev.push([i, 'state ' + b.state]);
  if (b.sparks.length > a.sparks.length + 3) ev.push([i, 'sparks +' + (b.sparks.length - a.sparks.length)]);
  if (b.hud.chain > a.hud.chain) ev.push([i, 'threaded ' + b.hud.chain]);
  if (b.shake > 0.5 && !(a.shake > 0.5)) ev.push([i, 'shake']);
}
const inTun = i => out.world.tunnels.some(t => f[i].ball.z > t.z0 && f[i].ball.z < t.z1);
let was = false; for (let i = 0; i < f.length; i++){ const n = inTun(i); if (n !== was) ev.push([i, n ? 'tunnel in' : 'tunnel out']); was = n; }
ev.sort((a,b)=>a[0]-b[0]);
console.log(TAG, 'frames', f.length, 'slices', out.world.slices.length, 'towers', out.world.towers.length, 'final state', f[f.length-1].state, 'score', f[f.length-1].hud.score);
console.log(ev.map(e => `${e[0]}(${(e[0]/30).toFixed(1)}s):${e[1]}`).join('  '));
await browser.close(); })();
