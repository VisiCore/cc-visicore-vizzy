// Takes screenshots of the app before and after a change, and writes one page showing them side by side.
//
// Usage: node shoot.js BEFORE_DIST AFTER_DIST OUT_DIR
//   BEFORE_DIST and AFTER_DIST are `vite build` outputs. The app runs in a browser with no real servers:
//   every server call is answered from fixtures.json, as the sample user Alex.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const [beforeDist, afterDist, outDir] = process.argv.slice(2).map((p) => path.resolve(p));
const answers = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures.json')));
const user = { id: 'u1', username: 'alex', email: 'alex@example.com', firstName: 'Alex', lastName: 'Rivera' };

// Each screen to shoot, by name and address. "no-key" is Chat with every server call refused, as before a key is added.
const screens = { chat: '/', memory: '/memory', settings: '/settings', 'no-key': '/' };

// Two shots count as different when more than 100 pixels differ by more than a small colour step,
// so the faint edge shading that varies between runs is not reported as a change.
const COLOUR_STEP = 48;
const CHANGED_PIXELS = 100;

/** Opens the built app at one address and returns its screenshot, as base64 PNG text. */
async function shoot(browser, dist, screen, theme) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: theme });
  // What Cribl provides to the app inside its frame.
  await page.addInitScript((u) => {
    window.CRIBL_API_URL = 'http://app.local/cribl';
    window.getCriblUser = async () => u;
  }, user);
  await page.route('**/*', (request) => {
    const url = new URL(request.request().url());
    const isAppFile = url.hostname === 'app.local' && !url.pathname.startsWith('/cribl/');
    if (isAppFile) {
      // The app's own files; any other address gets index.html, as a single-page app expects.
      const file = path.join(dist, url.pathname);
      const exists = fs.statSync(file, { throwIfNoEntry: false })?.isFile();
      return request.fulfill({ path: exists ? file : path.join(dist, 'index.html') });
    }
    const isServer = url.hostname !== 'app.local';
    if (screen === 'no-key' && isServer) return request.fulfill({ status: 401, json: { detail: 'No key' } });
    const answer = answers[url.pathname];
    return request.fulfill(answer === undefined ? { status: 404, json: {} } : { json: answer });
  });
  await page.goto('http://app.local' + screens[screen], { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500); // lets the last render settle
  const png = await page.screenshot({ animations: 'disabled' });
  await page.close();
  return png.toString('base64');
}

/** Whether two screenshots differ by more than the tolerance above. Compared in the browser, which can read PNGs. */
async function differs(browser, before, after) {
  const page = await browser.newPage();
  const changedPixels = await page.evaluate(async ({ pngs, step }) => {
    const pixelsOf = async (png) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = new OffscreenCanvas(image.width, image.height).getContext('2d');
      canvas.drawImage(image, 0, 0);
      return canvas.getImageData(0, 0, image.width, image.height).data; // red, green, blue, alpha per pixel
    };
    const [a, b] = await Promise.all(pngs.map(pixelsOf));
    let count = 0;
    for (let i = 0; i < a.length; i += 4) {
      const difference = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (difference > step) count++;
    }
    return count;
  }, { pngs: [before, after], step: COLOUR_STEP });
  await page.close();
  return changedPixels > CHANGED_PIXELS;
}

const browser = await chromium.launch();
const rows = [];
for (const screen of Object.keys(screens)) {
  for (const theme of ['light', 'dark']) {
    const before = await shoot(browser, beforeDist, screen, theme);
    const after = await shoot(browser, afterDist, screen, theme);
    rows.push({ title: `${screen} (${theme})`, before, after, changed: await differs(browser, before, after) });
  }
}
await browser.close();

// The page: a count, then each screen's before and after side by side, changed screens first.
const summary = `${rows.filter((row) => row.changed).length} of ${rows.length} screens changed`;
const image = (label, png) => `<figure><figcaption>${label}</figcaption><img src="data:image/png;base64,${png}"></figure>`;
const sections = rows
  .sort((a, b) => b.changed - a.changed)
  .map((row) => `<h2>${row.title}${row.changed ? ': changed' : ''}</h2><div>${image('Before', row.before)}${image('After', row.after)}</div>`);
const style = 'body{font:16px sans-serif;margin:1rem}div{display:grid;grid-template-columns:1fr 1fr;gap:1rem}img{max-width:100%}figure{margin:0}@media(max-width:600px){div{grid-template-columns:1fr}}';
const head = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><meta name="viewport" content="width=device-width"><title>App screenshots</title><style>${style}</style>`;
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'app-screenshots.html'), `${head}<p>${summary}</p>${sections.join('')}`);
console.log(summary);
