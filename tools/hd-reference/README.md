# Night Circuit reference renderer

These files made every still and clip that was reviewed and approved for the
Night Circuit look (the stills are in `docs/night-circuit/stills/`). They are
the visual source of truth for the build described in
`docs/night-circuit/BRIEF.md`: when the brief and the reference disagree on a
number, the reference wins, because it is what was approved.

They are not production code. `anim.html` rebuilds recorded frames of the real
game in WebGL. It does no simulation of its own and it reads its input from a
recording, not from the live game.

## Files

- `seq.cjs` drives the real game in headless Chromium with an autopilot and
  records every frame's state (camera, ball, obstacles, pickup, sparks, shards,
  HUD values) plus the track and scenery it saw, to `seq-<tag>.json`. The fields
  it records are exactly the interface the new renderer needs (brief, section 4).
- `anim.html` renders a recorded run in the Night Circuit look. Query options:
  `seq`, `from`, `to`, `w`, `h`, `ui=title|pause|dead|settings`, `tier=0..5`
  (force a sky stage), `hud=0`, `stage=` (JSON overriding obstacle kinds by id).
- `cine.cjs` loads `anim.html`, steps frames, screenshots them, and encodes an
  mp4 with ffmpeg.

## Running it

```
cd tools/hd-reference
npm install three@0.170.0 playwright @fontsource/unbounded @fontsource/saira
# two static servers: the game, and this folder
(cd ../../public && python3 -m http.server 8766) &
python3 -m http.server 8770 &
# record 75 s of seed 4242, then render the approved cruise clip
node seq.cjs 1280 720 75 R1 4242
node cine.cjs R1 110 268 1280 720 cruise
# a single still: frame 300 with the title screen over it
node cine.cjs R1 285 300 1280 720 title "&ui=title" "300"
```

`seq.cjs` takes `fall` or `hit` and a time as extra arguments to stage a death
(`node seq.cjs 1280 720 32 R3 4242 hit 20.6`). The approved clips used these
windows: cruise R1 110 to 268, tunnel R1 330 to 432, shield R1 2 to 66 then
745 to 805, plunge R1 795 to 972 with `stage={"17":{"kind":3,"ph":0.2}}`,
crash R3 640 to 739. Phone stills used a 390 × 844 recording (`P1`) rendered
at 780 × 1688.

Rendering runs on the CPU when there is no GPU (SwiftShader), at roughly one
to three seconds a frame. The output folders and recordings are ignored by git.
