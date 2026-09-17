#!/usr/bin/env node
/**
 * render.js — renderiza index.html quadro a quadro (Playwright/Chromium) e
 * codifica em MP4 H.264 (ffmpeg). Sem dependência de app externo.
 *
 * Uso:
 *   node render.js                         # 1080x1920 (9:16), 30 fps, out/hubgenial-9x16.mp4
 *   node render.js --format 1x1            # 1080x1080 (feed)
 *   node render.js --format 16x9           # 1920x1080 (YouTube)
 *   node render.js --fps 60 --crf 16       # qualidade
 *   node render.js --stills                # só exporta PNGs de cenas-chave (revisão rápida)
 *
 * ffmpeg: usa $FFMPEG, senão `ffmpeg` no PATH, senão o binário do pacote
 * python imageio-ffmpeg (pip install imageio-ffmpeg).
 */
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const flag = name => args.includes('--' + name);

const FORMATS = { '9x16': [1080, 1920], '1x1': [1080, 1080], '4x5': [1080, 1350], '16x9': [1920, 1080] };
const format = opt('format', '9x16');
if (!FORMATS[format]) { console.error('formato inválido. use: ' + Object.keys(FORMATS).join(', ')); process.exit(1); }
const [W, H] = FORMATS[format];
const FPS = +opt('fps', 30);
const CRF = +opt('crf', 18);
const OUT_DIR = path.resolve(opt('out', path.join(__dirname, 'out')));
const OUT = path.join(OUT_DIR, `hubgenial-${format}.mp4`);
fs.mkdirSync(OUT_DIR, { recursive: true });

function loadPlaywright() {
  try { return require('playwright'); } catch (_) {}
  for (const p of ['/opt/node22/lib/node_modules/playwright', '/usr/lib/node_modules/playwright', '/usr/local/lib/node_modules/playwright']) {
    try { return require(p); } catch (_) {}
  }
  throw new Error('playwright não encontrado. npm i -g playwright');
}

function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try { return execSync('which ffmpeg', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null; } catch (_) {}
  try { return execSync('python3 -c "import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())"', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (_) {}
  throw new Error('ffmpeg não encontrado. brew install ffmpeg  (ou pip install imageio-ffmpeg)');
}

(async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const url = 'file://' + path.join(__dirname, 'index.html') + `?w=${W}&h=${H}`;
  await page.goto(url);
  await page.evaluate(() => window.ready);
  const DURATION = await page.evaluate(() => window.DURATION);

  if (flag('stills')) {
    const times = (opt('times', '1.5,5,8.5,11,15,20,24,29')).split(',').map(Number);
    for (const t of times) {
      await page.evaluate(t => window.seek(t), t);
      const f = path.join(OUT_DIR, `still-${format}-${String(t).replace('.', '_')}s.png`);
      await page.screenshot({ path: f });
      console.log('still', f);
    }
    await browser.close();
    return;
  }

  const ffmpeg = findFfmpeg();
  const total = Math.round(DURATION * FPS);
  console.log(`render ${W}x${H} @${FPS}fps, ${DURATION}s = ${total} quadros → ${OUT}`);
  console.log('ffmpeg:', ffmpeg);

  const ff = spawn(ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    // trilha silenciosa: alguns players/plataformas preferem stream de áudio presente
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-shortest',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(CRF), '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1',
    '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart',
    OUT,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg saiu com código ' + c))));

  const write = buf => new Promise(res => { if (ff.stdin.write(buf)) res(); else ff.stdin.once('drain', res); });
  const t0 = Date.now();
  for (let i = 0; i < total; i++) {
    await page.evaluate(t => window.seek(t), i / FPS);
    const png = await page.screenshot({ type: 'png' });
    await write(png);
    if (i % FPS === 0) process.stdout.write(`\r  ${Math.round(i / FPS)}s / ${DURATION}s  (${((Date.now() - t0) / 1000).toFixed(0)}s decorridos)`);
  }
  ff.stdin.end();
  await done;
  await browser.close();
  const mb = (fs.statSync(OUT).size / 1e6).toFixed(1);
  console.log(`\n✅ ${OUT}  (${mb} MB, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
})().catch(e => { console.error(e); process.exit(1); });
