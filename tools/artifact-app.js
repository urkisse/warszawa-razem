/* Single-page version of the demo for the Claude artifact viewer.
   The viewer blocks external map tiles and query strings, so this build:
   - draws a simplified offline basemap (OpenStreetMap data) instead of tiles,
   - routes with #hash names (#pl, #en, #pl-place-koneser, #en-about ...),
   - keeps filter state in memory.
   ROUTES, IMG and BASE are injected by tools/build-artifact.mjs. */
(() => {
  'use strict';
  const root = document.getElementById('root');
  const html = document.documentElement;
  html.classList.add('js');
  const canHover = window.matchMedia('(hover: hover)').matches;
  const WARSAW = [52.2297, 21.0122];
  const G = { cats: new Set(), view: 'map' };
  let maps = [];

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const svg = (inner, size) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

  /* ------------------------------------------------------------ routing */
  function urlToHash(u) {
    const [p, q] = u.split('?');
    const cat = q && /(?:^|&)cat=([a-z]+)/.exec(q);
    let m;
    if (p === '/') return cat ? `#pl-cat-${cat[1]}` : '#pl';
    if (p === '/en/') return cat ? `#en-cat-${cat[1]}` : '#en';
    if (p === '/o-projekcie/') return '#pl-about';
    if (p === '/en/about/') return '#en-about';
    if ((m = /^\/miejsca\/([a-z0-9-]+)\/$/.exec(p))) return `#pl-place-${m[1]}`;
    if ((m = /^\/en\/places\/([a-z0-9-]+)\/$/.exec(p))) return `#en-place-${m[1]}`;
    return null;
  }
  function fill(s) {
    return s
      .replace(/\/img\/places\/[^"'\s)\\]+\.(?:svg|jpg)/g, (m) => IMG[m] || m)
      .replace(/href="(\/[^"]*)"/g, (m, u) => {
        const h = urlToHash(u);
        return h ? `href="${h}"` : m;
      });
  }
  function parseRoute() {
    const h = decodeURIComponent(location.hash.slice(1) || 'pl');
    let m = /^(pl|en)-cat-([a-z]+)$/.exec(h);
    if (m) return { key: m[1], lang: m[1], cat: m[2] };
    if (ROUTES[h]) return { key: h, lang: h.slice(0, 2) };
    return { key: 'pl', lang: 'pl' };
  }
  function render() {
    maps.forEach((m) => m.remove());
    maps = [];
    const r = parseRoute();
    if (r.cat) {
      G.cats = new Set([r.cat]);
      history.replaceState(null, '', '#' + r.key);
    }
    root.innerHTML = fill(ROUTES[r.key]);
    html.lang = r.lang;
    window.scrollTo(0, 0);
    init();
  }

  /* ------------------------------------------------------ offline basemap */
  let BM = null;
  const dec = (a) => {
    const out = [];
    let y = 0, x = 0;
    for (let i = 0; i < a.length; i += 2) {
      y += a[i];
      x += a[i + 1];
      out.push([y / 1e5, x / 1e5]);
    }
    return out;
  };
  function basemap() {
    if (!BM)
      BM = {
        water: BASE.water.map((r) => r.map(dec)),
        parks: BASE.parks.map((r) => r.map(dec)),
        roads: { major: BASE.roads.major.map(dec), secondary: BASE.roads.secondary.map(dec), tertiary: BASE.roads.tertiary.map(dec) },
      };
    return BM;
  }
  const LABELS = [
    ['Śródmieście', 52.2325, 21.0125], ['Wola', 52.2385, 20.9700], ['Ochota', 52.2135, 20.9830],
    ['Mokotów', 52.1960, 21.0080], ['Żoliborz', 52.2715, 20.9850], ['Praga-Północ', 52.2625, 21.0390], ['Praga-Południe', 52.2330, 21.0770],
  ];
  function drawBasemap(map, labels) {
    const bm = basemap();
    const cv = L.canvas({ padding: 0.4 });
    const poly = (rings, color) => L.polygon(rings, { renderer: cv, interactive: false, stroke: false, fill: true, fillColor: color, fillOpacity: 1 }).addTo(map);
    bm.parks.forEach((r) => poly(r, '#d9e8c9'));
    bm.water.forEach((r) => poly(r, '#b5d3e9'));
    const line = (lines, color) => L.polyline(lines, { renderer: cv, interactive: false, color, lineCap: 'round', lineJoin: 'round', smoothFactor: 1.5 }).addTo(map);
    const cls = [
      { k: 'tertiary', cas: '#e3dfd4', fl: '#ffffff', w: 1, min: 13 },
      { k: 'secondary', cas: '#d9d4c7', fl: '#ffffff', w: 1.7, min: 11 },
      { k: 'major', cas: '#cfc8b6', fl: '#fff9e6', w: 2.6, min: 0 },
    ].map((c) => ({ ...c, casing: line(bm.roads[c.k], c.cas), core: line(bm.roads[c.k], c.fl) }));
    const style = () => {
      const z = map.getZoom();
      const f = Math.pow(2, (z - 12) * 0.55);
      cls.forEach((c) => {
        const on = z >= c.min ? 1 : 0;
        c.casing.setStyle({ weight: c.w * f + 1.6, opacity: on });
        c.core.setStyle({ weight: c.w * f, opacity: on });
      });
      map.getContainer().classList.toggle('z-hi', z >= 14);
    };
    map.on('zoomend', style);
    style();
    if (labels)
      LABELS.forEach(([n, la, lo]) => L.marker([la, lo], { interactive: false, keyboard: false, icon: L.divIcon({ className: 'map-label', html: `<span>${n}</span>`, iconSize: [0, 0] }) }).addTo(map));
    map.attributionControl.addAttribution('Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors');
  }
  function baseMap(el, opts, labels) {
    const map = L.map(el, Object.assign({ zoomSnap: 0.5 }, opts));
    drawBasemap(map, labels);
    maps.push(map);
    return map;
  }

  /* --------------------------------------------------------------- pages */
  function init() {
    const dataEl = document.getElementById('app-data');
    if (!dataEl) return;
    const D = JSON.parse(dataEl.textContent);
    const S = D.strings;
    const catById = Object.fromEntries(D.cats.map((c) => [c.id, c]));
    const bySlug = Object.fromEntries(D.places.map((p) => [p.slug, p]));

    const skip = root.querySelector('.skip');
    const main = document.getElementById('main');
    if (skip && main) {
      main.tabIndex = -1;
      skip.addEventListener('click', (e) => { e.preventDefault(); main.focus(); });
    }

    function pinIcon(cats) {
      const c = catById[cats[0]];
      const dots = cats.slice(1, 3).map((id) => `<i style="--d:${catById[id].color}"></i>`).join('');
      return L.divIcon({
        className: 'pin-wrap',
        html: `<div class="pin" style="--c:${c.color};--ink:${c.ink}"><span class="pin-body"></span><span class="pin-icon">${svg(c.icon, 18)}</span>${dots ? `<span class="pin-dots">${dots}</span>` : ''}</div>`,
        iconSize: [38, 38], iconAnchor: [19, 46], tooltipAnchor: [0, -44], popupAnchor: [0, -44],
      });
    }

    function popupHtml(p, href) {
      const tags = p.cats.map((id) => `<span class="tag" style="--c:${catById[id].color}"><i></i>${esc(catById[id].name)}</span>`).join('');
      const pin = svg('<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>', 14);
      return `<div class="pop"><img src="${p.img}" alt="" width="280" height="175"><div class="pop-body"><div class="tags">${tags}</div><strong class="pop-title">${esc(p.name)}</strong><span class="pop-addr">${pin}<span>${esc(p.address)}</span></span><p class="pop-sum">${esc(p.summary)}</p><a class="pop-btn" href="${href}">${esc(S.openPlace)} &rarr;</a></div></div>`;
    }

    const mapEl = document.getElementById('map');
    if (mapEl) {
      html.dataset.view = G.view;
      const map = baseMap(mapEl, { center: WARSAW, zoom: 12, minZoom: 10 }, true);
      const markers = {};
      D.places.forEach((p) => {
        const m = L.marker([p.lat, p.lng], { icon: pinIcon(p.cats), title: p.name, alt: p.name, riseOnHover: true });
        if (canHover) {
          // Hover shows the name; clicking opens a preview card with a separate button to the place page.
          const tip = () => m.bindTooltip(esc(p.name), { direction: 'top', className: 'pin-tip', opacity: 1 });
          tip();
          m.on('popupopen', () => m.unbindTooltip());
          m.on('popupclose', tip);
        }
        m.bindPopup(popupHtml(p, urlToHash(p.url)), { className: 'place-popup', minWidth: 280, maxWidth: 280, autoPanPadding: [30, 30] });
        markers[p.slug] = m;
      });

      const cards = [...document.querySelectorAll('#list-view .card')];
      const chips = [...document.querySelectorAll('.chip')];
      const viewBtns = [...document.querySelectorAll('.seg button')];
      const countEl = document.getElementById('count');
      const emptyEl = document.getElementById('empty');
      const clearBtn = document.getElementById('clear');
      const plural = new Intl.PluralRules(D.lang);
      const visible = (p) => !G.cats.size || p.cats.some((c) => G.cats.has(c));
      const fmtCount = (n) => `${n} ${S.count[plural.select(n)] || S.count.other}`;

      function fitTo(list, animate) {
        if (!list.length) return;
        const pts = list.map((p) => [p.lat, p.lng]);
        if (pts.length === 1) return animate ? map.flyTo(pts[0], 15, { duration: 0.6 }) : map.setView(pts[0], 15);
        const b = L.latLngBounds(pts);
        const o = { padding: [70, 70], maxZoom: 15 };
        animate ? map.flyToBounds(b, Object.assign(o, { duration: 0.7 })) : map.fitBounds(b, o);
      }
      function apply(fit) {
        const list = D.places.filter(visible);
        D.places.forEach((p) => {
          const m = markers[p.slug];
          const show = visible(p);
          if (show && !map.hasLayer(m)) m.addTo(map);
          else if (!show && map.hasLayer(m)) m.remove();
        });
        cards.forEach((li) => (li.hidden = !visible(bySlug[li.dataset.slug])));
        chips.forEach((b) => b.setAttribute('aria-pressed', String(G.cats.has(b.dataset.cat))));
        countEl.textContent = fmtCount(list.length);
        emptyEl.hidden = list.length > 0;
        clearBtn.hidden = !G.cats.size;
        if (fit && G.view === 'map') fitTo(list, fit === 'animate');
      }
      function setView(v) {
        G.view = v;
        html.dataset.view = v;
        viewBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
        if (v === 'map') requestAnimationFrame(() => { map.invalidateSize(); fitTo(D.places.filter(visible), false); });
      }
      chips.forEach((b) => b.addEventListener('click', () => {
        const id = b.dataset.cat;
        G.cats.has(id) ? G.cats.delete(id) : G.cats.add(id);
        apply('animate');
      }));
      clearBtn.addEventListener('click', () => { G.cats.clear(); apply('animate'); });
      viewBtns.forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
      viewBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === G.view)));
      apply(false);
      fitTo(D.places.filter(visible), false);
      requestAnimationFrame(() => { map.invalidateSize(); if (G.view === 'map') fitTo(D.places.filter(visible), false); });
    }

    document.querySelectorAll('[data-mini-map]').forEach((el) => {
      const lat = parseFloat(el.dataset.lat), lng = parseFloat(el.dataset.lng);
      const map = baseMap(el, { center: [lat, lng], zoom: 15, scrollWheelZoom: false }, false);
      L.marker([lat, lng], { icon: pinIcon(el.dataset.cats.split(',')), keyboard: false, interactive: false }).addTo(map);
    });

    const items = [...document.querySelectorAll('.g-item')];
    if (items.length) {
      const dlg = document.createElement('dialog');
      dlg.className = 'lightbox';
      dlg.setAttribute('aria-label', S.gallery || '');
      dlg.innerHTML = `<div class="lb-stage"><img alt="" draggable="false"><button type="button" class="lb-nav lb-prev" aria-label="${esc(S.prev)}">${svg('<path d="m15 18-6-6 6-6"/>', 22)}</button><button type="button" class="lb-nav lb-next" aria-label="${esc(S.next)}">${svg('<path d="m9 18 6-6-6-6"/>', 22)}</button><button type="button" class="lb-close" aria-label="${esc(S.close)}">${svg('<path d="M18 6 6 18M6 6l12 12"/>', 20)}</button></div><div class="lb-bar"><span class="lb-cap"></span><span class="lb-count"></span></div>`;
      root.appendChild(dlg);
      const img = dlg.querySelector('img');
      const cap = dlg.querySelector('.lb-cap');
      const count = dlg.querySelector('.lb-count');
      const prev = dlg.querySelector('.lb-prev');
      const next = dlg.querySelector('.lb-next');
      let idx = 0;
      const many = items.length > 1;
      prev.hidden = next.hidden = count.hidden = !many;
      const show = (i) => {
        idx = (i + items.length) % items.length;
        const b = items[idx];
        img.src = b.dataset.full;
        img.alt = b.dataset.alt || '';
        cap.textContent = b.dataset.alt || '';
        count.textContent = `${idx + 1} / ${items.length}`;
        if (many) new Image().src = items[(idx + 1) % items.length].dataset.full;
      };
      items.forEach((b, i) => b.addEventListener('click', () => { show(i); dlg.showModal(); }));
      prev.addEventListener('click', () => show(idx - 1));
      next.addEventListener('click', () => show(idx + 1));
      dlg.querySelector('.lb-close').addEventListener('click', () => dlg.close());
      dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.classList.contains('lb-stage')) dlg.close(); });
      dlg.addEventListener('keydown', (e) => {
        if (!many) return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); show(idx - 1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); show(idx + 1); }
      });
      let sx = null;
      const stage = dlg.querySelector('.lb-stage');
      stage.addEventListener('pointerdown', (e) => { sx = e.clientX; });
      stage.addEventListener('pointerup', (e) => {
        if (sx === null || !many) return;
        const dx = e.clientX - sx;
        sx = null;
        if (Math.abs(dx) > 50) show(idx + (dx < 0 ? 1 : -1));
      });
    }
  }

  window.addEventListener('hashchange', render);
  render();
})();
