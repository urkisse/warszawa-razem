// Packs the finished static site (dist/) into ONE self-contained HTML page: artifact/index.html
// for the Claude artifact viewer (no external tiles, hash routes, images embedded).
//   node tools/build-artifact.mjs      (needs artifact/basemap.json, see make-basemap.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
execSync('node build.mjs', { cwd: ROOT, stdio: 'inherit' });

const routeOf = (u) => {
  let m;
  if (u === '/') return 'pl';
  if (u === '/en/') return 'en';
  if (u === '/o-projekcie/') return 'pl-about';
  if (u === '/en/about/') return 'en-about';
  if ((m = /^\/miejsca\/([^/]+)\/$/.exec(u))) return `pl-place-${m[1]}`;
  if ((m = /^\/en\/places\/([^/]+)\/$/.exec(u))) return `en-place-${m[1]}`;
  return null;
};

const ROUTES = {};
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f === 'index.html') {
      const rel = '/' + path.relative(DIST, path.dirname(p)).replace(/\\/g, '/');
      const url = rel === '/' ? '/' : rel + '/';
      const key = routeOf(url);
      if (!key) continue;
      const h = fs.readFileSync(p, 'utf8');
      const start = h.indexOf('<a class="skip"');
      const end = h.indexOf('<script src="/assets/vendor/leaflet/leaflet.js">');
      ROUTES[key] = h.slice(start, end).trim();
    }
  }
})(DIST);

const IMG = {};
const imgDir = path.join(DIST, 'img/places');
(function walkImg(dir, rel) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walkImg(p, `${rel}/${f}`);
    else if (f.endsWith('.svg') || f.endsWith('.jpg'))
      IMG[`${rel}/${f}`] = `data:image/${f.endsWith('.svg') ? 'svg+xml' : 'jpeg'};base64,` + fs.readFileSync(p).toString('base64');
  }
})(imgDir, '/img/places');

const BASE = fs.readFileSync(path.join(ROOT, 'artifact/basemap.json'), 'utf8');
const leafletCss = fs.readFileSync(path.join(ROOT, 'node_modules/leaflet/dist/leaflet.css'), 'utf8').replace(/url\([^)]*\)/g, 'none');
const siteCss = fs.readFileSync(path.join(ROOT, 'src/style.css'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'tools/artifact-app.js'), 'utf8');
const safe = (s) => s.replace(/</g, '\\u003c');

const extraCss = `
/* artifact viewer adjustments */
body { background: var(--bg); color: var(--ink); }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 1100; background: var(--bg); }
.site-header { top: env(safe-area-inset-top, 0px); }
.container { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.site-footer .container { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.leaflet-container, #map, .mini-map { background: #eef0ec; }
.map-label { pointer-events: none; }
.map-label span { position: absolute; transform: translate(-50%, -50%); white-space: nowrap; font: 700 11px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.1em; text-transform: uppercase; color: #8a8f84; text-shadow: 0 0 4px #eef0ec, 0 0 4px #eef0ec, 0 0 4px #eef0ec; }
.z-hi .map-label { display: none; }
.leaflet-control-attribution { font-size: 10px; }
`;

const out = `<title>Warszawa Razem</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${leafletCss}
${siteCss}
${extraCss}
</style>
<div id="root"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>
const ROUTES = ${safe(JSON.stringify(ROUTES))};
const IMG = ${safe(JSON.stringify(IMG))};
const BASE = ${safe(BASE)};
${app}
</script>
`;
fs.writeFileSync(path.join(ROOT, 'artifact/index.html'), out);
console.log(`artifact/index.html: ${(out.length / 1024).toFixed(0)} KB, routes=${Object.keys(ROUTES).length}, images=${Object.keys(IMG).length}`);
