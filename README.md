# hurtle

The game and site behind https://hurtle.site

## Layout

    public/          everything the world sees
    wrangler.jsonc   Cloudflare config. Routes and html_handling are load-bearing.
    CLAUDE.md        the constraints. Read it before changing anything.

## Deploying

Push to `main`. Cloudflare Workers Builds runs `npx wrangler deploy` and
publishes `public/`. Wait about a minute before checking, because the rollout
crosses edge nodes and a mixture of old and new responses reads like a failure.

Pushing to any other branch produces a preview version rather than promoting it
to production.

## Verifying a deploy

    curl -s "https://hurtle.site/?cb=$(date +%s)" -o /tmp/live.html
    sha256sum /tmp/live.html

## Integrity baseline, 31 July 2026

| File | Bytes |
|---|---|
| index.html | 186,726 |
| slope-2.html | 19,366 |
| slope-3.html | 18,933 |
| slope-online.html | 18,882 |
| 404.html | 4,348 |
| og.png | 74,144 |
| icon.png | 54,669 |
| apple-touch-icon.png | 18,513 |
| sitemap.xml | 484 |
| llms.txt | 1,013 |
| robots.txt | 65 |

`index.html` sha256
`107ce59e0409b2473e9a7abb8a4f2e4d20d1c1a060f166e50635b187a10dd47f`
