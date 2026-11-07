// Static site generator for "Warszawa Razem" / "Warsaw Together".
// No frameworks, no site builders: content/*.json + src/* -> dist/ (plain HTML, CSS, JS).
//
//   node build.mjs            build into ./dist
//   node build.mjs --serve    build, serve on http://localhost:4173 and rebuild on changes
//   SITE_URL=https://example.pl node build.mjs   set the public address (canonical, sitemap)

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const SITE_URL = (process.env.SITE_URL || 'https://warszawa-razem.example.pl').replace(/\/+$/, '');
// BASE_PATH is only needed when the site is not served from the root of its domain, e.g. GitHub Pages
// project sites (https://user.github.io/repo/ -> BASE_PATH=/repo). SITE_URL must then include it too.
const BASE = process.env.BASE_PATH ? '/' + process.env.BASE_PATH.replace(/^\/+|\/+$/g, '') : '';
const LANGS = ['pl', 'en'];
const LOCALE = { pl: 'pl_PL', en: 'en_GB' };

// ---------------------------------------------------------------- URL scheme
// PL is the primary language and lives at the root; EN lives under /en/.
const ROUTES = {
  pl: { home: '/', about: '/o-projekcie/', place: (s) => `/miejsca/${s}/` },
  en: { home: '/en/', about: '/en/about/', place: (s) => `/en/places/${s}/` },
};
const otherLang = (l) => (l === 'pl' ? 'en' : 'pl');

// ------------------------------------------------------------------- helpers
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const jsonInHtml = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));
const abs = (p) => SITE_URL + p;
// Prefix root-absolute paths (/assets/.., /img/.., page links, and the "url"/"img" values in #app-data) with BASE.
const withBase = (html) =>
  BASE
    ? html
        .replace(/(\s(?:href|src|poster|data-base|data-full)=")\/(?!\/)/g, `$1${BASE}/`)
        .replace(/("(?:url|img)":")\/(?!\/)/g, `$1${BASE}/`)
    : html;
const svgIcon = (inner, size = 16, cls = '') =>
  `<svg class="${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
const ICONS = {
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15"/><path d="M15 6v15"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  train: '<rect x="4" y="3" width="16" height="16" rx="2"/><path d="M4 11h16M12 3v8M8 19l-2 3M16 19l2 3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6M10 22h4"/>',
};

// -------------------------------------------------------- generated artwork
// Until real photos are supplied (content/photos/<slug>/*.jpg), each place gets
// three generated illustrations so the layout can be judged with realistic content.
function hash(str) {
  let h = 2166136261;
  for (const c of str) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed) {
  let a = hash(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const PALETTE = {
  integration: ['#ffe3da', '#e5484d', '#7d1a2a'],
  culture: ['#e9e0ff', '#7c4ddb', '#34197a'],
  sport: ['#d9f6e8', '#12926a', '#07402f'],
  music: ['#dbe8ff', '#2f6fe4', '#102f73'],
  friends: ['#fff0c9', '#f5a524', '#6b3b00'],
};
function motif(cat, r) {
  const o = [];
  if (cat === 'sport') {
    for (let i = 0; i < 4; i++) {
      const k = 1 - i * 0.2;
      o.push(`<rect x="${600 - 470 * k}" y="${400 - 250 * k}" width="${940 * k}" height="${500 * k}" rx="${250 * k}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="12"/>`);
    }
    o.push('<line x1="600" y1="150" x2="600" y2="650" stroke="#fff" stroke-opacity=".55" stroke-width="10"/>');
  } else if (cat === 'music') {
    for (let i = 0; i < 38; i++) {
      const h = 80 + Math.abs(Math.sin(i * 0.5 + r() * 2)) * 380;
      o.push(`<rect x="${40 + i * 30}" y="${375 - h / 2}" width="16" height="${h}" rx="8" fill="#fff" fill-opacity="${0.35 + r() * 0.4}"/>`);
    }
  } else if (cat === 'culture') {
    for (let i = 0; i < 6; i++) o.push(`<rect x="${210 + i * 148}" y="300" width="64" height="300" rx="10" fill="#fff" fill-opacity=".55"/>`);
    o.push('<polygon points="150,290 600,110 1050,290" fill="#fff" fill-opacity=".6"/><rect x="150" y="610" width="900" height="34" rx="8" fill="#fff" fill-opacity=".6"/>');
  } else if (cat === 'integration') {
    const cols = ['#fff', '#fff', '#fff', '#fff', '#fff'];
    for (let i = 0; i < 5; i++) o.push(`<circle cx="${280 + i * 160}" cy="${375 + (i % 2 ? 50 : -50)}" r="190" fill="${cols[i]}" fill-opacity="${0.18 + i * 0.03}" stroke="#fff" stroke-opacity=".6" stroke-width="6"/>`);
  } else {
    for (let i = 0; i < 28; i++) o.push(`<circle cx="${r() * 1200}" cy="${r() * 750}" r="${24 + r() * 80}" fill="#fff" fill-opacity="${0.12 + r() * 0.3}"/>`);
    o.push('<path d="M0 140 Q 300 260 600 140 T 1200 140" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="5"/>');
    for (let i = 0; i < 10; i++) o.push(`<circle cx="${60 + i * 120}" cy="${i % 2 ? 190 : 168}" r="12" fill="#fff"/>`);
  }
  return o.join('');
}
function skyline(r, fill, opacity, minH, maxH, windows) {
  const o = [];
  let x = -30;
  while (x < 1230) {
    const w = 50 + r() * 70;
    const h = minH + r() * (maxH - minH);
    o.push(`<rect x="${x.toFixed(0)}" y="${(750 - h).toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="${fill}" fill-opacity="${opacity}"/>`);
    if (windows) {
      for (let wy = 750 - h + 18; wy < 730; wy += 26) for (let wx = x + 10; wx < x + w - 12; wx += 20) if (r() > 0.55) o.push(`<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="8" height="12" fill="#ffe9a8" fill-opacity=".85"/>`);
    }
    x += w + r() * 8;
  }
  return o.join('');
}
function palaceOfCulture(x, fill, opacity) {
  return `<g fill="${fill}" fill-opacity="${opacity}"><rect x="${x - 120}" y="500" width="240" height="250"/><rect x="${x - 80}" y="410" width="160" height="100"/><rect x="${x - 50}" y="340" width="100" height="80"/><rect x="${x - 28}" y="280" width="56" height="70"/><polygon points="${x - 14},280 ${x + 14},280 ${x},170"/></g>`;
}
function art(slug, cat, variant) {
  const r = rng(slug + ':' + variant);
  const [light, mid, dark] = PALETTE[cat];
  const dusk = variant === 1;
  const top = dusk ? '#17143a' : light;
  const bottom = dusk ? mid : mid;
  let inner = '';
  if (variant === 2) {
    inner = `<rect width="1200" height="750" fill="url(#g)"/>${motif(cat, r)}`;
  } else {
    inner += `<rect width="1200" height="750" fill="url(#g)"/>`;
    inner += `<circle cx="${180 + r() * 840}" cy="${130 + r() * 90}" r="${dusk ? 56 : 76}" fill="${dusk ? '#fff6d8' : '#fff'}" fill-opacity="${dusk ? 0.95 : 0.8}"/>`;
    if (dusk) for (let i = 0; i < 40; i++) inner += `<circle cx="${r() * 1200}" cy="${r() * 380}" r="${1 + r() * 2}" fill="#fff" fill-opacity="${0.4 + r() * 0.5}"/>`;
    inner += skyline(r, dark, dusk ? 0.35 : 0.22, 150, 330, false);
    inner += palaceOfCulture(120 + r() * 960, dark, dusk ? 0.55 : 0.4);
    inner += skyline(r, dark, dusk ? 0.95 : 0.85, 60, 210, dusk);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 750" width="1200" height="750" role="img"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>${inner}</svg>`;
}

// ----------------------------------------------------------------- content
async function loadContent() {
  const cats = await readJson(path.join(ROOT, 'content/categories.json'));
  const ui = await readJson(path.join(ROOT, 'content/ui.json'));
  const dir = path.join(ROOT, 'content/places');
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const catIds = new Set(cats.map((c) => c.id));
  const seen = new Set();
  const places = [];
  const hidden = [];
  // Only a broken slug / unknown category / missing Polish name stops the build. Everything else in a
  // place is optional (editors may leave fields empty): the site simply leaves that part out, and a
  // note is printed so gaps are visible in the build log (GitHub Actions shows ::warning lines).
  const warn = (f, m) => console.warn(process.env.GITHUB_ACTIONS ? `::warning file=content/places/${f}::${m}` : `warning: content/places/${f}: ${m}`);
  const TEXT_KEYS = ['name', 'summary', 'article', 'doHere', 'getThere', 'bestTime', 'tips'];
  const isEmpty = (v) => v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.some((x) => String(x ?? '').trim()));
  for (const f of files) {
    const p = await readJson(path.join(dir, f));
    const fail = (m) => {
      throw new Error(`content/places/${f}: ${m}`);
    };
    if (!p.slug || !/^[a-z0-9-]+$/.test(p.slug)) fail('slug must be lowercase letters, digits and dashes');
    if (seen.has(p.slug)) fail(`duplicate slug "${p.slug}"`);
    seen.add(p.slug);
    // Status: "draft" or "published" (a missing status counts as published). "archived: true" removes the
    // place from the public site too. Both stay in the repository and in the editing panel.
    if (p.status === 'draft' || p.archived === true) {
      hidden.push(`${p.slug} (${p.archived === true ? 'archived' : 'draft'})`);
      continue;
    }
    p.categories = (Array.isArray(p.categories) ? p.categories : []).filter(Boolean);
    for (const c of p.categories) if (!catIds.has(c)) fail(`unknown category "${c}"`);
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    p.lat = num(p.lat);
    p.lng = num(p.lng);
    if (p.lat === null || p.lng === null) p.lat = p.lng = null;
    p.address = String(p.address || '').trim();
    p.website = String(p.website || '').trim();
    // videos: optional; an entry without a file is ignored
    p.videos = (Array.isArray(p.videos) ? p.videos : [])
      .map((v) => ({ video: String(v?.video || '').trim(), poster: String(v?.poster || '').trim(), caption: String(v?.caption || '').trim(), captionEn: String(v?.captionEn || '').trim(), credit: String(v?.credit || '').trim() }))
      .filter((v) => v.video);
    const base = p[LANGS[0]] || {};
    if (isEmpty(base.name)) fail(`${LANGS[0]}.name (the place name) is required`);
    for (const l of LANGS) {
      const own = p[l] || {};
      const other = p[otherLang(l)] || {};
      const t = {};
      const fell = [];
      for (const k of TEXT_KEYS) {
        // an empty text falls back to the other language, so a page is never blank
        const v = !isEmpty(own[k]) ? own[k] : !isEmpty(other[k]) ? other[k] : k.match(/^(article|doHere|tips)$/) ? [] : '';
        if (isEmpty(own[k]) && !isEmpty(v)) fell.push(k);
        t[k] = Array.isArray(v) ? v.filter((x) => String(x ?? '').trim()) : String(v).trim();
      }
      if (fell.length) warn(f, `${p.slug}: ${l} text missing for ${fell.join(', ')}, showing the ${otherLang(l)} text`);
      p[l] = t;
    }
    if (p.lat === null) warn(f, `${p.slug}: no coordinates, so it is listed but not shown on the map`);
    if (!p.categories.length) warn(f, `${p.slug}: no category, so it is listed but not shown on the map or in category filters`);
    places.push(p);
  }
  if (hidden.length) console.log(`Not published (${hidden.length}): ${hidden.join(', ')}`);
  return { cats, ui, places };
}

// Photos come from each place's "photos" list: [{ image, author, license, licenseUrl, source }].
// "image" is a path inside the repository (the admin panel stores uploads in content/photos/).
// A place without photos gets generated placeholder illustrations.
async function preparePhotos(places) {
  const outDir = path.join(DIST, 'img/places');
  const photoRoot = path.join(ROOT, 'content/photos');
  await fs.mkdir(outDir, { recursive: true });
  for (const p of places) {
    const listed = (Array.isArray(p.photos) ? p.photos : []).filter((x) => x && x.image);
    p.photos = [];
    p.realPhotos = listed.length > 0;
    p.credits = [];
    if (listed.length) {
      await fs.mkdir(path.join(outDir, p.slug), { recursive: true });
      for (const ph of listed) {
        const src = path.resolve(ROOT, String(ph.image).replace(/^\/+/, ''));
        if (!src.startsWith(photoRoot + path.sep)) throw new Error(`content/places/${p.slug}.json: photo "${ph.image}" must be inside content/photos/`);
        if (!fsSync.existsSync(src)) throw new Error(`content/places/${p.slug}.json: photo "${ph.image}" does not exist`);
        const name = path.basename(src).replace(/[^A-Za-z0-9._-]+/g, '-');
        await fs.copyFile(src, path.join(outDir, p.slug, name));
        p.photos.push(`/img/places/${p.slug}/${name}`);
        p.credits.push(ph.author || ph.license || ph.source ? ph : null);
      }
    } else {
      for (let v = 0; v < 3; v++) {
        const file = `${p.slug}-${v + 1}.svg`;
        await fs.writeFile(path.join(outDir, file), art(p.slug, p.categories[0] || 'integration', v));
        p.photos.push(`/img/places/${file}`);
      }
    }
  }
}

const VIDEO_TYPES = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg' };
// Videos are copied unchanged (no re-encoding) to dist/media/places/<slug>/. Keep them small: the files live in the
// Git repository, and some hosts limit a single file to 25 MB.
async function prepareVideos(places) {
  const videoRoot = path.join(ROOT, 'content/videos');
  const photoRoot = path.join(ROOT, 'content/photos');
  for (const p of places) {
    const list = [];
    for (const v of p.videos) {
      const where = `content/places/${p.slug}.json: video "${v.video}"`;
      const src = path.resolve(ROOT, v.video.replace(/^\/+/, ''));
      if (!src.startsWith(videoRoot + path.sep)) throw new Error(`${where} must be inside content/videos/`);
      const type = VIDEO_TYPES[path.extname(src).toLowerCase()];
      if (!type) throw new Error(`${where} must be an .mp4, .webm or .ogv file`);
      if (!fsSync.existsSync(src)) throw new Error(`${where} does not exist`);
      const mb = fsSync.statSync(src).size / 1048576;
      if (mb > 25) console.warn(process.env.GITHUB_ACTIONS ? `::warning file=${v.video}::video is ${mb.toFixed(0)} MB; compress it (aim for under 10 MB)` : `warning: ${v.video} is ${mb.toFixed(0)} MB; compress it (aim for under 10 MB)`);
      const dir = path.join(DIST, 'media/places', p.slug);
      await fs.mkdir(dir, { recursive: true });
      const name = path.basename(src).replace(/[^A-Za-z0-9._-]+/g, '-');
      await fs.copyFile(src, path.join(dir, name));
      let poster = p.photos[0];
      if (v.poster) {
        const ps = path.resolve(ROOT, v.poster.replace(/^\/+/, ''));
        if (!ps.startsWith(photoRoot + path.sep) || !fsSync.existsSync(ps)) throw new Error(`${where}: poster "${v.poster}" must be an existing file inside content/photos/`);
        const pn = path.basename(ps).replace(/[^A-Za-z0-9._-]+/g, '-');
        await fs.mkdir(path.join(DIST, 'img/places', p.slug), { recursive: true });
        await fs.copyFile(ps, path.join(DIST, 'img/places', p.slug, pn));
        poster = `/img/places/${p.slug}/${pn}`;
      }
      list.push({ src: `/media/places/${p.slug}/${name}`, type, poster, caption: v.caption, captionEn: v.captionEn, credit: v.credit });
    }
    p.videos = list;
  }
}

// ---------------------------------------------------------------- templates
let ASSET_V = '';
const out = []; // { urlPath, html }
const sitemap = []; // { pl: path, en: path }

// the "x" between two partner logos (collaboration lock-up)
const XMARK = '<svg class="x-mark" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M5 5l14 14M19 5 5 19" stroke="#00e195" stroke-width="5.5" stroke-linecap="round" fill="none"/></svg>';

function layout({ lang, title, description, paths, body, jsonld = [], keepQuery = false, active = '', ui }) {
  const t = ui[lang];
  const self = paths[lang];
  const alt = LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${abs(paths[l])}">`).join('\n  ');
  const ld = jsonld.map((o) => `<script type="application/ld+json">${jsonInHtml(o)}</script>`).join('\n  ');
  const langLinks = LANGS.map((l) => {
    const current = l === lang;
    return `<a href="${paths[l]}" lang="${l}" hreflang="${l}"${current ? ' aria-current="true"' : ''}${keepQuery ? ` data-lang-link data-base="${paths[l]}"` : ''}>${l.toUpperCase()}</a>`;
  }).join('');
  return `<!doctype html>
<html lang="${lang}" data-view="map">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${abs(self)}">
  ${alt}
  <link rel="alternate" hreflang="x-default" href="${abs(paths.pl)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(t.siteName)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${abs(self)}">
  <meta property="og:locale" content="${LOCALE[lang]}">
  <meta property="og:locale:alternate" content="${LOCALE[otherLang(lang)]}">
  <meta name="theme-color" content="#faf8fd">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/vendor/leaflet/leaflet.css">
  <link rel="stylesheet" href="/assets/style.css?v=${ASSET_V}">
  <script>(function(){var d=document.documentElement;d.classList.add('js');try{var v=new URLSearchParams(location.search).get('view');d.dataset.view=v==='list'?'list':'map'}catch(e){}})()</script>
  ${ld}
</head>
<body>
  <a class="skip" href="#main">${esc(t.skip)}</a>
  <header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="${ROUTES[lang].home}" aria-label="${esc(t.siteName)} – ${esc(t.footer.cityAlt)} × ${esc(t.footer.orgAlt)}">
        <img class="brand-city" src="/assets/img/warszawa-logo.png" width="760" height="466" alt="" decoding="async">
        ${XMARK}
        <img class="brand-wyspa" src="/assets/img/wyspa-logo.svg" width="1215" height="341" alt="" decoding="async">
      </a>
      <nav class="nav" aria-label="${esc(t.siteName)}">
        <a href="${ROUTES[lang].home}"${active === 'home' ? ' aria-current="page"' : ''}>${esc(t.navMap)}</a>
        <a href="${ROUTES[lang].about}"${active === 'about' ? ' aria-current="page"' : ''}>${esc(t.navAbout)}</a>
      </nav>
      <div class="lang" role="group" aria-label="${esc(t.langLabel)}">${langLinks}</div>
    </div>
  </header>
  ${body}
  <footer class="site-footer">
    <img class="foot-orn" src="/assets/img/orn-leaves.svg" width="209" height="213" alt="" aria-hidden="true" loading="lazy" decoding="async">
    <div class="container footer-inner">
      <div class="foot-main">
        <p class="logo-card">
          <img class="foot-city" src="/assets/img/warszawa-logo.png" width="760" height="466" alt="${esc(t.footer.cityAlt)}" loading="lazy" decoding="async">
          ${XMARK}
          <img class="foot-wyspa" src="/assets/img/wyspa-logo.svg" width="1215" height="341" alt="${esc(t.footer.orgAlt)}" loading="lazy" decoding="async">
        </p>
        <div class="foot-text">
          <strong>${esc(t.siteName)}</strong>
          <p>${esc(t.footer.blurb)}</p>
          <nav class="footer-nav" aria-label="${esc(t.siteName)}"><a href="${ROUTES[lang].home}">${esc(t.navMap)}</a><a href="${ROUTES[lang].about}">${esc(t.navAbout)}</a></nav>
        </div>
      </div>
      <div class="footer-meta">
        <span class="badge">${esc(t.demoBadge)}</span>
        <p>${esc(t.footer.demo)}</p>
        <p>${esc(t.footer.tiles)}</p>
      </div>
    </div>
  </footer>
  <script src="/assets/vendor/leaflet/leaflet.js"></script>
  <script src="/assets/vendor/protomaps-leaflet/protomaps-leaflet.js" defer></script>
  <script src="/assets/app.js?v=${ASSET_V}" defer></script>
</body>
</html>
`;
}

function appData(lang, ctx, extra = {}) {
  const { cats, ui, places } = ctx;
  const t = ui[lang];
  return `<script type="application/json" id="app-data">${jsonInHtml({
    lang,
    strings: { count: t.home.count, openPlace: t.home.openPlace, close: t.place.close, prev: t.place.prev, next: t.place.next, gallery: t.place.gallery, video: t.place.video },
    cats: cats.map((c) => ({ id: c.id, color: c.color, ink: c.ink, icon: c.icon, name: c[lang].name })),
    places: places.map((p) => ({
      slug: p.slug,
      url: ROUTES[lang].place(p.slug),
      name: p[lang].name,
      address: p.address,
      summary: p[lang].summary,
      cats: p.categories,
      lat: p.lat,
      lng: p.lng,
      img: p.photos[0],
      video: p.videos.length > 0,
    })),
    ...extra,
  })}</script>`;
}

function tagList(p, lang, catMap) {
  return p.categories
    .map((id) => `<span class="tag" style="--c:${catMap[id].color}"><i></i>${esc(catMap[id][lang].name)}</span>`)
    .join('');
}

const PLAY = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>';
const VIDEO_LABEL = { pl: 'Wideo', en: 'Video' };

function card(p, lang, catMap) {
  const t = p[lang];
  return `<li class="card" data-slug="${p.slug}" data-cats="${p.categories.join(' ')}">
        <a class="card-link" href="${ROUTES[lang].place(p.slug)}">
          <div class="card-media"><img src="${p.photos[0]}" width="1200" height="750" loading="lazy" decoding="async" alt="">${p.videos.length ? `<span class="play-badge">${PLAY}${VIDEO_LABEL[lang]}</span>` : ''}</div>
          <div class="card-body">
            <div class="tags">${tagList(p, lang, catMap)}</div>
            <h3 class="card-title">${esc(t.name)}</h3>
            ${p.address ? `<p class="card-addr">${svgIcon(ICONS.pin, 14)}<span>${esc(p.address)}</span></p>` : ''}
            ${t.summary ? `<p class="card-sum">${esc(t.summary)}</p>` : ''}
          </div>
        </a>
      </li>`;
}

function homePage(lang, ctx) {
  const { cats, ui, places } = ctx;
  const t = ui[lang];
  const h = t.home;
  const catMap = Object.fromEntries(cats.map((c) => [c.id, c]));
  const chips = cats
    .map(
      (c) =>
        `<button type="button" class="chip" data-cat="${c.id}" aria-pressed="false" style="--c:${c.color};--ink:${c.ink}"><span class="chip-ic">${svgIcon(c.icon, 16)}</span><span>${esc(c[lang].name)}</span></button>`,
    )
    .join('');
  const body = `<main id="main">
    <section class="hero">
      <img class="hero-orn" src="/assets/img/orn-star.svg" width="537" height="395" alt="" aria-hidden="true" decoding="async">
      <div class="container hero-inner">
        <h1>${esc(h.h1)}</h1>
        <p class="lead">${esc(h.lead)}</p>
      </div>
    </section>
    <section class="explorer container" aria-label="${esc(h.mapLabel)}">
      <div class="toolbar">
        <div class="filters" role="group" aria-label="${esc(h.filtersLabel)}">${chips}</div>
        <div class="toolbar-side">
          <span class="count" id="count" aria-live="polite"></span>
          <button type="button" class="link-btn" id="clear" hidden>${svgIcon(ICONS.x, 14)}${esc(h.clear)}</button>
          <div class="seg" role="group" aria-label="${esc(h.viewLabel)}">
            <button type="button" data-view="map" aria-pressed="true">${svgIcon(ICONS.map, 16)}<span>${esc(h.viewMap)}</span></button>
            <button type="button" data-view="list" aria-pressed="false">${svgIcon(ICONS.list, 16)}<span>${esc(h.viewList)}</span></button>
          </div>
        </div>
      </div>
      <p class="empty" id="empty" hidden>${esc(h.empty)}</p>
      <div id="map-view" class="map-view">
        <div id="map" role="region" aria-label="${esc(h.mapLabel)}"></div>
      </div>
      <div id="list-view" class="list-view">
        <h2 class="sr-only">${esc(h.listHeading)}</h2>
        <ul class="cards">
      ${places.map((p) => card(p, lang, catMap)).join('\n      ')}
        </ul>
      </div>
    </section>
  </main>
  ${appData(lang, ctx)}`;
  const paths = { pl: ROUTES.pl.home, en: ROUTES.en.home };
  const jsonld = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: t.siteName,
      url: abs(ROUTES[lang].home),
      inLanguage: lang,
      description: h.description,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: places.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: abs(ROUTES[lang].place(p.slug)),
        name: p[lang].name,
      })),
    },
  ];
  out.push({ urlPath: ROUTES[lang].home, html: layout({ lang, title: h.title, description: h.description, paths, body, jsonld, keepQuery: true, active: 'home', ui }) });
}

function placePage(lang, p, ctx) {
  const { cats, ui, places } = ctx;
  const t = ui[lang];
  const pt = t.place;
  const x = p[lang];
  const catMap = Object.fromEntries(cats.map((c) => [c.id, c]));
  const hasPos = p.lat !== null && p.lng !== null;
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
  const photoAlt = (n) => (p.realPhotos ? pt.photoAltReal : pt.photoAlt).replace('{name}', x.name).replace('{n}', n);
  const shown = p.photos.slice(0, 3);
  const gallery = shown
    .map(
      (src, i) =>
        `<button type="button" class="g-item g-${i}" data-full="${src}" data-alt="${esc(photoAlt(i + 1))}"><img src="${src}" width="800" height="600" alt="${esc(photoAlt(i + 1))}"${i === 0 ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async"></button>`,
    )
    .join('');
  const sourceLabel = (u) => {
    try {
      const h = new URL(u).hostname.replace(/^www\./, '');
      return /(^|\.)wikimedia\.org$/.test(h) ? 'Wikimedia Commons' : h;
    } catch {
      return '';
    }
  };
  const creditLine = (c) =>
    [
      c.author ? esc(c.author) : '',
      c.license ? (c.licenseUrl ? `<a href="${esc(c.licenseUrl)}" target="_blank" rel="noopener license">${esc(c.license)}</a>` : esc(c.license)) : '',
      c.source && sourceLabel(c.source) ? `<a href="${esc(c.source)}" target="_blank" rel="noopener">${esc(sourceLabel(c.source))}</a>` : '',
    ]
      .filter(Boolean)
      .join(', ');
  const creditItems = p.realPhotos
    ? p.credits
        .slice(0, 3)
        .map((c, i) => (c && creditLine(c) ? `<li><span class="credit-n">${i + 1}</span> ${creditLine(c)}</li>` : ''))
        .join('')
    : '';
  const creditsHtml = creditItems ? `<div class="credits"><strong>${esc(pt.credits)}</strong><ul>${creditItems}</ul></div>` : '';
  const videosHtml = p.videos.length
    ? `<section class="videos" aria-labelledby="vid-h">
      <h2 id="vid-h">${esc(pt.videos)}</h2>
      <div class="video-grid n${Math.min(p.videos.length, 2)}">
        ${p.videos
          .map((v, i) => {
            const cap = (lang === 'en' && v.captionEn) || v.caption;
            return `<figure class="video">
          <video controls preload="metadata" playsinline poster="${v.poster}" aria-label="${esc(cap || `${x.name} – ${pt.video} ${i + 1}`)}"><source src="${v.src}" type="${v.type}"><a href="${v.src}">${esc(pt.videoFallback)}</a></video>
          ${cap || v.credit ? `<figcaption>${cap ? `<span>${esc(cap)}</span>` : ''}${v.credit ? `<small>${esc(v.credit)}</small>` : ''}</figcaption>` : ''}
        </figure>`;
          })
          .join('\n        ')}
      </div>
    </section>`
    : '';
  const similar = places
    .filter((o) => o.slug !== p.slug)
    .map((o) => ({ o, score: o.categories.filter((c) => p.categories.includes(c)).length }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.o.slug.localeCompare(b.o.slug))
    .slice(0, 3)
    .map((s) => s.o);
  const pageTitle = `${x.name} – ${pt.titleSuffix}`;
  const body = `<main id="main" class="place">
    <div class="hero hero-place">
      <img class="hero-orn" src="/assets/img/orn-cross.svg" width="270" height="153" alt="" aria-hidden="true" decoding="async">
      <div class="container hero-inner">
        <a class="back" href="${ROUTES[lang].home}">${svgIcon(ICONS.back, 16)}${esc(pt.back)}</a>
        <header class="place-head">
          <div class="tags">${tagList(p, lang, catMap)}</div>
          <h1>${esc(x.name)}</h1>
          ${p.address ? `<p class="place-addr">${svgIcon(ICONS.pin, 18)}<span>${esc(p.address)}</span></p>` : ''}
          ${x.summary ? `<p class="lead">${esc(x.summary)}</p>` : ''}
        </header>
      </div>
    </div>
    <div class="container place-body">
    <section class="gallery n${shown.length}" aria-label="${esc(pt.gallery)}">${gallery}</section>
    ${creditsHtml}
    ${videosHtml}
    <div class="place-grid">
      <article class="article">
        ${x.article.map((para) => `<p>${esc(para)}</p>`).join('\n        ')}
        ${
          x.doHere.length
            ? `<h2>${esc(pt.doHere)}</h2>
        <ul class="checklist">
          ${x.doHere.map((i) => `<li>${svgIcon(ICONS.check, 18)}<span>${esc(i)}</span></li>`).join('\n          ')}
        </ul>`
            : ''
        }
      </article>
      <aside class="info" aria-labelledby="info-h">
        <h2 id="info-h">${esc(pt.info)}</h2>
        <dl>
          ${p.address ? `<div><dt>${svgIcon(ICONS.pin, 16)}${esc(pt.address)}</dt><dd>${esc(p.address)}</dd></div>` : ''}
          ${x.getThere ? `<div><dt>${svgIcon(ICONS.train, 16)}${esc(pt.getThere)}</dt><dd>${esc(x.getThere)}</dd></div>` : ''}
          ${x.bestTime ? `<div><dt>${svgIcon(ICONS.clock, 16)}${esc(pt.bestTime)}</dt><dd>${esc(x.bestTime)}</dd></div>` : ''}
          ${x.tips.length ? `<div><dt>${svgIcon(ICONS.bulb, 16)}${esc(pt.tips)}</dt><dd><ul>${x.tips.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></dd></div>` : ''}
        </dl>
        <div class="info-actions">
          ${hasPos ? `<a class="btn" href="${mapsUrl}" target="_blank" rel="noopener">${svgIcon(ICONS.route, 16)}${esc(pt.route)}</a>` : ''}
          ${p.website ? `<a class="btn btn-ghost" href="${esc(p.website)}" target="_blank" rel="noopener">${svgIcon(ICONS.external, 16)}${esc(pt.website)}</a>` : ''}
        </div>
        ${hasPos && p.categories.length ? `<div class="mini-map" data-mini-map data-lat="${p.lat}" data-lng="${p.lng}" data-cats="${p.categories.join(',')}" role="img" aria-label="${esc(x.name)}${p.address ? ' – ' + esc(p.address) : ''}"></div>` : ''}
      </aside>
    </div>
    ${
      similar.length
        ? `<section class="similar" aria-labelledby="sim-h">
      <h2 id="sim-h">${esc(pt.similar)}</h2>
      <ul class="cards">
        ${similar.map((o) => card(o, lang, catMap)).join('\n        ')}
      </ul>
    </section>`
        : ''
    }
  </div>
  </main>
  ${appData(lang, ctx)}`;
  const paths = { pl: ROUTES.pl.place(p.slug), en: ROUTES.en.place(p.slug) };
  const jsonld = [
    {
      '@context': 'https://schema.org',
      '@type': 'TouristAttraction',
      name: x.name,
      description: x.summary || x.name,
      inLanguage: lang,
      url: abs(paths[lang]),
      image: p.photos.map((s) => abs(s)),
      address: { '@type': 'PostalAddress', ...(p.address ? { streetAddress: p.address } : {}), addressLocality: 'Warszawa', addressCountry: 'PL' },
      ...(hasPos ? { geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng } } : {}),
      ...(p.website ? { sameAs: p.website } : {}),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: t.siteName, item: abs(ROUTES[lang].home) },
        { '@type': 'ListItem', position: 2, name: x.name, item: abs(paths[lang]) },
      ],
    },
  ];
  out.push({ urlPath: paths[lang], html: layout({ lang, title: pageTitle, description: x.summary || x.name, paths, body, jsonld, ui }) });
}

function aboutPage(lang, ctx) {
  const { cats, ui, places } = ctx;
  const t = ui[lang];
  const a = t.about;
  const plural = new Intl.PluralRules(lang);
  const countLabel = (n) => `${n} ${t.home.count[plural.select(n)] || t.home.count.other}`;
  // Cover photos are picked by place + photo number, with fallbacks so the page survives deleted places.
  const photoOf = (slug, n) => places.find((p) => p.slug === slug)?.photos[n - 1];
  const anyPhoto = (i = 0) => (places.length ? places[i % places.length].photos[0] : '');
  const coverOf = (c) => photoOf(c.cover.slug, c.cover.n) || places.find((p) => p.categories.includes(c.id))?.photos[0] || anyPhoto();
  const hero = ['rynek-starego-miasta', 'lazienki-krolewskie', 'koneser'].map((s, i) => photoOf(s, 1) || anyPhoto(i));
  const catCards = cats
    .map((c, i) => {
      const n = places.filter((p) => p.categories.includes(c.id)).length;
      return `<li class="ab-cat ${i >= 3 ? 'ab-cat-wide' : ''}" style="--c:${c.color};--ink:${c.ink}">
        <a href="${ROUTES[lang].home}?cat=${c.id}">
          <img src="${coverOf(c)}" width="800" height="600" alt="" loading="lazy" decoding="async">
          <span class="ab-cat-count">${esc(countLabel(n))}</span>
          <span class="ab-cat-body">
            <span class="ab-cat-ic">${svgIcon(c.icon, 20)}</span>
            <strong>${esc(c[lang].name)}</strong>
            <span class="ab-cat-desc">${esc(c[lang].desc)}</span>
          </span>
          <span class="ab-cat-go" aria-hidden="true">${svgIcon(ICONS.arrow, 18)}</span>
        </a>
      </li>`;
    })
    .join('\n      ');
  const body = `<main id="main" class="about">
    <section class="hero hero-about">
      <img class="hero-orn" src="/assets/img/orn-flower.svg" width="203" height="183" alt="" aria-hidden="true" decoding="async">
      <div class="container ab-hero">
        <div class="ab-hero-text">
          <p class="eyebrow">${esc(a.eyebrow)}</p>
          <h1>${esc(a.h1)}</h1>
          <p class="lead">${esc(a.lead)}</p>
          <a class="btn btn-mint" href="${ROUTES[lang].home}">${svgIcon(ICONS.map, 16)}${esc(a.cta)}</a>
        </div>
        <div class="ab-collage" aria-hidden="true">
          ${hero.map((s, i) => `<img class="ab-c${i}" src="${s}" width="800" height="600" alt="" decoding="async">`).join('\n          ')}
        </div>
      </div>
    </section>
    <section class="container" aria-label="${esc(a.h1)}">
      <dl class="ab-stats">
        <div><dt>${esc(a.stats.places)}</dt><dd>${places.length}</dd></div>
        <div><dt>${esc(a.stats.cats)}</dt><dd>${cats.length}</dd></div>
        <div><dt>${esc(a.stats.langs)}</dt><dd>${LANGS.length}</dd></div>
      </dl>
    </section>
    <section class="container ab-mission">
      <h2>${esc(a.missionTitle)}</h2>
      <div class="prose">${a.p.map((x) => `<p>${esc(x)}</p>`).join('')}</div>
    </section>
    <section class="container ab-section" aria-labelledby="ab-cats-h">
      <div class="ab-head">
        <h2 id="ab-cats-h">${esc(a.catsHeading)}</h2>
        <p>${esc(a.catsLead)}</p>
      </div>
      <ul class="ab-cats">
      ${catCards}
      </ul>
    </section>
    <section class="container ab-section" aria-labelledby="ab-steps-h">
      <div class="ab-head"><h2 id="ab-steps-h">${esc(a.stepsHeading)}</h2></div>
      <ol class="ab-steps">
        ${a.steps.map((s, i) => `<li><span class="ab-step-n">${i + 1}</span><strong>${esc(s.t)}</strong><p>${esc(s.d)}</p></li>`).join('\n        ')}
      </ol>
    </section>
    <section class="container ab-section">
      <div class="ab-note"><span class="badge">${esc(a.demoTitle)}</span><p>${esc(a.demoNote)}</p></div>
      <div class="ab-cta">
        <h2>${esc(a.ctaTitle)}</h2>
        <a class="btn btn-light" href="${ROUTES[lang].home}">${svgIcon(ICONS.map, 16)}${esc(a.cta)}</a>
      </div>
    </section>
  </main>`;
  const paths = { pl: ROUTES.pl.about, en: ROUTES.en.about };
  out.push({ urlPath: paths[lang], html: layout({ lang, title: a.title, description: a.description, paths, body, active: 'about', ui }) });
}

function notFoundPage(ctx) {
  const { ui } = ctx;
  const html = `<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${esc(ui.pl.notFound.title)}</title>
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/style.css?v=${ASSET_V}">
</head>
<body>
  <main class="notfound container" id="main">
    <p class="nf-code">404</p>
    <h1>${esc(ui.pl.notFound.h1)} / ${esc(ui.en.notFound.h1)}</h1>
    <p>${esc(ui.pl.notFound.text)}<br>${esc(ui.en.notFound.text)}</p>
    <p class="nf-links"><a class="btn" href="/">${esc(ui.pl.notFound.home)}</a> <a class="btn btn-ghost" href="/en/">${esc(ui.en.notFound.home)}</a></p>
  </main>
</body>
</html>
`;
  out.push({ urlPath: '/404.html', html, raw: true });
}

function buildSitemap(ctx) {
  const entries = [{ pl: ROUTES.pl.home, en: ROUTES.en.home }, { pl: ROUTES.pl.about, en: ROUTES.en.about }, ...ctx.places.map((p) => ({ pl: ROUTES.pl.place(p.slug), en: ROUTES.en.place(p.slug) }))];
  const today = new Date().toISOString().slice(0, 10);
  const urls = [];
  for (const e of entries)
    for (const l of LANGS) {
      const links = [...LANGS.map((m) => `<xhtml:link rel="alternate" hreflang="${m}" href="${abs(e[m])}"/>`), `<xhtml:link rel="alternate" hreflang="x-default" href="${abs(e.pl)}"/>`].join('');
      urls.push(`<url><loc>${abs(e[l])}</loc><lastmod>${today}</lastmod>${links}</url>`);
    }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}

// -------------------------------------------------------------------- build
async function build() {
  const t0 = Date.now();
  out.length = 0;
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(path.join(DIST, 'assets/vendor/leaflet'), { recursive: true });

  // static assets
  for (const f of ['style.css', 'favicon.svg']) await fs.copyFile(path.join(ROOT, 'src', f), path.join(DIST, 'assets', f));
  // logos (Wyspa, City of Warsaw) and the self-hosted Montserrat font (latin + latin-ext for the Polish letters)
  await fs.cp(path.join(ROOT, 'src/img'), path.join(DIST, 'assets/img'), { recursive: true });
  await fs.mkdir(path.join(DIST, 'assets/fonts'), { recursive: true });
  for (const f of ['montserrat-latin-wght-normal.woff2', 'montserrat-latin-ext-wght-normal.woff2'])
    await fs.copyFile(path.join(ROOT, 'node_modules/@fontsource-variable/montserrat/files', f), path.join(DIST, 'assets/fonts', f));
  await fs.writeFile(path.join(DIST, 'assets/app.js'), (await fs.readFile(path.join(ROOT, 'src/app.js'), 'utf8')).replaceAll('__BASE__', BASE));
  const leaflet = path.join(ROOT, 'node_modules/leaflet/dist');
  for (const f of ['leaflet.js', 'leaflet.css']) await fs.copyFile(path.join(leaflet, f), path.join(DIST, 'assets/vendor/leaflet', f));
  await fs.cp(path.join(leaflet, 'images'), path.join(DIST, 'assets/vendor/leaflet/images'), { recursive: true });
  // self-hosted vector map: renderer + Warsaw tiles (one PMTiles file, see README "Map tiles")
  await fs.mkdir(path.join(DIST, 'assets/vendor/protomaps-leaflet'), { recursive: true });
  await fs.copyFile(path.join(ROOT, 'node_modules/protomaps-leaflet/dist/protomaps-leaflet.js'), path.join(DIST, 'assets/vendor/protomaps-leaflet/protomaps-leaflet.js'));
  // editing panel (Sveltia CMS bundle + its chunks, config in admin/) -> /admin/
  await fs.cp(path.join(ROOT, 'admin'), path.join(DIST, 'admin'), { recursive: true });
  await fs.cp(path.join(ROOT, 'node_modules/@sveltia/cms/dist'), path.join(DIST, 'admin'), {
    recursive: true,
    filter: (src) => !src.endsWith('.map') && !src.endsWith('.mjs'),
  });
  await fs.mkdir(path.join(DIST, 'assets/map'), { recursive: true });
  await fs.copyFile(path.join(ROOT, 'content/map/warsaw.pmtiles'), path.join(DIST, 'assets/map/warsaw.pmtiles'));
  const h = crypto.createHash('md5');
  for (const f of ['style.css', 'app.js']) h.update(await fs.readFile(path.join(ROOT, 'src', f)));
  ASSET_V = h.digest('hex').slice(0, 8);

  const ctx = await loadContent();
  await preparePhotos(ctx.places);
  await prepareVideos(ctx.places);

  for (const lang of LANGS) {
    homePage(lang, ctx);
    aboutPage(lang, ctx);
    for (const p of ctx.places) placePage(lang, p, ctx);
  }
  notFoundPage(ctx);

  for (const { urlPath, html, raw } of out) {
    const file = raw ? path.join(DIST, urlPath) : path.join(DIST, urlPath, 'index.html');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, /\.(xml|txt)$/.test(file) ? html : withBase(html));
  }
  await fs.writeFile(path.join(DIST, 'sitemap.xml'), buildSitemap(ctx));
  await fs.writeFile(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  console.log(`Built ${out.length} pages for ${ctx.places.length} places in ${Date.now() - t0} ms -> dist/  (SITE_URL=${SITE_URL})`);
}

// -------------------------------------------------------------- dev server
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.xml': 'application/xml', '.yml': 'text/yaml; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
function serve(port = 4173) {
  http
    .createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      let rel = decodeURIComponent(url.pathname);
      // BASE_PATH=/repo npm run dev  serves the site under /repo/ exactly like GitHub Pages does
      if (BASE && (rel === BASE || rel.startsWith(BASE + '/'))) rel = rel.slice(BASE.length) || '/';
      let file = path.join(DIST, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
      try {
        if (fsSync.existsSync(file) && fsSync.statSync(file).isDirectory()) {
          if (!rel.endsWith('/')) {
            res.writeHead(301, { Location: BASE + rel + '/' + url.search });
            return res.end();
          }
          file = path.join(file, 'index.html');
        }
        const size = (await fs.stat(file)).size;
        const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes' };
        // HTTP Range support: the PMTiles map file is read in small slices, never downloaded whole.
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
        if (range && (range[1] || range[2])) {
          const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
          const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
          if (start > end || start >= size) {
            res.writeHead(416, { 'Content-Range': `bytes */${size}` });
            return res.end();
          }
          res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
          return fsSync.createReadStream(file, { start, end }).pipe(res);
        }
        res.writeHead(200, { ...headers, 'Content-Length': size });
        fsSync.createReadStream(file).pipe(res);
      } catch {
        const nf = await fs.readFile(path.join(DIST, '404.html')).catch(() => 'Not found');
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(nf);
      }
    })
    .listen(port, () => console.log(`Serving http://localhost:${port}`));
}

try {
  await build();
} catch (e) {
  console.error('Build failed:', e.message);
  process.exit(1);
}
if (process.argv.includes('--serve')) {
  serve(Number(process.env.PORT) || 4173);
  let timer;
  for (const dir of ['content', 'src', 'admin']) {
    fsSync.watch(path.join(ROOT, dir), { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => build().catch((e) => console.error('Build failed:', e.message)), 150);
    });
  }
}
