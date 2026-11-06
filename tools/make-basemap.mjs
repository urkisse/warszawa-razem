// Turns a raw Overpass JSON export (water, parks, forests, main roads of Warsaw) into a compact
// offline basemap: artifact/basemap.json. Used only for the single-page artifact build, where
// external map tiles are blocked.
//   node tools/make-basemap.mjs <raw-overpass.json>
// Map data (c) OpenStreetMap contributors, ODbL.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const key = (p) => `${p.lat},${p.lon}`;
const toPts = (g) => g.map((p) => [p.lat, p.lon]);

function dp(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    const [ay, ax] = pts[a], [by, bx] = pts[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [py, px] = pts[i];
      let d;
      if (len2 === 0) d = Math.hypot(px - ax, py - ay);
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (d > max) { max = d; idx = i; }
    }
    if (max > eps) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function stitch(ways) {
  const rings = [];
  const pool = ways.map((w) => w.slice());
  while (pool.length) {
    let cur = pool.shift();
    let guard = 0;
    while (key({ lat: cur[0][0], lon: cur[0][1] }) !== key({ lat: cur[cur.length - 1][0], lon: cur[cur.length - 1][1] }) && guard++ < 5000) {
      const end = cur[cur.length - 1];
      let found = -1, rev = false;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i];
        if (w[0][0] === end[0] && w[0][1] === end[1]) { found = i; break; }
        if (w[w.length - 1][0] === end[0] && w[w.length - 1][1] === end[1]) { found = i; rev = true; break; }
      }
      if (found < 0) break;
      let w = pool.splice(found, 1)[0];
      if (rev) w = w.reverse();
      cur = cur.concat(w.slice(1));
    }
    if (cur.length > 3 && cur[0][0] === cur[cur.length - 1][0] && cur[0][1] === cur[cur.length - 1][1]) rings.push(cur);
  }
  return rings;
}

const extent = (ring) => {
  let a = 90, b = -90, c = 180, d = -180;
  for (const [y, x] of ring) { a = Math.min(a, y); b = Math.max(b, y); c = Math.min(c, x); d = Math.max(d, x); }
  return Math.max(b - a, d - c);
};

const water = [], parks = [], roads = { major: [], secondary: [], tertiary: [] };

for (const el of raw.elements) {
  const t = el.tags || {};
  const isWater = t.natural === 'water' || t.waterway === 'riverbank';
  const isPark = t.leisure === 'park' || t.landuse === 'forest';
  if (el.type === 'way' && t.highway) {
    const cls = /^(motorway|trunk|primary)$/.test(t.highway) ? 'major' : t.highway === 'secondary' ? 'secondary' : 'tertiary';
    roads[cls].push(dp(toPts(el.geometry), 0.00006));
  } else if (isWater || isPark) {
    let rings = [];
    if (el.type === 'way') rings = [toPts(el.geometry)];
    else if (el.type === 'relation') rings = stitch((el.members || []).filter((m) => m.geometry && (m.role === 'outer' || m.role === 'inner')).map((m) => toPts(m.geometry)));
    rings = rings.filter((r) => r.length > 3 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]);
    if (!rings.length) continue;
    const minExt = isWater ? 0.0012 : 0.0016;
    if (Math.max(...rings.map(extent)) < minExt) continue;
    const simp = rings.map((r) => dp(r, 0.00005)).filter((r) => r.length > 3);
    if (simp.length) (isWater ? water : parks).push(simp);
  }
}

// delta-encode into flat integer arrays (1e5 units) to keep the page small
const enc = (pts) => {
  const out = [];
  let py = 0, px = 0;
  for (const [y, x] of pts) {
    const iy = Math.round(y * 1e5), ix = Math.round(x * 1e5);
    out.push(iy - py, ix - px);
    py = iy; px = ix;
  }
  return out;
};
const data = {
  water: water.map((rings) => rings.map(enc)),
  parks: parks.map((rings) => rings.map(enc)),
  roads: { major: roads.major.map(enc), secondary: roads.secondary.map(enc), tertiary: roads.tertiary.map(enc) },
};
fs.mkdirSync(path.join(ROOT, 'artifact'), { recursive: true });
const out = path.join(ROOT, 'artifact/basemap.json');
fs.writeFileSync(out, JSON.stringify(data));
const n = (a) => a.reduce((s, p) => s + p.length / 2, 0);
console.log(`water polygons=${water.length} parks=${parks.length} roads major/sec/ter=${roads.major.length}/${roads.secondary.length}/${roads.tertiary.length}`);
console.log(`size=${(fs.statSync(out).size / 1024).toFixed(0)} KB, road points=${n([...roads.major, ...roads.secondary, ...roads.tertiary])}`);
