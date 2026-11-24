// Quick-find rail: one tap shows the nearest gas, food, ATMs… plus your saved places.
import maplibregl from 'maplibre-gl';
import { blipInfo, PIN_SIZE } from './icons.js';
import { nearbyPhoton, nearbyFoursquare } from './api.js';
import { getSaved, getRecents, clearRecents } from './saved.js';
import { dist } from './geo.js';
import { fmtDist } from './format.js';
import { track } from './analytics.js';

const $ = (id) => document.getElementById(id);

// Rail icons (white line art), drawn for this app.
const I = {
  saved: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z"/>',
  gas: '<path d="M4 3h9a1 1 0 0 1 1 1v8h1a2 2 0 0 1 2 2v3a1 1 0 0 0 2 0V9l-2-2 1.4-1.4L21 8.2V17a3 3 0 0 1-6 0v-3h-1v7H3V4a1 1 0 0 1 1-1zm1 2v5h7V5z"/>',
  food: '<path d="M7 2v8a2 2 0 0 1-1 1.7V22H4V11.7A2 2 0 0 1 3 10V2h1.5v6h1V2h1v6h1V2zM17 2c2.2 0 4 2.7 4 6 0 2.3-1 4.3-2.5 5.3V22h-2V13.3C15 12.3 14 10.3 14 8c0-3.3 1.3-6 3-6z"/>',
  shop: '<path d="M6 7V6a6 6 0 0 1 12 0v1h3l-1 15H4L3 7zm2 0h8V6a4 4 0 0 0-8 0z"/>',
  atm: '<path d="M2 6h20v12H2zm2 2v8h16V8zm8 1.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM5 9h2v2H5zm12 4h2v2h-2z"/>',
  parking: '<path d="M5 3h8a6 6 0 0 1 0 12H9v6H5zm4 4v4h4a2 2 0 0 0 0-4z"/>',
  health: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  hotel: '<path d="M2 5h2v8h8V8h7a3 3 0 0 1 3 3v8h-2v-3H4v3H2zm6 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">${I[k]}</svg>`;

// cls = OpenStreetMap class used for the pin and the details card
export const CATEGORIES = [
  { id: 'saved', label: 'Saved', icon: 'saved', blip: 'blip-home' },
  { id: 'gas', label: 'Gas', icon: 'gas', blip: 'blip-fuel', fsq: 'gas station', q: 'fuel', tags: ['amenity:fuel'], classes: ['fuel'], cls: 'fuel' },
  { id: 'food', label: 'Food', icon: 'food', blip: 'blip-food', fsq: 'restaurant', q: 'restaurant', tags: ['amenity:restaurant', 'amenity:fast_food', 'amenity:cafe'], classes: ['restaurant', 'fast_food', 'cafe'], cls: 'restaurant' },
  { id: 'shop', label: 'Shops', icon: 'shop', blip: 'blip-shop', fsq: 'convenience store', q: 'shop', tags: ['shop:supermarket', 'shop:convenience', 'shop:mall'], classes: ['shop', 'grocery'], cls: 'shop' },
  { id: 'atm', label: 'ATM & banks', icon: 'atm', blip: 'blip-bank', fsq: 'atm', q: 'atm', tags: ['amenity:atm', 'amenity:bank'], classes: ['atm', 'bank'], cls: 'bank' },
  { id: 'parking', label: 'Parking', icon: 'parking', blip: 'blip-parking', fsq: 'parking', q: 'parking', tags: ['amenity:parking'], classes: ['parking'], cls: 'parking' },
  { id: 'health', label: 'Pharmacy & health', icon: 'health', blip: 'blip-health', fsq: 'pharmacy', q: 'pharmacy', tags: ['amenity:pharmacy', 'amenity:hospital', 'amenity:clinic'], classes: ['pharmacy', 'hospital', 'doctors'], cls: 'pharmacy' },
  { id: 'hotel', label: 'Hotels', icon: 'hotel', blip: 'blip-hotel', fsq: 'hotel', q: 'hotel', tags: ['tourism:hotel', 'tourism:motel', 'tourism:guest_house'], classes: ['lodging'], cls: 'lodging' },
];

let ctx = null;
let active = null;
let pins = [];
let seq = 0;

/**
 * @param map  main MapLibre map
 * @param c    { getPos(): [lng,lat]|null, openItem(item), showArea(coords[]) }
 */
export function initQuickFind(map, c) {
  ctx = { ...c, map };
  const rail = $('rail');
  rail.innerHTML = CATEGORIES.map((cat) => {
    const color = blipInfo(cat.blip)?.color || '#fff';
    return `<button class="rail-btn" data-id="${cat.id}" style="--cat:${color}" aria-label="${cat.label}" title="${cat.label}">${icon(cat.icon)}</button>`;
  }).join('');
  rail.onclick = (e) => {
    const btn = e.target.closest('.rail-btn');
    if (!btn) return;
    const cat = CATEGORIES.find((x) => x.id === btn.dataset.id);
    if (active === cat.id) closeQuickFind();
    else open(cat);
  };
  $('qf-close').onclick = closeQuickFind;
}

export const quickFindOpen = () => !!active;

/** Temporarily hide the results panel (e.g. while a place card is shown), keeping pins. */
export function setQuickFindVisible(visible) {
  const panel = $('qf-panel');
  if (!active) return;
  panel.hidden = !visible;
  panel.classList.toggle('show', visible);
}

export function closeQuickFind() {
  seq++;
  active = null;
  clearPins();
  document.querySelectorAll('.rail-btn').forEach((b) => b.classList.remove('active'));
  const panel = $('qf-panel');
  panel.classList.remove('show');
  setTimeout(() => !active && (panel.hidden = true), 200);
}

function open(cat) {
  const mySeq = ++seq;
  track('quick_find', { category: cat.id });
  active = cat.id;
  document.querySelectorAll('.rail-btn').forEach((b) => b.classList.toggle('active', b.dataset.id === cat.id));
  const info = blipInfo(cat.blip);
  const panel = $('qf-panel');
  panel.style.setProperty('--cat', info.color);
  $('qf-icon').src = info.url;
  $('qf-title').textContent = cat.id === 'saved' ? 'Saved places' : `Nearby ${cat.label}`;
  $('qf-sub').textContent = cat.id === 'saved' ? 'Home, work, favorites and recent searches' : 'Closest first';
  $('qf-list').innerHTML = '<li class="loading"><span></span><span></span></li>';
  panel.hidden = false;
  requestAnimationFrame(() => panel.classList.add('show'));
  clearPins();

  if (cat.id === 'saved') return renderSaved();
  const near = ctx.getPos();
  if (!near) {
    $('qf-list').innerHTML = '<li class="empty">Waiting for your location…</li>';
    return;
  }
  findNearby(cat, near).then((items) => {
    if (mySeq !== seq) return;
    render(items, cat);
    if (items.length) ctx.showArea([near, ...items.map((i) => i.coord)]);
  });
}

async function findNearby(cat, near) {
  // 1) pins already loaded on the map (instant, offline)
  const tile = ctx.map
    .querySourceFeatures('omt', { sourceLayer: 'poi' })
    .filter((f) => f.properties.name && cat.classes.includes(f.properties.class))
    .map((f) => ({ name: f.properties.name, coord: f.geometry.coordinates, cls: f.properties.class, source: 'map' }));
  // 2) OpenStreetMap search and 3) Foursquare, in parallel; either may fail
  const [osm, fsq] = await Promise.allSettled([nearbyPhoton(cat.q, cat.tags, near), nearbyFoursquare(cat.fsq, near)]);
  const all = [
    ...(fsq.status === 'fulfilled' ? fsq.value.map((i) => ({ ...i, cls: cat.cls })) : []),
    ...tile,
    ...(osm.status === 'fulfilled' ? osm.value.map((i) => ({ ...i, cls: classFor(cat, i.osmValue) })) : []),
  ];
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const out = [];
  for (const it of all) {
    it.d = dist(near, it.coord);
    if (it.d > 15000) continue;
    const dup = out.find((o) => norm(o.name) === norm(it.name) && dist(o.coord, it.coord) < 250);
    if (dup) {
      if (!dup.sub && it.sub) dup.sub = it.sub; // keep the better address
      continue;
    }
    out.push(it);
  }
  return out.sort((a, b) => a.d - b.d).slice(0, 8);
}

function classFor(cat, osmValue) {
  return cat.classes.includes(osmValue) ? osmValue : cat.cls;
}

function render(items, cat) {
  const list = $('qf-list');
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<li class="empty">Nothing found nearby. Try zooming the map around another area.</li>';
    return;
  }
  items.forEach((it) => {
    const li = document.createElement('li');
    li.innerHTML = '<div class="qf-name"></div><div class="qf-meta"><b></b><span></span></div>';
    li.querySelector('.qf-name').textContent = it.name;
    li.querySelector('b').textContent = fmtDist(it.d);
    li.querySelector('span').textContent = it.sub || '';
    li.onclick = () => ctx.openItem(it);
    list.appendChild(li);
    addPin(it, cat.blip);
  });
  if (items.some((i) => i.source === 'foursquare')) {
    list.insertAdjacentHTML('beforeend', '<li class="credit">Includes results powered by Foursquare</li>');
  }
}

function renderSaved() {
  const s = getSaved();
  const near = ctx.getPos();
  const rows = [];
  if (s.home) rows.push({ ...s.home, kind: 'Home', blip: 'blip-home' });
  if (s.work) rows.push({ ...s.work, kind: 'Work', blip: 'blip-work' });
  s.favorites.forEach((f) => rows.push({ ...f, kind: 'Favorite', blip: 'blip-fav' }));
  const recents = getRecents();
  const list = $('qf-list');
  list.innerHTML = '';
  if (!rows.length) {
    list.insertAdjacentHTML('beforeend', '<li class="empty">Open any place and tap the bookmark button to save it as Home, Work or a favorite.</li>');
  }
  for (const r of rows) {
    const li = document.createElement('li');
    li.className = 'saved';
    li.innerHTML = `<img src="${blipInfo(r.blip).url}" alt=""><div><div class="qf-name"></div><div class="qf-meta"><b></b><span></span></div></div>`;
    li.querySelector('.qf-name').textContent = r.name;
    li.querySelector('b').textContent = r.kind;
    li.querySelector('span').textContent = near ? fmtDist(dist(near, r.coord)) : '';
    li.onclick = () => ctx.openItem({ ...r, cls: r.cls, blip: r.blip });
    list.appendChild(li);
  }
  if (recents.length) {
    list.insertAdjacentHTML('beforeend', '<li class="section">Recent searches <button id="qf-clear-recent">Clear</button></li>');
    for (const r of recents) {
      const li = document.createElement('li');
      li.innerHTML = '<div class="qf-name"></div><div class="qf-meta"><span></span></div>';
      li.querySelector('.qf-name').textContent = r.name;
      li.querySelector('span').textContent = r.sub || '';
      li.onclick = () => ctx.openItem(r);
      list.appendChild(li);
    }
    $('qf-clear-recent').onclick = (e) => {
      e.stopPropagation();
      clearRecents();
      renderSaved();
    };
  }
}

function addPin(item, blip) {
  const el = document.createElement('img');
  el.src = blipInfo(blip).url;
  el.className = 'qf-pin';
  el.style.width = `${PIN_SIZE.width}px`;
  el.style.height = `${PIN_SIZE.height}px`;
  el.onclick = (e) => {
    e.stopPropagation();
    ctx.openItem(item);
  };
  pins.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(item.coord).addTo(ctx.map));
}

function clearPins() {
  pins.forEach((p) => p.remove());
  pins = [];
}
