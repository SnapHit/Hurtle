/* ==========================================================================
   NIGHT CIRCUIT: the screens (U1 to U6)

   An HTML overlay over the live scene: the in-play HUD, the title, the pause
   and death screens and the settings panel. Built once, then only the text
   and numbers that changed are written each frame. Every button calls the
   game's own uiAction with the key the canvas hit table uses, so a button
   here does exactly what the same button does on the site.

   Sizes are the reference's (tools/hd-reference/anim.html): one unit u is a
   percent of the shorter side (with the height weighted 1.25), and the HUD
   scale s follows the logical height. Both are CSS variables on the root, so
   a resize is one style write, not one per element.
   ========================================================================== */
const TIER_NAME = ['DRIFT', 'RUSH', 'PLUNGE', 'FREEFALL', 'TERMINAL', 'ESCAPE VELOCITY'];
const TIER_FLASH = 1.6;   // the reference's banner length, the game's K.TIER_FLASH
const CAUSE = { fall: 'Off the edge', hit: 'Hit a block', gap: 'Fell through a gap' };
const OPT_NAMES = ['Steepness', 'Path width', 'Obstacles', 'Jumps', 'Floor tilt', 'Speed', 'Camera angle', 'Camera height', 'Neon', 'Accent'];
const ICON = {
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" fill="#bff4ff"/><rect x="14" y="5" width="4" height="14" fill="#bff4ff"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="#bff4ff"/><path d="M16 8c1.5 1.2 1.5 6.8 0 8M18.5 6c3 2.5 3 9.5 0 12" stroke="#bff4ff" stroke-width="1.8" fill="none"/></svg>',
  muted: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="#bff4ff"/><path d="M16 9l5 6M21 9l-5 6" stroke="#bff4ff" stroke-width="1.8" fill="none"/></svg>',
  skip: '<svg viewBox="0 0 24 24"><path d="M5 6l7 6-7 6zM12 6l7 6-7 6z" fill="#bff4ff"/><rect x="19" y="6" width="2" height="12" fill="#bff4ff"/></svg>',
  full: '<svg viewBox="0 0 24 24" fill="none" stroke="#bff4ff" stroke-width="1.8"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
  unfull: '<svg viewBox="0 0 24 24" fill="none" stroke="#bff4ff" stroke-width="1.8"><path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/></svg>',
};
/* the reference's sample values, for the harness stills (play.html) */
export const SAMPLE = {
  best: 1952, dailyNo: 730, audio: true, fs: null, setOpen: false, setDrag: -1, tierName: 'PLUNGE',
  countdown: 'new track in 13:22:10',
  opts: [0.5, 0.4, 0.45, 0.38, 0.48, 0.62, 0.42, 0.48, 0.53, 0.08].map((t, k) => ({ label: OPT_NAMES[k], t, cos: k >= 8 })),
  dead: { cause: 'fall', label: 'Daily track #730', adjusted: false, best: true }, lock: false,
};

const fmt = n => String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
function el(tag, cls, parent, text) {
  const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e); return e;
}
/* a text node, or one style, that is only rewritten when its value changes: a
   paused tier flash or a saturated chain would otherwise be written every frame */
function slot(node) { let last = null; return v => { if (v !== last) { node.textContent = v; last = v; } }; }
function styled(node, prop) { let last = null; return v => { if (v !== last) { node.style[prop] = v; last = v; } }; }

export function createScreens(root, action) {
  const act = typeof action === 'function' ? action : () => {};
  const press = (node, key, arg) => {
    node.classList.add('hd-hit');
    node.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); act(key, arg); });
  };
  root.addEventListener('contextmenu', e => e.preventDefault());   // a right press acts like the canvas: no menu over the game
  const pill = (parent, cls, text, key) => { const p = el('div', 'hd-pill ' + cls, parent, text); press(p, key); return p; };

  /* fonts: the files are in the zip; this gets them loading while the boot
     splash is up, so the first screen is not drawn in a fallback face */
  const warm = el('div', 'hd-warm', root);
  warm.innerHTML = '<span style="font-family:Unbounded;font-weight:300">0</span><span style="font-family:Unbounded;font-weight:700">0</span><span style="font-family:Unbounded;font-weight:900;font-style:italic">R</span><span style="font-family:Saira;font-weight:400">a</span><span style="font-family:Saira;font-weight:600">a</span>';

  /* ---- U1 the HUD ---- */
  const hud = el('div', 'hd-hud', root);
  const score = slot(el('div', 'hd-score', hud));
  const mul = slot(el('div', 'hd-mul', hud));
  const dailyTag = el('div', 'hd-tag hd-daily', hud); const dailyT = slot(dailyTag);
  const thread = el('div', 'hd-tag hd-thread', hud); const threadT = slot(thread); const threadO = styled(thread, 'opacity');
  const banner = el('div', 'hd-banner', hud); const bannerT = slot(banner);
  const bannerO = styled(banner, 'opacity'), bannerX = styled(banner, 'transform');
  const tier = el('div', 'hd-tag hd-tier', hud); const tierT = slot(tier);
  const btn = (cls, key, svg) => { const b = el('div', 'hd-btn ' + cls, hud); b.innerHTML = svg; press(b, key); return b; };
  const bPause = btn('hd-b-pause', 'pause', ICON.pause);
  const bFull = btn('hd-b-full', 'full', ICON.full);
  const bMute = btn('hd-b-mute', 'mute', ICON.sound);
  const bSkip = btn('hd-b-skip', 'skip', ICON.skip);

  /* ---- U2 the title ---- */
  const title = el('div', 'hd-screen hd-title', root);
  const tBox = el('div', 'hd-stack', title);
  el('div', 'hd-wm', tBox, 'HURTLE');
  el('div', 'hd-rule', tBox);
  const tKick = slot(el('div', 'hd-kicker', tBox));
  const tCount = slot(el('div', 'hd-small hd-italic', tBox));
  pill(tBox, 'hd-hot hd-play', "Play today's track", 'play');
  pill(tBox, 'hd-random', 'Random track', 'random');
  const tRow = el('div', 'hd-row', tBox);
  pill(tRow, 'hd-half', 'Settings', 'settings');
  const tSound = pill(tRow, 'hd-half', 'Sound on', 'sound'); const tSoundT = slot(tSound);
  const tBest = el('div', 'hd-kicker hd-best', tBox); const tBestT = slot(tBest);
  el('div', 'hd-small hd-controls', tBox, 'Arrows or A and D to steer · drag anywhere on touch');

  /* ---- U3 pause ---- */
  const pause = el('div', 'hd-screen hd-pause', root);
  el('div', 'hd-wm', pause, 'Paused');
  el('div', 'hd-rule', pause);
  pill(pause, 'hd-hot hd-resume', 'Resume', 'pause');
  pill(pause, 'hd-home', 'Home', 'home');
  el('div', 'hd-small hd-keys', pause, 'P to resume · M music · N next track');

  /* ---- U4 death ---- */
  const dead = el('div', 'hd-screen hd-dead', root);
  const dGlass = el('div', 'hd-glass', dead);
  const dCause = slot(el('div', 'hd-kicker hd-cause', dGlass));
  const dScore = slot(el('div', 'hd-wm hd-dscore', dGlass));
  el('div', 'hd-rule', dGlass);
  const dBest = el('div', 'hd-kicker hd-dbest', dGlass); const dBestT = slot(dBest);
  const dProv = slot(el('div', 'hd-small hd-prov', dGlass));
  const dRow = el('div', 'hd-row', dGlass);
  pill(dRow, 'hd-dhome', 'Home', 'menu');
  pill(dRow, 'hd-hot hd-again', 'Go again', 'again');
  const dAny = el('div', 'hd-small hd-any', dGlass, 'or press anything');

  /* ---- U5 settings ---- */
  const settings = el('div', 'hd-screen hd-settings', root);
  const sGlass = el('div', 'hd-glass', settings);
  el('div', 'hd-kicker', sGlass, 'Settings');
  el('div', 'hd-small hd-note', sGlass, 'Any change marks your score as adjusted · colours do not');
  const rows = OPT_NAMES.map((n, k) => {
    const row = el('div', 'hd-sl' + (k >= 8 ? ' hd-colour' : ''), sGlass);
    const label = el('div', 'hd-sl-label', row, n);
    const track = el('div', 'hd-track' + (k === 8 ? ' hd-neon' : k === 9 ? ' hd-accent' : ''), row);
    const fill = el('div', 'hd-fill', track), knob = el('div', 'hd-knob', track);
    /* the whole row is the target, as on the site; the value is the fraction
       of the track under the pointer, and the game writes it back next frame */
    row.classList.add('hd-hit');
    let held = false;
    const at = e => { const r = track.getBoundingClientRect(); return r.width > 0 ? (e.clientX - r.left) / r.width : 0; };
    row.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); held = true; try { row.setPointerCapture(e.pointerId); } catch (err) {} act('optFrac', { i: k, t: at(e) }); });
    row.addEventListener('pointermove', e => { if (held) act('optFrac', { i: k, t: at(e) }); });
    const lift = () => { held = false; };
    row.addEventListener('pointerup', lift); row.addEventListener('pointercancel', lift);
    return { row, label: slot(label), fill, knob, t: -1, isHeld: () => held };
  });
  const sRow = el('div', 'hd-row', sGlass);
  pill(sRow, 'hd-reset', 'Reset', 'setReset');
  pill(sRow, 'hd-hot hd-done', 'Done', 'setDone');

  const screens = { title, pause, dead, settings };
  for (const k in screens) screens[k].style.display = 'none';   // nothing shows until the first frame says what to
  hud.style.display = 'none';
  let cw = 0, ch = 0, portrait = null, mode = null, hudOn = null, hudAlpha = null, lastTierT = -1, fsShown = null, audioShown = null;
  const show = (node, on) => { const d = on ? '' : 'none'; if (node.style.display !== d) node.style.display = d; };

  /* called once per frame with the view snapshot; returns the scrim this
     screen wants over the scene, or null for none */
  function update(v, sample) {
    const ui = v.ui || sample || SAMPLE;
    const w = v.W * v.ZOOM, h = v.H * v.ZOOM;
    if (w !== cw || h !== ch) {
      cw = w; ch = h; const p = h > w;
      const u = Math.min(w, h * 1.25) / 100, s = Math.min(1.25, Math.max(0.8, v.H / 720)) * v.ZOOM;
      root.style.setProperty('--u', u + 'px'); root.style.setProperty('--s', s + 'px');
      root.style.setProperty('--cw', w + 'px'); root.style.setProperty('--ch', h + 'px');
      if (p !== portrait) { portrait = p; root.classList.toggle('hd-portrait', p); }
    }
    const st = v.state, paused = !!v.paused && st === 'play';
    const m = ui.setOpen ? 'settings' : st === 'title' ? 'title' : st === 'dead' ? 'dead' : paused ? 'pause' : 'play';
    if (m !== mode) { mode = m; for (const k in screens) show(screens[k], k === m); }
    const hudWanted = (st === 'play' || st === 'dying') && !ui.setOpen;
    if (hudWanted !== hudOn) { hudOn = hudWanted; show(hud, hudWanted); }
    const alpha = paused ? '0.35' : '';
    if (alpha !== hudAlpha) { hudAlpha = alpha; hud.style.opacity = alpha; }

    if (hudWanted) {
      const hd = v.hud;
      score(String(hd.score)); mul('x' + hd.mul.toFixed(1));   // the HUD numeral is raw, as the reference and the site draw it
      show(dailyTag, !!hd.daily); if (hd.daily) dailyT('daily #' + ui.dailyNo);
      show(thread, hd.chain > 0);
      if (hd.chain > 0) { threadT('threaded ' + hd.chain); threadO((0.4 + 0.6 * Math.min(1, hd.chainT / 1.2)).toFixed(3)); }
      const name = TIER_NAME[hd.tier] || ui.tierName || '';
      if (hd.tierT > 0) {
        const a = Math.min(1, hd.tierT / TIER_FLASH), age = TIER_FLASH - hd.tierT, sc = 1 + Math.max(0, 0.35 - age) * 1.4;
        show(banner, true); bannerT(name); bannerO(a.toFixed(3)); bannerX('scale(' + sc.toFixed(4) + ') skewX(-8deg)');
        show(tier, false); lastTierT = hd.tierT;
      } else { if (lastTierT !== 0) { show(banner, false); show(tier, true); lastTierT = 0; } tierT(name); }
      const fs = ui.fs === null || ui.fs === undefined ? 'none' : ui.fs ? 'on' : 'off';
      if (fs !== fsShown) { fsShown = fs; show(bFull, fs !== 'none'); bFull.innerHTML = fs === 'on' ? ICON.unfull : ICON.full; }
      if (ui.audio !== audioShown) { audioShown = ui.audio; bMute.innerHTML = ui.audio ? ICON.sound : ICON.muted; }
    }
    if (m === 'title') {
      tKick('Today · track #' + ui.dailyNo); tCount(ui.countdown || '');
      tSoundT(ui.audio ? 'Sound on' : 'Sound off');
      show(tBest, ui.best > 0); if (ui.best > 0) tBestT('Best ' + fmt(ui.best));
      return 'radial-gradient(ellipse at center, rgba(4,2,14,0.55) 0%, rgba(4,2,14,0.25) 45%, rgba(0,0,8,0.6) 100%)';
    }
    if (m === 'dead') {
      const d = ui.dead || SAMPLE.dead;
      dCause(CAUSE[d.cause] || 'Run over'); dScore(fmt(v.hud.score));
      dBest.classList.toggle('hd-new', !!d.best); dBestT(d.best ? 'New best' : 'Best ' + fmt(ui.best));
      dProv(d.label + ' · ' + (d.adjusted ? 'adjusted' : 'unchanged') + ' · ' + (ui.tierName || '').toLowerCase());
      show(dAny, !ui.lock);
      return 'radial-gradient(ellipse at center, rgba(30,0,12,0.45) 0%, rgba(20,0,10,0.75) 100%)';
    }
    if (m === 'settings') {
      const opts = ui.opts || SAMPLE.opts;
      for (let k = 0; k < rows.length; k++) {
        const r = rows[k], o = opts[k]; if (!o) continue;
        r.label(o.label);
        if (o.t !== r.t) { r.t = o.t; const pc = (o.t * 100).toFixed(2) + '%'; r.fill.style.width = pc; r.knob.style.left = pc; }
        r.row.classList.toggle('hd-held', r.isHeld());
      }
      return 'rgba(4,2,14,0.55)';
    }
    if (m === 'pause') return 'rgba(4,2,14,0.55)';
    return null;
  }
  return { update, root };
}
