#!/usr/bin/env python3
"""Package Hurtle for a game portal.

    python3 tools/build_portal.py crazygames
    python3 tools/build_portal.py newgrounds

Writes dist/<portal>/ (index.html plus music/) and dist/hurtle-<portal>.zip,
which is the file uploaded to that portal. Standard library only.

This never touches public/, and dist/ is ignored by git and outside what
wrangler serves, so hurtle.site is unaffected: it keeps zero external requests.
The portal copy differs from the site in four ways only:

  1. PORTAL is set, which hides the share button and starts with sound on.
     On CrazyGames it also hides the fullscreen button, which they ban, and
     switches on the SDK bridge (gameplay start and stop, happytime, the
     host's mute setting). Elsewhere the fullscreen button stays, drawn only
     when the host's frame actually permits fullscreen.
  2. CrazyGames only: their SDK script tag is added. This is the single
     external request, and it exists only in that copy.
  3. Everything that points at hurtle.site or snap-hit.online is removed: the
     canonical, icons, Open Graph and Twitter tags, the JSON-LD, and the footer
     with the cluster page links. Portals expect a game, not an advert.
  4. The title loses its tagline.

Every substitution asserts how many times it matched, so a change to the game
that moves one of these lines fails the build loudly rather than shipping a
copy with the links still in it.
"""
import os
import re
import shutil
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'public')
SDK_TAG = '<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>'
# portal -> the SDK tag it needs, if any
PORTALS = {'crazygames': SDK_TAG, 'newgrounds': None}
TRACKS = ['track-%d.m4a' % i for i in range(1, 6)]


def fail(msg):
    sys.exit('build_portal: ' + msg)


def sub(html, pattern, repl, expect, flags=0):
    new, n = re.subn(pattern, repl, html, flags=flags)
    if n != expect:
        fail('expected %d match(es) for %r, found %d' % (expect, pattern, n))
    return new


def build_html(html, portal):
    sdk = PORTALS[portal]
    html = sub(html, r"const PORTAL = null;", "const PORTAL = '%s';" % portal, 1)
    # The share button is hidden on the portal; this removes the address from
    # the text it would have built as well, so the copy carries no URL at all.
    html = sub(html, r"\(PORTAL \? '' : '\\nhurtle\.site'\)", "''", 1)
    html = sub(html, r'<title>[^<]*</title>', '<title>Hurtle</title>', 1)
    html = sub(html, r'<meta name="description"[^>]*>\n', '', 1)
    html = sub(html, r'<link rel="canonical"[^>]*>\n', '', 1)
    html = sub(html, r'<meta name="robots"[^>]*>\n', '', 1)
    html = sub(html, r'<link rel="(?:icon|apple-touch-icon)"[^>]*>\n', '', 2)
    html = sub(html, r'<meta (?:property="og:|name="twitter:)[^>]*>\n', '', 13)
    html = sub(html, r'<script type="application/ld\+json">.*?</script>\n', '', 1, re.S)
    html = sub(html, r'<div id="chrome">.*?</div>\n</div>\n', '', 1, re.S)
    # Before the stylesheet, so the SDK is defined long before boot() runs at
    # the end of the body.
    if sdk:
        html = sub(html, r'<style>', sdk + '\n<style>', 1)

    # The checks that matter, made on the output rather than trusted from above.
    for needle in ('hurtle.site', 'snap-hit.online', 'beakdown', 'slope-2',
                   'slope-3', 'slope-online', 'href="/', 'src="/', "'/music"):
        if needle in html.lower():
            fail('portal copy still contains %r' % needle)
    urls = set(re.findall(r'https?://[^\s"\'<>)]+', html))
    allowed = {'http://www.w3.org/2000/svg'}
    if sdk:
        allowed.add(re.search(r'src="([^"]+)"', sdk).group(1))
    extra = urls - allowed
    if extra:
        fail('unexpected URL(s) in portal copy: %s' % ', '.join(sorted(extra)))
    if html.count(SDK_TAG) != (1 if sdk else 0):
        fail('SDK tag missing, duplicated or in the wrong copy')
    return html


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in PORTALS:
        fail('usage: build_portal.py %s' % '|'.join(sorted(PORTALS)))
    portal = sys.argv[1]
    OUT = os.path.join(ROOT, 'dist', portal)
    ZIP = os.path.join(ROOT, 'dist', 'hurtle-%s.zip' % portal)
    with open(os.path.join(SRC, 'index.html'), encoding='utf-8') as f:
        html = build_html(f.read(), portal)

    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(os.path.join(OUT, 'music'))
    with open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)
    for t in TRACKS:
        src = os.path.join(SRC, 'music', t)
        if not os.path.isfile(src):
            fail('missing ' + src)
        shutil.copyfile(src, os.path.join(OUT, 'music', t))

    if os.path.exists(ZIP):
        os.remove(ZIP)
    # index.html at the root of the archive, which is what the uploader expects.
    with zipfile.ZipFile(ZIP, 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(os.path.join(OUT, 'index.html'), 'index.html')
        for t in TRACKS:
            # AAC is already compressed; storing it saves time and nothing else.
            z.write(os.path.join(OUT, 'music', t), 'music/' + t,
                    compress_type=zipfile.ZIP_STORED)

    total = sum(os.path.getsize(os.path.join(dp, fn))
                for dp, _, fns in os.walk(OUT) for fn in fns)
    print('dist/%s/  %d files, %.2f MB' % (portal, 1 + len(TRACKS), total / 1e6))
    print('dist/hurtle-%s.zip  %.2f MB' % (portal, os.path.getsize(ZIP) / 1e6))
    if portal == 'crazygames' and total > 20e6:
        print('warning: over 20 MB, which rules out the mobile homepage')


if __name__ == '__main__':
    main()
