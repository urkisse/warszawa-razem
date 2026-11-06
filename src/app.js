/* Warszawa Razem – interactive map, multi-select filters, map/list toggle, mini map, lightbox.
   Plain JavaScript + Leaflet. Server-rendered HTML works without JS (list of all places). */
(() => {
  'use strict';
  const dataEl = document.getElementById('app-data');
  if (!dataEl || typeof L === 'undefined') return;
  const D = JSON.parse(dataEl.textContent);
  const S = D.strings;
  const catById = Object.fromEntries(D.cats.map((c) => [c.id, c]));
  const bySlug = Object.fromEntries(D.places.map((p) => [p.slug, p]));
  const WARSAW = [52.2297, 21.0122];
  const TILES_URL = '__BASE__/assets/map/warsaw.pmtiles'; // __BASE__ is filled in by build.mjs (BASE_PATH)
  const BOUNDS = [[52.0, 20.7], [52.46, 21.4]]; // a little wider than the tile coverage
  const canHover = window.matchMedia('(hover: hover)').matches;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const svg = (inner, size) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

  function pinIcon(cats) {
    const c = catById[cats[0]];
    const dots = cats
      .slice(1, 3)
      .map((id) => `<i style="--d:${catById[id].color}"></i>`)
      .join('');
    return L.divIcon({
      className: 'pin-wrap',
      html: `<div class="pin" style="--c:${c.color};--ink:${c.ink}"><span class="pin-body"></span><span class="pin-icon">${svg(c.icon, 18)}</span>${dots ? `<span class="pin-dots">${dots}</span>` : ''}</div>`,
      iconSize: [38, 38],
      iconAnchor: [19, 46],
      tooltipAnchor: [0, -44],
      popupAnchor: [0, -44],
    });
  }

  function popupHtml(p, href) {
    const tags = p.cats.map((id) => `<span class="tag" style="--c:${catById[id].color}"><i></i>${esc(catById[id].name)}</span>`).join('');
    const pin = svg('<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>', 14);
    return `<div class="pop"><img src="${p.img}" alt="" width="280" height="175"><div class="pop-body"><div class="tags">${tags}</div><strong class="pop-title">${esc(p.name)}</strong><span class="pop-addr">${pin}<span>${esc(p.address)}</span></span><p class="pop-sum">${esc(p.summary)}</p><a class="pop-btn" href="${href}">${esc(S.openPlace)} &rarr;</a></div></div>`;
  }

  function baseMap(el, opts) {
    const map = L.map(el, Object.assign({ zoomSnap: 0.5, attributionControl: true, maxBounds: BOUNDS, maxBoundsViscosity: 0.9 }, opts));
    // Self-hosted vector map: one PMTiles file (OpenStreetMap data, Protomaps basemap) served from
    // this site - no third-party tile server, no API key, no tracking. See README "Map tiles".
    if (window.protomapsL) {
      window.protomapsL
        .leafletLayer({
          url: TILES_URL,
          flavor: 'light',
          lang: D.lang,
          maxDataZoom: 14,
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &middot; <a href="https://protomaps.com">Protomaps</a>',
        })
        .addTo(map);
    }
    return map;
  }

  /* ------------------------------------------------ home: map + filters + list */
  const mapEl = document.getElementById('map');
  if (mapEl) {
    const map = baseMap(mapEl, { center: WARSAW, zoom: 12, minZoom: 10 });
    const markers = {};
    // a place without coordinates or category is still in the list, just not on the map
    const onMap = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.cats.length > 0;
    D.places.filter(onMap).forEach((p) => {
      const m = L.marker([p.lat, p.lng], { icon: pinIcon(p.cats), title: p.name, alt: p.name, riseOnHover: true });
      if (canHover) {
        // Hover shows the name; clicking opens a preview card with a separate button to the place page.
        const tip = () => m.bindTooltip(esc(p.name), { direction: 'top', className: 'pin-tip', opacity: 1 });
        tip();
        m.on('popupopen', () => m.unbindTooltip());
        m.on('popupclose', tip);
      }
      m.bindPopup(popupHtml(p, p.url), { className: 'place-popup', minWidth: 280, maxWidth: 280, autoPanPadding: [30, 30] });
      markers[p.slug] = m;
    });

    const cards = [...document.querySelectorAll('#list-view .card')];
    const chips = [...document.querySelectorAll('.chip')];
    const viewBtns = [...document.querySelectorAll('.seg button')];
    const countEl = document.getElementById('count');
    const emptyEl = document.getElementById('empty');
    const clearBtn = document.getElementById('clear');
    const plural = new Intl.PluralRules(D.lang);
    const state = { cats: new Set(), view: document.documentElement.dataset.view === 'list' ? 'list' : 'map' };

    const visible = (p) => !state.cats.size || p.cats.some((c) => state.cats.has(c));
    const fmtCount = (n) => `${n} ${S.count[plural.select(n)] || S.count.other}`;

    function fitTo(list, animate) {
      list = list.filter(onMap);
      if (!list.length) return;
      const pts = list.map((p) => [p.lat, p.lng]);
      if (pts.length === 1) return animate ? map.flyTo(pts[0], 15, { duration: 0.6 }) : map.setView(pts[0], 15);
      const b = L.latLngBounds(pts);
      const o = { padding: [70, 70], maxZoom: 15 };
      animate ? map.flyToBounds(b, Object.assign(o, { duration: 0.7 })) : map.fitBounds(b, o);
    }

    function syncUrl() {
      const q = new URLSearchParams();
      if (state.cats.size) q.set('cat', [...state.cats].join(','));
      if (state.view === 'list') q.set('view', 'list');
      const qs = q.toString() ? '?' + q.toString() : '';
      try {
        history.replaceState(null, '', location.pathname + qs + location.hash);
      } catch (e) {}
      document.querySelectorAll('[data-lang-link]').forEach((a) => (a.href = a.dataset.base + qs));
    }

    function apply(fit) {
      const list = D.places.filter(visible);
      D.places.forEach((p) => {
        const m = markers[p.slug];
        if (!m) return;
        const show = visible(p);
        if (show && !map.hasLayer(m)) m.addTo(map);
        else if (!show && map.hasLayer(m)) m.remove();
      });
      cards.forEach((li) => (li.hidden = !visible(bySlug[li.dataset.slug])));
      chips.forEach((b) => b.setAttribute('aria-pressed', String(state.cats.has(b.dataset.cat))));
      countEl.textContent = fmtCount(list.length);
      emptyEl.hidden = list.length > 0;
      clearBtn.hidden = !state.cats.size;
      if (fit && state.view === 'map') fitTo(list, fit === 'animate');
      syncUrl();
    }

    function setView(v) {
      state.view = v;
      document.documentElement.dataset.view = v;
      viewBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
      if (v === 'map') requestAnimationFrame(() => { map.invalidateSize(); fitTo(D.places.filter(visible), false); });
      syncUrl();
    }

    chips.forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.cat;
        state.cats.has(id) ? state.cats.delete(id) : state.cats.add(id);
        apply('animate');
      }),
    );
    clearBtn.addEventListener('click', () => { state.cats.clear(); apply('animate'); });
    viewBtns.forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

    // initial state from the URL: ?cat=music,sport&view=list
    const q = new URLSearchParams(location.search);
    (q.get('cat') || '').split(',').filter((id) => catById[id]).forEach((id) => state.cats.add(id));
    viewBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
    apply(false);
    fitTo(D.places.filter(visible), false);
    if (state.view === 'map') requestAnimationFrame(() => map.invalidateSize());
    window.addEventListener('resize', () => state.view === 'map' && map.invalidateSize());
  }

  /* ----------------------------------------------- place page: small map */
  document.querySelectorAll('[data-mini-map]').forEach((el) => {
    const lat = parseFloat(el.dataset.lat);
    const lng = parseFloat(el.dataset.lng);
    const map = baseMap(el, { center: [lat, lng], zoom: 15, scrollWheelZoom: false });
    L.marker([lat, lng], { icon: pinIcon(el.dataset.cats.split(',')), keyboard: false, interactive: false }).addTo(map);
  });

  /* ------------------------------------------------- place page: lightbox */
  const items = [...document.querySelectorAll('.g-item')];
    if (items.length) {
      const dlg = document.createElement('dialog');
      dlg.className = 'lightbox';
      dlg.setAttribute('aria-label', S.gallery || '');
      dlg.innerHTML = `<div class="lb-stage"><img alt="" draggable="false"><button type="button" class="lb-nav lb-prev" aria-label="${esc(S.prev)}">${svg('<path d="m15 18-6-6 6-6"/>', 22)}</button><button type="button" class="lb-nav lb-next" aria-label="${esc(S.next)}">${svg('<path d="m9 18 6-6-6-6"/>', 22)}</button><button type="button" class="lb-close" aria-label="${esc(S.close)}">${svg('<path d="M18 6 6 18M6 6l12 12"/>', 20)}</button></div><div class="lb-bar"><span class="lb-cap"></span><span class="lb-count"></span></div>`;
      document.body.appendChild(dlg);
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
})();
