# Hurtle

A browser game at https://hurtle.site, plus a three page SEO cluster around it.
Vanilla JavaScript: one page, one game script and the Night Circuit renderer, all
served from the site itself. No framework, no build step, no runtime dependency
fetched from anywhere else.

## How this deploys

Push to `main`. Cloudflare Workers Builds runs `npx wrangler deploy` in its own
container and publishes whatever is in `public/`.

Do not run `wrangler deploy` from a session. The push is the deploy.

Cloudflare rolls a deployment across edge nodes over roughly a minute. Checking
straight after a push returns a convincing mixture of old and new responses that
reads exactly like a broken deploy. Wait, then check.

## Constraints that are not up for negotiation

**Zero external requests.** Nothing loads from off origin: no CDN, no font, no
analytics beacon, no image host. The audience is players on managed school
networks, and content filters categorise a site partly by what it calls out to.
Every URL in the deployed HTML must be either a link a person clicks, a self
reference, or the schema.org namespace string, which browsers never fetch.
Verify with a grep before any deploy, not by assumption.

**No analytics.** Traffic comes from Cloudflare zone analytics, which is server
side, and from Google Search Console. Neither needs a line of page JavaScript.

**No `main` and no Worker script in `wrangler.jsonc`.** That absence is the cost
model: static asset requests are free and unlimited, Worker invocations are not.
Anyone proposing a framework, a build step or a migration to Pages is quietly
undoing it.

**Keep the `routes` block.** Deploying without it can detach the custom domains
and take the site down.

**Keep `html_handling: auto-trailing-slash`.** Every internal link, canonical tag
and sitemap entry uses the extension-less form. Losing that line 404s all four
pages at once.

**There is no `_redirects` file.** Renaming a page 404s the old URL immediately
and loses the ranking with it. If a page is renamed, create `public/_redirects`
first: one rule per line, source path, destination path, `301`.

**Every `localStorage` call stays wrapped in try/catch.** Locked down school
profiles make storage unavailable, and an unwrapped call throws instead of
degrading to a game that simply has no memory.

**The arcade cabinet is triplicated across the three cluster pages,
deliberately.** Factoring it into a shared stylesheet would mean an
external request, which is forbidden above. The pages already duplicate
their entire CSS, so this is consistent rather than a new sin. Leave it.

## The game file

`public/index.html` is the page: meta tags, the boot splash, the footer links and
two small scripts. The game itself is `public/game.js`, around 210 KB raw and
about 70 KB gzipped, which is what Cloudflare actually serves. Judge size by the
compressed figure.

## Two looks: Night Circuit and Classic

Night Circuit is the default. It is a three.js renderer in `public/hd/` that
draws the same game: `game.js` runs the simulation either way and only the
painter changes. Classic is the original 2D canvas. Which one loads is decided by
a script at the end of `<head>` in `index.html`, before anything else loads:

- `?look=classic` or `?look=hd` for one visit. `/classic` redirects to the first.
- Otherwise `localStorage` key `hurtle_look_v1`: `classic` is a player's choice,
  `classic-auto` is the renderer's fallback for a device that cannot hold 30
  frames a second even on Low, `hd` is a player's choice that the fallback must
  never override.
- For Night Circuit that script writes the import map, `hd/ui.css` and the
  `hd/boot.js` module with `document.write`, so the module stays parser-inserted
  and `game.js`, which is deferred, runs after it. Do not replace this with
  `createElement`: an inserted module is async and the game would start before
  the renderer exists.
- If the module fails or WebGL is missing, `window.HURTLE_HD` stays unset and the
  game draws Classic by itself. A Classic visitor downloads none of `hd/`.

Classic must stay pixel-identical to what the site served before Night Circuit:
check `?look=classic` against the previous commit at the same seed and frames.

Inside `game.js`:

- **The `K` block** holds every feel constant. Changing one changes how the game
  plays. Do not touch it for a cosmetic fix.
- **The RNG is seeded.** `?seed=` replays a run exactly, and the daily track is
  derived from the UTC date, so everyone in the world gets the same track on a
  given day. Anything cosmetic that needs a random number must use
  `Math.random`, never the seeded stream: drawing from the seeded stream shifts
  every later call and changes the world.
- **Sparks, scenery and other dressing** are render only and read `animT`, a
  clock the simulation never touches.
- **The daily rollover is midnight UTC**, which is 10am in Sydney during winter.

## Checking a change actually worked

Three failures have each happened here more than once, so check for them by
name:

1. **Drawn but off screen.** A draw function being called proves nothing. Check
   its coordinates land inside the frame.
2. **Drawn but not moving.** Being in frame proves nothing either. Freeze the
   ball, advance the animation clock alone, and confirm the pixels change.
3. **Patched but not applied.** An edit script that throws part way leaves the
   file untouched while the summary still claims success. Re-read the file.

Determinism is the thing most worth protecting: the same seed must produce the
same run, byte for byte, or the daily track stops being comparable between
players.

## The portal copies

`python3 tools/build_portal.py crazygames` and `python3 tools/build_portal.py
newgrounds` write `dist/hurtle-<portal>.zip`, the file uploaded to that portal.
This is packaging, not a build step for the site: it reads `public/` and never
writes to it, and `dist/` is ignored by git.

A copy differs from the site through one line in `game.js`, `const PORTAL =
null;`, which the script sets to the portal's name. With it set: no share button,
no look switch, and sound on by default. CrazyGames additionally loses the
fullscreen button (they ban custom ones) and gets the SDK bridge (`HOST`) and the
SDK tag. Every copy is stripped of links to hurtle.site and snap-hit.online, and
the script fails loudly if any survive. A portal copy is always Night Circuit:
the look choice script is replaced by the tags it would have written. The SDK tag
must never appear in `public/` or in a non-CrazyGames copy.

After any change to the game, rebuild the zips and upload them again. Keep the
five music paths relative.

## House style

Australian English. No em dashes or en dashes, ever; restructure the sentence
instead. Sentence case in headings. Say what changed and what it cost, without
padding.
