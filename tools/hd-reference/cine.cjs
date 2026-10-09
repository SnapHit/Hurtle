// node cine.cjs <seq> <from> <to> <w> <h> <name> [extraQuery] [stillsOnly: comma frame list]
const { chromium } = require('playwright'); const fs = require('fs'); const { execSync } = require('child_process'); (async () => {
const [seq, from, to, w, h, name, extra = '', stills = ''] = process.argv.slice(2);
const browser = await chromium.launch({ args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport:{ width:+w, height:+h } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,300)); });
await page.goto(`http://localhost:8770/anim.html?seq=${seq}&from=${from}&to=${to}&w=${w}&h=${h}${extra}`);
await page.waitForFunction(() => window.__ready || window.__err, null, { timeout: 240000 }).catch(e => { console.log('LOAD FAIL', errs.join(' | ')); process.exit(1); });
console.log(name, JSON.stringify(await page.evaluate(() => window.__ready)), errs.slice(0,3).join(' | '));
const want = stills ? new Set(stills.split(',').map(Number)) : null;
const dir = `frames-${name}`; fs.rmSync(dir, { recursive:true, force:true }); fs.mkdirSync(dir);
const t0 = Date.now(); let k = 0;
for (let i = +from; i <= +to; i++){
  await page.evaluate(i => window.renderFrame(i), i);
  if (want && !want.has(i)) continue;
  await page.screenshot({ path: `${dir}/f${String(want ? i : k).padStart(4,'0')}.png`, timeout: 180000 }); k++;
}
console.log(name, k, 'frames', ((Date.now() - t0) / 1000).toFixed(0) + 's', errs.slice(0,3).join(' | '));
if (!want) execSync(`ffmpeg -y -loglevel error -framerate 30 -i ${dir}/f%04d.png -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags +faststart -an clip-${name}.mp4`);
await browser.close(); })();
