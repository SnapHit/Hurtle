// Screenshots frames of a recording drawn by portal/hd/renderer.js, the way
// tools/hd-reference/cine.cjs does for the approved renderer, so the two can be
// compared frame for frame.
//   node shoot.cjs <seq> <from> <to> <w> <h> <name> [stills: comma frame list]
// Serve the repository root first:  (cd ../.. && python3 -m http.server 8771)
const { chromium } = require('playwright'); const fs = require('fs'); (async () => {
const [seq, from, to, w, h, name, stills = ''] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: +w, height: +h } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
await page.goto(`http://localhost:8771/tools/hd-check/play.html?seq=${seq}&w=${w}&h=${h}`);
await page.waitForFunction(() => window.__ready || window.__err, null, { timeout: 240000 }).catch(() => { console.log('LOAD FAIL', errs.join(' | ')); process.exit(1); });
console.log(name, JSON.stringify(await page.evaluate(() => window.__ready)), errs.slice(0, 3).join(' | '));
const want = stills ? new Set(stills.split(',').map(Number)) : null;
const dir = `frames-${name}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
const t0 = Date.now(); let k = 0, st = null;
for (let i = +from; i <= +to; i++) {
  st = await page.evaluate(i => window.renderFrame(i), i);
  if (want && !want.has(i)) continue;
  await page.screenshot({ path: `${dir}/f${String(want ? i : k).padStart(4, '0')}.png`, timeout: 180000 }); k++;
}
console.log(name, k, 'frames', ((Date.now() - t0) / 1000).toFixed(0) + 's', 'stats', JSON.stringify(st), errs.slice(0, 3).join(' | '));
await browser.close(); })();
