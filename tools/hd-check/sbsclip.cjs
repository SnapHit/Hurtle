// Puts two frame folders side by side, frame for frame, with a label over each,
// so a clip from the approved renderer and the same clip from the new one can
// be watched together. Writes the composed PNGs to <outDir> and, when ffmpeg is
// on the path, a WebM next to it. The Playwright ffmpeg build has only VP8, no
// PNG decoder and no stacking filter, so the stacking is done in a canvas here
// and the frames are piped to ffmpeg as JPEG.
//   node sbsclip.cjs <leftDir> <rightDir> <outDir> <leftLabel> <rightLabel> [eachWidth]
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const { spawn } = require('child_process');
const [L, R, out, la, lb, ew] = process.argv.slice(2);
(async () => {
  const names = fs.readdirSync(L).filter(f => f.endsWith('.png')).sort();
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
  const clip = out.replace(/\/+$/, '') + '.webm';
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', '30', '-i', 'pipe:0',
    '-c:v', 'libvpx', '-b:v', '8M', '-crf', '6', '-deadline', 'good', '-cpu-used', '3', '-pix_fmt', 'yuv420p', '-an', clip],
    { stdio: ['pipe', 'ignore', 'pipe'] });
  let ffErr = ''; ff.stderr.on('data', d => ffErr += d); ff.on('error', e => ffErr += e.message);
  const feed = buf => new Promise(res => { if (!ff.stdin.writable) return res(); if (!ff.stdin.write(buf)) ff.stdin.once('drain', res); else res(); });
  const br = await chromium.launch(); const p = await (await br.newContext()).newPage();
  const d = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  let k = 0;
  for (const n of names) {
    const rn = path.join(R, n); if (!fs.existsSync(rn)) continue;
    const [png, jpg] = await p.evaluate(async ([la, a, lb, b, ew, i]) => {
      const load = src => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.src = src; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = ew || ia.width, h = Math.round(ia.height * w / ia.width), pad = 8, lab = 26;
      const c = document.createElement('canvas'); c.width = w * 2 + pad * 3; c.height = h + lab + pad * 2;
      const g = c.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(ia, pad, lab + pad, w, h); g.drawImage(ib, w + pad * 2, lab + pad, w, h);
      g.fillStyle = '#eee'; g.font = '600 15px system-ui, sans-serif';
      g.fillText(la, pad, lab - 6); g.fillText(lb, w + pad * 2, lab - 6);
      g.textAlign = 'right'; g.fillText(String(i), c.width - pad, lab - 6);
      return [c.toDataURL('image/png'), c.toDataURL('image/jpeg', 0.95)];
    }, [la, d(path.join(L, n)), lb, d(rn), +(ew || 0), k]);
    fs.writeFileSync(path.join(out, `f${String(k).padStart(4, '0')}.png`), Buffer.from(png.split(',')[1], 'base64'));
    await feed(Buffer.from(jpg.split(',')[1], 'base64')); k++;
  }
  await br.close();
  const code = await new Promise(res => { ff.on('close', res); ff.stdin.end(); });
  console.log('wrote', k, 'frames to', out, code === 0 ? clip : 'no clip: ' + ffErr.trim().split('\n')[0]);
})();
