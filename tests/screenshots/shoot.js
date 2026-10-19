// Shoots the app built in BEFORE and AFTER (each a `vite build` dist) with canned answers, and writes one before/after page.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const [before, after, out] = process.argv.slice(2).map((p) => path.resolve(p));
const answers = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures.json')));
const screens = { chat: '/', memory: '/memory', settings: '/settings', 'no-key': '/' };
const user = { id: 'u1', username: 'alex', email: 'alex@example.com', firstName: 'Alex', lastName: 'Rivera' };

try {
  const browser = await chromium.launch(), rows = [];
  for (const [name, route] of Object.entries(screens)) for (const theme of ['light', 'dark']) {
    const shots = [];
    for (const dist of [before, after]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: theme });
      await page.addInitScript((u) => { window.CRIBL_API_URL = 'http://app.local/cribl'; window.getCriblUser = async () => u; }, user);
      await page.route('**/*', (r) => {
        const url = new URL(r.request().url()), p = url.pathname, file = path.join(dist, p);
        if (url.hostname === 'app.local' && !p.startsWith('/cribl/')) return r.fulfill({ path: fs.statSync(file, { throwIfNoEntry: false })?.isFile() ? file : path.join(dist, 'index.html') });
        if (name === 'no-key' && url.hostname !== 'app.local') return r.fulfill({ status: 401, json: { detail: 'No key' } });
        return r.fulfill(p in answers ? { json: answers[p] } : { status: 404, json: {} });
      });
      await page.goto('http://app.local' + route, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      shots.push((await page.screenshot({ animations: 'disabled' })).toString('base64'));
      await page.close();
    }
    rows.push({ title: `${name} (${theme})`, shots, changed: shots[0] !== shots[1] });
  }
  await browser.close();
  const summary = `${rows.filter((r) => r.changed).length} of ${rows.length} screens changed`;
  const figure = (label, png) => `<figure><figcaption>${label}</figcaption><img src="data:image/png;base64,${png}"></figure>`;
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'app-screenshots.html'), `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><meta name="viewport" content="width=device-width"><title>Vizzy app screenshots</title><style>body{font:16px sans-serif;margin:1rem}div{display:grid;grid-template-columns:1fr 1fr;gap:1rem}img{max-width:100%}figure{margin:0}@media(max-width:600px){div{grid-template-columns:1fr}}</style><p>${summary}</p>` +
    rows.sort((a, b) => b.changed - a.changed).map((r) => `<h2>${r.title}${r.changed ? ': changed' : ''}</h2><div>${figure('Before', r.shots[0])}${figure('After', r.shots[1])}</div>`).join(''));
  console.log(summary);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
