# Hurtle

A browser game at https://hurtle.site, plus a three page SEO cluster around it.
Vanilla JavaScript in one self contained HTML file. No framework, no build step,
no runtime dependency.

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

## The game file

`public/index.html` is around 187 KB raw, about 60 KB gzipped, which is what
Cloudflare actually serves. Judge size by the compressed figure.

Inside it:

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

## House style

Australian English. No em dashes or en dashes, ever; restructure the sentence
instead. Sentence case in headings. Say what changed and what it cost, without
padding.
