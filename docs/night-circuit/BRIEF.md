# Night Circuit: build brief

The portal edition of Hurtle gets a new look, called Night Circuit: a real 3D
city at dusk turning to night, a glossy road with light rails, and a full set
of effects and menus. Every element in it has been rendered from real runs of
the game, reviewed item by item, and approved. This brief turns that review
into a build.

Read `CLAUDE.md` first. Everything in it still holds.

## 1. What success looks like

- `python3 tools/build_portal.py crazygames` and `... newgrounds` produce zips
  that play in the Night Circuit look, matching the approved stills in
  `docs/night-circuit/stills/` closely enough that the reviewer would sign them
  off again.
- The game plays exactly as it does today. Same seed, same run, byte for byte.
- hurtle.site is unchanged: same pixels, same zero external requests.
- It holds 60 frames a second on a 4 GB Chromebook at the Low quality level.
- Each zip stays under 20 MB, which keeps CrazyGames' mobile homepage open.

## 2. Non-negotiables

1. **The simulation is not touched.** Not the `K` block, not the seeded stream,
   not the fixed timestep, not collision, not generation. The new renderer only
   reads state. Anything cosmetic that needs randomness uses `Math.random` or
   its own generator, never `run.rnd`.
2. **Determinism is the gate for every phase.** Before and after each phase,
   record the same seeded runs with a manual clock (as `tools/hd-reference/seq.cjs`
   does) and compare the simulation state frame by frame. Any difference stops
   the work until it is explained.
3. **hurtle.site keeps today's renderer** and stays pixel identical. Prove it by
   rendering the same seeded frames on the 2D path before and after your changes
   and comparing the screenshots.
4. **Nothing new enters `public/`** except the small hooks in section 4. three.js,
   the new renderer, fonts and any other assets live outside `public/` and only
   reach the portal zips through `tools/build_portal.py`.
5. **No external requests in the Newgrounds copy.** The CrazyGames copy keeps
   its one, the SDK tag. Everything else ships inside the zip, referenced by
   relative paths.
6. Do not edit `wrangler.jsonc`. Do not run `wrangler deploy`. A push to `main`
   deploys the site, so push only after the site checks in section 9 pass.

## 3. The approved look

Source of truth, in order: the approved stills in `docs/night-circuit/stills/`,
then `tools/hd-reference/anim.html` for exact numbers (colours, intensities,
timings, sizes), then the prose below. If you need to depart from the reference,
say why in your report.

Item codes are the reviewer's own. Use them in commit messages and reports.

### World (W)

- **W1 City.** Towers are the game's existing `towers` (same positions and
  sizes), drawn as dark glass boxes with lit windows. Window texture density
  scales with the tower (roughly one tile per 70 by 260 units). Red aviation
  beacon on every roof, blinking at its own phase. A thin cyan spire on towers
  taller than 1300. Towers are filtered by lateral clearance from the track:
  240 units in landscape, 20 in portrait. Filtering is render only; generation
  is unchanged.
- **W2 Skylanes.** Two lanes of traffic every 700 units of track, 120 to 800
  below the deck, crossing the void. Small emissive boxes, white headlights one
  way and red tail-lights the other, about 46 cars per lane. Instanced.
- **W3 Searchlights.** About six pale open cones rising from far below,
  additive, fading along their length, sweeping slowly.
- **W4 Billboards.** On roughly a third of towers, a panel on the face toward
  the track, showing one of three animated abstract patterns (scrolling bars,
  waveforms, a level meter). No words, no logos, no brands.
- **W5 Hover craft.** A few capsule craft gliding across above the deck with
  magenta or cyan underglow and a short light trail.
- **W6 Sky and cloud.** A sky dome coloured by elevation, stars above the haze
  from Plunge onwards, low cloud sprites below the deck tinted to each sky
  stage.
- **W7 Sky by tier.** Realistic skies only, getting later as speed rises. One
  stage per speed tier, blended over 2.5 seconds with a smoothstep:

  | Tier | Stage | Horizon | Sun glow | Stars | Window level | Glow (bloom) |
  |---|---|---|---|---|---|---|
  | Drift | golden hour | `#f4b47a` | 1.0 | 0 | 0.35 | 0.50 |
  | Rush | sunset | `#ff8a48` | 0.85 | 0 | 0.50 | 0.58 |
  | Plunge | after sunset | `#c86a5c` | 0.35 | 0.15 | 0.65 | 0.66 |
  | Freefall | blue hour | `#4a5a9a` | 0.1 | 0.55 | 0.78 | 0.74 |
  | Terminal | night | `#1c2648` | 0 | 1 | 0.85 | 0.78 |
  | Escape velocity | deep night | `#10183a` | 0 | 1 | 0.90 | 0.80 |

  Full values (zenith, mid sky, below-horizon haze, fog, light colours and
  intensities, cloud tint) are in `TIERS` in `anim.html`. The sun sits low,
  ahead and to the left; only its glow shows, never a disc.

### Track (T)

- **T1 Road.** Glossy dark surface (roughness about 0.22, metalness 0.55) that
  reflects a night environment map, cyan dashed lane lines at one and two thirds
  of the width, a faint transverse grid.
- **T2 Rails.** Orange light strips on both edges, with bright pulses scrolling
  downhill. Dark sides with a thin orange top stripe.
- **T3 Gaps.** Yellow chevron strips across both lips of every hole, blinking,
  and an orange glowing cut face.
- **T4 Tunnels.** Dark and enclosed: solid walls and a roof, so no sky or city
  inside. A bright cyan mouth frame, thin dim ring strips every 150 units that
  brighten slightly just ahead of the ball, haze closing in (fog near 120, far
  1400, near black).

### Obstacles (O)

Dark glass blocks with glowing edges and a soft halo, coloured by kind:

- **O1 Static** magenta.
- **O2 Sliding** magenta with double chevrons on top pointing the way it moves.
- **O3 Rising** amber, with a floor pad that pulses where it will come up and
  brightens as it rises (driven by `riseFrac`).
- **O4 Dropping** violet, hovering, with a floor pad marking where it lands.

### Ball and effects (E)

- **E1 Ball.** Metallic silver (`#d4d8de`, metalness 1, roughness 0.16), no
  colour of its own. Soft white trail of fading sprites, a contact shadow on the
  road, a soft white point light that lights the road around it. Drawn at 1.9
  times `K.BALL_R` (approved decision D1: today's 2D game already draws it about
  twice true size). Collision is not changed.
- **E2 Shield pickup.** Spinning green crystal with a ring, a halo and a tall
  green beam visible from far away.
- **E3 Collect.** An expanding green ring and flash when the shield is taken.
- **E4 Shield active.** A slowly turning green wireframe cage around the ball
  with a green rim glow.
- **E5 Shield absorbs a hit.** The cage disappears and the ball flashes for two
  seconds. The block breaks into the game's own shards. No white flash and no
  colour split. Grace-window recoveries look the same.
- **E6 Sparks.** The game's own `sparks`, drawn as additive glowing points.
- **E7 Speed streaks.** Rain-like streaks rushing past the camera, faint at Drift,
  denser and longer as speed rises.
- **E8 Tier change.** The tier banner (section 5), a shockwave ring along the
  road in the tier's accent colour, a brief lift in window and glow levels, a
  short colour split, and the sky starts its blend.
- **E9 Death off the edge.** The ball drops away into the depths, the camera
  shakes (about 16 px decaying over a second), the stretch of edge you crossed
  glows pulsing red, and the screen edges darken to red.
- **E10 Death by crash.** The ball shatters into glowing fragments, only the
  block you hit flashes red, and the picture glitches into colour for half a
  second.

The rule behind E9 and E10 is today's: always show the player what killed them.

### Screens (U)

Menus are an HTML overlay over the live scene. Display type is Unbounded, body
type is Saira, both bundled into the portal zip (decision D2) and never into
`public/`. The overlay buttons call the same functions the canvas buttons call
today, and keyboard and touch steering are unchanged.

- **U1 In-play HUD.** Score top centre, multiplier under it, daily tag,
  Threaded count, tier name small at the bottom, pause, music and skip buttons
  as neon outlined circles.
- **U2 Title.** HURTLE in capitals with the glowing orange rule, "Today · track
  #N", "new track in hh:mm:ss", Play today's track (the hot button), Random
  track, Settings, Sound on or off, Best N, the controls line. The ball is hidden.
- **U3 Pause.** Scene dimmed, Paused, Resume (hot), Home, the shortcuts line.
- **U4 Death screen.** A glass panel: the cause (Off the edge, Hit a block,
  Fell through a gap, from `run.overKind`), the score, New best when it is,
  the provenance line (daily or random track, unchanged or adjusted, tier
  reached), Home and Go again.
- **U5 Settings.** A glass panel with the ten existing sliders, a rainbow track
  for Neon, and the note that colours never mark a score as adjusted.
- **U6 Phone.** The same screens at 390 by 844, with thumb-sized buttons and a
  larger HUD.

### Decisions

- **D1** ball at 1.9 times true size, as above.
- **D2** bundled fonts in the portal build only.
- **D3** the sky stage follows the speed tier, as in W7.
- **D4** a quality level: High is what was reviewed. Low turns off glow,
  billboards, traffic and searchlights, caps the pixel ratio at 1, and halves
  cloud and streak counts. The game picks the level from the frame rate over
  its first two seconds (below about 50 frames a second, drop to Low) and
  remembers it per browser, inside try/catch.

## 4. Architecture

### Split camera from drawing

Today `draw()` both computes the camera (render interpolation, height, roll,
pitch, `projBase`, the keep-the-ball-on-screen shift, shake) and paints the 2D
canvas. Split it into `updateView()`, which computes those values and touches
no simulation state, and the existing painting. The 2D path then calls
`updateView()` and paints exactly as before. Prove the split is invisible with
the pixel comparison from section 2.

Check first that no camera global (`camX`, `camZ`, `roll` and the rest) feeds
the simulation. If one does, it stays where it is and you report it.

### One hook

```js
/* null on the site; set by tools/build_portal.py in the portal copies */
const HD = null;
```

In the frame loop, after the simulation steps: `if (HD) HD.render(viewState())
else draw()`. `viewState()` builds a read-only snapshot. Its fields are exactly
what `tools/hd-reference/seq.cjs` records each frame (camera, ball, obstacles
with `riseFrac`, pickup, sparks, shards, `flashT`, HUD values, state and death
kind), plus the track slices, gaps, tunnels and towers in view. Reuse that
shape; it is already proven to be enough to draw every approved item.

### Where the renderer lives

- `portal/hd/renderer.js`: the Night Circuit renderer, an ES module that
  exports `init(canvas, overlayRoot)` and `render(view)`.
- `portal/hd/vendor/`: three.js r170 (`three.module.min.js`) and only the addons
  used (EffectComposer, RenderPass, UnrealBloomPass, ShaderPass, OutputPass,
  RGBShiftShader). MIT licence file alongside.
- `portal/hd/fonts/`: Unbounded and Saira woff2 files, OFL licence alongside.
- `portal/hd/ui.css`: the overlay styles.

`tools/build_portal.py` copies `portal/hd/` into the zip as `hd/`, adds a
module script that sets `window.HURTLE_HD`, and sets the `HD` line to read it.
Add a `--no-hd` flag that builds today's look, so a portal copy can be rolled
back without touching the site.

### Performance

- One draw call per material where possible: merge or instance towers,
  windows, beacons, traffic and particles.
- Window and billboard textures are shared; billboards repaint at most 15 times
  a second.
- Shadows are blob textures, not shadow maps.
- Measure on a throttled profile (Chrome's 4x CPU slowdown at 1366 by 768) at
  both quality levels and report the median and 5th percentile frame times.

## 5. Gameplay-adjacent changes the reviewer agreed

- **Pause on P only in the CrazyGames copy.** Their guidelines ask games to
  avoid Escape, which also leaves their fullscreen. The site and Newgrounds
  keep P and Escape.
- **Ball skins, unlocked by best score.** A small progression loop. Propose six
  cosmetic skins (silver is the default) and their unlock scores, render them as
  one still sheet with the reference renderer, and **stop for approval before
  building them**. They are cosmetic only and never affect the
  unchanged/adjusted provenance.

## 6. Phases and check-ins

Report at the end of each phase with evidence (numbers, stills, the
determinism result), then carry on unless a phase says stop.

1. **Split and hook.** `updateView()`, `viewState()`, the `HD` line. Determinism
   identical, site pixels identical. Push only this phase to `main`, after the
   checks pass.
2. **World and track.** Sky by tier, city, skylanes, searchlights, billboards,
   craft, cloud, road, rails, gaps, tunnels. Render the reference frames listed
   in `tools/hd-reference/README.md` with your renderer and put them side by
   side with the approved stills.
3. **Ball, obstacles and effects.** E1 to E10 and O1 to O4, with the same side by
   side comparison, plus short clips of the shield, the fall and the crash.
4. **Screens.** U1 to U6, desktop and phone, wired to the real handlers.
5. **Quality and performance.** D4, the measurements above, the 20 MB check.
6. **Skins.** The still sheet, then **stop** for approval.
7. **Package.** Both zips, then new covers (1920 by 1080, 800 by 1200, 800 by
   800, title only) and preview videos (15 to 20 seconds, 1080p 16:9 and 2:3,
   no audio, opening on the cover) rendered from the real build.

## 7. CrazyGames requirements that still apply

Relative paths only. No custom fullscreen button. No links or mentions that
lead to hurtle.site, Beakdown or any other playable copy. Readable at 907 by
510, 1216 by 684, 1077 by 606, 821 by 462, 1366 by 768, 1920 by 1080, 1536 by
864, 1280 by 720, 800 by 450 and 1080 by 607. Physics consistent across refresh
rates (already true, keep it). English. PEGI 12. Initial download under 20 MB.
The existing SDK bridge (`HOST`) keeps working: gameplay start and stop,
happytime, and the host's mute.

## 8. What not to do

- Do not "improve" the feel while you are in there. Report ideas instead.
- Do not add a build step for the site, a framework, or a bundler.
- Do not load anything from a CDN, including three.js and fonts.
- Do not let a menu or effect hide the cause of a death.

## 9. Checks before any push

- Determinism: identical simulation state across the recorded runs.
- Site pixels: identical 2D screenshots at the recorded frames.
- `grep` of `public/` finds no three.js, no font files, no `hd/` path, no SDK tag.
- Both portal builds print 6 or more files, stay under 20 MB, and the Newgrounds
  copy contains no `http` URL apart from the SVG namespace.
- `git status` shows nothing from `dist/`, `node_modules/` or render output.
