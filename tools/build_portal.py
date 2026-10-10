#!/usr/bin/env python3
"""Package Hurtle for a game portal.

    python3 tools/build_portal.py crazygames
    python3 tools/build_portal.py newgrounds
    python3 tools/build_portal.py newgrounds --no-hd     # today's 2D look

Writes dist/<portal>/ and dist/hurtle-<portal>.zip, the file uploaded to that
portal. Standard library only.

This never touches public/, and dist/ is ignored by git and outside what
wrangler serves, so hurtle.site is unaffected: it keeps zero external requests.
The portal copy differs from the site in these ways only:

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
  5. The Night Circuit renderer, always on. The site picks Night Circuit or
     Classic in a small script at the top of index.html; a portal copy has no
     Classic, so that script is replaced by the three tags it would have
     written: the import map, the overlay styles and hd/boot.js. public/hd/ is
     copied into the zip as hd/. If the module fails to load, or WebGL is
     unavailable, hd/boot.js leaves window.HURTLE_HD unset and the game falls
     back to its 2D painter by itself. --no-hd drops the tags and the folder
     and builds the 2D look.

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
HD_SRC = os.path.join(SRC, 'hd')
SDK_TAG = '<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>'
# portal -> the SDK tag it needs, if any
PORTALS = {'crazygames': SDK_TAG, 'newgrounds': None}
TRACKS = ['track-%d.m4a' % i for i in range(1, 6)]
HD_TAGS = ('<script type="importmap">{"imports":{"three":"./hd/vendor/three.module.min.js"}}</script>\n'
           '<link rel="stylesheet" href="hd/ui.css">\n<script type="module" src="hd/boot.js"></script>')

def fail(msg):
    sys.exit('build_portal: ' + msg)


def sub(html, pattern, repl, expect, flags=0):
    new, n = re.subn(pattern, repl, html, flags=flags)
    if n != expect:
        fail('expected %d match(es) for %r, found %d' % (expect, pattern, n))
    return new


def build_html(html, game_js, portal, hd):
    sdk = PORTALS[portal]
    game_js = sub(game_js, r"const PORTAL = null;", "const PORTAL = '%s';" % portal, 1)
    # The share button is hidden on the portal; this removes the address from
    # the text it would have built as well, so the copy carries no URL at all.
    game_js = sub(game_js, r"\(PORTAL \? '' : '\\nhurtle\.site'\)", "''", 1)
    html = sub(html, r'<title>[^<]*</title>', '<title>Hurtle</title>', 1)
    html = sub(html, r'<meta name="description"[^>]*>\n', '', 1)
    html = sub(html, r'<link rel="canonical"[^>]*>\n', '', 1)
    html = sub(html, r'<meta name="robots"[^>]*>\n', '', 1)
    html = sub(html, r'<link rel="(?:icon|apple-touch-icon)"[^>]*>\n', '', 2)
    html = sub(html, r'<meta (?:property="og:|name="twitter:)[^>]*>\n', '', 13)
    html = sub(html, r'<script type="application/ld\+json">.*?</script>\n', '', 1, re.S)
    # the footer with the cluster links, and the look switch that lives in it
    html = sub(html, r'<div id="chrome">.*?</div>\n</div>\n', '', 1, re.S)
    html = sub(html, r'<!-- The switch between the two looks\..*?</script>\n', '', 1, re.S)
    # the site's Night Circuit or Classic choice: a portal is Night Circuit only
    html = sub(html, r'<!-- Night Circuit or Classic, decided.*?</script>\n', (HD_TAGS + '\n') if hd else '', 1, re.S)
    # Before the stylesheet, so the SDK is defined long before boot() runs at
    # the end of the body.
    if sdk:
        html = sub(html, r'<style>', sdk + '\n<style>', 1)
    if html.count('<script defer src="game.js"></script>') != 1:
        fail('index.html does not load game.js exactly once')

    # The checks that matter, made on the output rather than trusted from above.
    for text, label in ((html, 'index.html'), (game_js, 'game.js')):
        for needle in ('hurtle.site', 'snap-hit.online', 'beakdown', 'slope-2',
                       'slope-3', 'slope-online', 'href="/', 'src="/', "'/music"):
            if needle in text.lower():
                fail('%s still contains %r' % (label, needle))
        low = text.lower()
        urls = set(re.findall(r'https?://[^\s"\'<>)]+', low))
        # protocol-relative references and CSS fetches are addresses too
        if re.search(r'(?:src|href)\s*=\s*["\']//', low) or re.search(r'url\(\s*["\']?//', low) or '@import' in low:
            fail('%s carries a protocol-relative or CSS fetch' % label)
        allowed = {'http://www.w3.org/2000/svg'}
        if sdk:
            allowed.add(re.search(r'src="([^"]+)"', sdk).group(1))
        extra = urls - allowed
        if extra:
            fail('unexpected URL(s) in %s: %s' % (label, ', '.join(sorted(extra))))
    if html.count(SDK_TAG) != (1 if sdk else 0):
        fail('SDK tag missing, duplicated or in the wrong copy')
    if 'const HD = window.HURTLE_HD || null;' not in game_js:
        fail('the HD hook is not pointed at the renderer')
    if hd != ('hd/boot.js' in html) or 'look=' in html or 'HURTLE_LOOK' in html:
        fail('the renderer tags are wrong for this build, or the site choice survived')
    return html, game_js


def copy_hd(out):
    if not os.path.isdir(HD_SRC):
        fail('public/hd/ is missing; build with --no-hd for the 2D look')
    dst = os.path.join(out, 'hd')
    shutil.copytree(HD_SRC, dst, ignore=shutil.ignore_patterns('*.md', '.DS_Store'))   # notes stay out of the zip, licences go in
    files = []
    for dp, _, fns in os.walk(dst):
        for fn in fns:
            files.append(os.path.join(dp, fn))
    files.sort()        # a reproducible archive
    for must in ('boot.js', 'renderer.js', 'screens.js', 'ui.css', os.path.join('vendor', 'three.module.min.js')):
        if not os.path.isfile(os.path.join(dst, must)):
            fail('hd/ is missing ' + must)
    # Nothing in hd/ may fetch from anywhere or point at the site: every text
    # member is read, not just the scripts. The two XML namespace strings are the
    # only addresses allowed, because browsers never fetch them. The font licences
    # are the one exception: the OFL requires the licence text to travel with the
    # font as written, URLs included, and nothing ever loads a licence file.
    licences = []
    for f in files:
        rel = os.path.relpath(f, out)
        if f.endswith(('.woff2', '.png', '.jpg', '.m4a')):
            continue
        with open(f, encoding='utf-8', errors='replace') as fh:
            low = fh.read().lower()
        if re.search(r'url\(\s*["\']?//', low) or re.search(r'(?:src|href)\s*=\s*["\']//', low) or '@import' in low:
            fail('%s carries a protocol-relative or CSS fetch' % rel)
        for needle in ('hurtle.site', 'snap-hit.online', 'beakdown', 'slope-2', 'slope-3',
                       'slope-online', 'href="/', 'src="/', "'/music", 'url(/'):
            if needle in low:
                fail('%s still contains %r' % (rel, needle))
        urls = set(re.findall(r'https?://[^\s"\'<>)]+', low))
        urls -= {'http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xhtml'}
        if rel.replace(os.sep, '/') in ('hd/fonts/LICENSE.saira', 'hd/fonts/LICENSE.unbounded'):
            if urls:
                licences.append(rel)
            continue
        if urls:
            fail('%s carries a URL: %s' % (rel, ', '.join(sorted(urls))))
    if licences:
        print('  licence text with its own URLs, required by the OFL and never fetched: ' + ', '.join(licences))
    return files


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = set(a for a in sys.argv[1:] if a.startswith('--'))
    if len(args) != 1 or args[0] not in PORTALS or flags - {'--no-hd'}:
        fail('usage: build_portal.py %s [--no-hd]' % '|'.join(sorted(PORTALS)))
    portal, hd = args[0], '--no-hd' not in flags
    OUT = os.path.join(ROOT, 'dist', portal)
    ZIP = os.path.join(ROOT, 'dist', 'hurtle-%s.zip' % portal)
    with open(os.path.join(SRC, 'index.html'), encoding='utf-8') as f:
        page = f.read()
    with open(os.path.join(SRC, 'game.js'), encoding='utf-8') as f:
        game = f.read()
    html, game_js = build_html(page, game, portal, hd)

    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(os.path.join(OUT, 'music'))
    with open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)
    with open(os.path.join(OUT, 'game.js'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(game_js)
    members = [('index.html', zipfile.ZIP_DEFLATED), ('game.js', zipfile.ZIP_DEFLATED)]
    if hd:
        for f in copy_hd(OUT):
            rel = os.path.relpath(f, OUT).replace(os.sep, '/')
            # woff2 is already compressed; store it
            members.append((rel, zipfile.ZIP_STORED if rel.endswith('.woff2') else zipfile.ZIP_DEFLATED))
    for t in TRACKS:
        src = os.path.join(SRC, 'music', t)
        if not os.path.isfile(src):
            fail('missing ' + src)
        shutil.copyfile(src, os.path.join(OUT, 'music', t))
        # AAC is already compressed; storing it saves time and nothing else.
        members.append(('music/' + t, zipfile.ZIP_STORED))

    if os.path.exists(ZIP):
        os.remove(ZIP)
    # index.html at the root of the archive, which is what the uploader expects.
    with zipfile.ZipFile(ZIP, 'w') as z:
        for rel, comp in members:
            z.write(os.path.join(OUT, rel), rel, compress_type=comp)

    total = sum(os.path.getsize(os.path.join(dp, fn))
                for dp, _, fns in os.walk(OUT) for fn in fns)
    print('dist/%s/  %d files, %.2f MB%s' % (portal, len(members), total / 1e6, '' if hd else '  (--no-hd)'))
    zsize = os.path.getsize(ZIP)
    print('dist/hurtle-%s.zip  %.2f MB' % (portal, zsize / 1e6))
    # the brief's limit is on the zip (CrazyGames' 20 MB initial download), and it is a limit
    if zsize > 20e6:
        os.remove(ZIP)
        fail('the zip is %.2f MB; the limit is 20 MB' % (zsize / 1e6))


if __name__ == '__main__':
    main()
