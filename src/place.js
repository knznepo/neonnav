// Place details card shown when a map blip is tapped.
import maplibregl from 'maplibre-gl';
import { POI_BLIPS } from './style.js';
import { blipInfo } from './icons.js';
import { placeDetails, placePhotos, reverseGeocode } from './api.js';
import { dist, bearing } from './geo.js';
import { fmtDist, fmtDuration } from './format.js';
import { isOpenNow } from './hours.js';

const $ = (id) => document.getElementById(id);

const NICE = {
  fuel: 'Gas Station', fast_food: 'Fast Food', ice_cream: 'Ice Cream', clothing_store: 'Clothing Store',
  department_store: 'Department Store', doctors: 'Doctor', atm: 'ATM', lodging: 'Hotel', beer: 'Bar',
  attraction: 'Attraction', parking: 'Parking',
};
const titleCase = (s) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const ICONS = {
  pin: '<path d="M12 22s7-7.5 7-12.5a7 7 0 0 0-14 0C5 14.5 12 22 12 22zm0-10a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/>',
  clock: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 10.4 3.5 2.1-1 1.7L11 13V6h2z"/>',
  phone: '<path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z"/>',
  globe: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-3a15 15 0 0 0-1.3-3.9A8 8 0 0 1 18.9 8zM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.8 1.9-4zM4.3 14a8 8 0 0 1 0-4h3.4a16 16 0 0 0 0 4zm.8 2h3a15 15 0 0 0 1.3 3.9A8 8 0 0 1 5.1 16zm3-8h-3a8 8 0 0 1 4.3-3.9C8.8 5.3 8.4 6.6 8.1 8zM12 20c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.8-1.9 4zm2.3-6H9.7a14 14 0 0 1 0-4h4.6a14 14 0 0 1 0 4zm.3 5.9c.6-1.2 1-2.5 1.3-3.9h3a8 8 0 0 1-4.3 3.9zm1.7-5.9a16 16 0 0 0 0-4h3.4a8 8 0 0 1 0 4z"/>',
  tag: '<path d="M21.4 11.6 12.4 2.6A2 2 0 0 0 11 2H4a2 2 0 0 0-2 2v7c0 .6.2 1 .6 1.4l9 9a2 2 0 0 0 2.8 0l7-7a2 2 0 0 0 0-2.8zM6.5 8a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/>',
  access: '<path d="M12 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm9 7h-6v13h-2v-6h-2v6H9V9H3V7h18z"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">${ICONS[name]}</svg>`;

let current = null;
let seq = 0;
let ring = null;

/**
 * @param map       main MapLibre map (for the selection ring)
 * @param feature   rendered POI feature
 * @param ctx       { from: [lng,lat]|null, heading, onWaypoint(coord,name), onGo(coord,name) }
 */
export function openPlace(map, feature, ctx) {
  const p = feature.properties;
  const coord = feature.geometry.coordinates.slice(0, 2);
  const blipId = POI_BLIPS[p.class];
  const info = blipInfo(blipId) || { url: '', color: '#d63cff', label: 'Place' };
  const name = p['name:latin'] || p.name || NICE[p.subclass] || titleCase(p.subclass || p.class || 'Place');
  const category = NICE[p.subclass] || NICE[p.class] || titleCase(p.subclass || p.class || info.label);
  current = { coord, name, ctx };
  const mySeq = ++seq;

  const card = $('place');
  card.style.setProperty('--cat', info.color);
  $('place-icon').src = info.url;
  $('place-cat').textContent = category;
  $('place-name').textContent = name;
  $('place-badge').hidden = true;

  // quick stats from straight-line distance
  if (ctx.from) {
    const d = dist(ctx.from, coord);
    const b = bearing(ctx.from, coord);
    $('place-dist').textContent = fmtDist(d);
    const rel = (b - (ctx.heading || 0) + 360) % 360; // relative to screen-up
    $('place-dir').innerHTML =
      `<svg viewBox="0 0 24 24" width="16" height="16"><path transform="rotate(${rel.toFixed(0)} 12 12)" d="M12 2 20 21 12 16.5 4 21z" fill="#ffcc00"/></svg>` +
      COMPASS[Math.round(b / 45) % 8];
    // rough city-driving estimate: roads ~35% longer than straight line, ~40 km/h average
    $('place-time').textContent = `≈${fmtDuration((d * 1.35) / 11)}`;
  } else {
    $('place-dist').textContent = $('place-dir').textContent = $('place-time').textContent = '—';
  }

  $('place-info').innerHTML = '<li class="loading"><span></span><span></span></li>';
  $('place-chips').hidden = true;
  $('place-photos').hidden = true;
  $('place-photos').querySelector('.pp-track').innerHTML = '';
  $('place-call').hidden = true;
  $('place-web').hidden = true;
  card.hidden = false;
  card.classList.remove('show');
  requestAnimationFrame(() => card.classList.add('show'));

  ring?.remove();
  const el = document.createElement('div');
  el.className = 'select-ring';
  el.style.setProperty('--cat', info.color);
  el.innerHTML = '<span></span>';
  ring = new maplibregl.Marker({ element: el }).setLngLat(coord).addTo(map);

  loadDetails(p.name, coord, mySeq);
}

function loadDetails(name, coord, mySeq) {
  let tags;
  let rev;
  let pending = 2;
  const done = () => {
    pending--;
    if (mySeq === seq) renderDetails(tags || {}, rev, pending > 0);
  };
  placeDetails(name, coord)
    .then((t) => (tags = t), () => {})
    .finally(() => {
      done();
      loadPhotos(tags, coord, mySeq); // photo links live in the place's tags
    });
  reverseGeocode(coord).then((r) => (rev = r), () => {}).finally(done);
}

function renderDetails(t, rev, stillLoading) {
  const rows = [];
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  const address = street ? [street, t['addr:city']].filter(Boolean).join(', ') : rev?.address;
  if (address) rows.push(['pin', address]);

  const hours = t.opening_hours;
  if (hours) {
    rows.push(['clock', hours.replace(/;\s*/g, '\n')]);
    const open = isOpenNow(hours);
    if (open !== null) {
      const badge = $('place-badge');
      badge.textContent = hours.trim() === '24/7' ? 'Open 24/7' : open ? 'Open now' : 'Closed';
      badge.classList.toggle('closed', !open);
      badge.hidden = false;
    }
  }
  const phone = t.phone || t['contact:phone'];
  if (phone) rows.push(['phone', phone]);
  const web = t.website || t['contact:website'];
  if (web) rows.push(['globe', web.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')]);
  const extra = [t.cuisine && titleCase(t.cuisine.replace(/;/g, ', ')), t.brand || t.operator].filter(Boolean).join(' · ');
  if (extra) rows.push(['tag', extra]);
  if (t.wheelchair === 'yes') rows.push(['access', 'Wheelchair accessible']);
  if (!rows.length && !stillLoading) rows.push(['tag', 'No extra details on OpenStreetMap yet']);

  const yes = (k) => t[k] && t[k] !== 'no';
  const chips = [
    yes('drive_through') && 'Drive-through',
    yes('takeaway') && 'Takeaway',
    yes('delivery') && 'Delivery',
    yes('outdoor_seating') && 'Outdoor seating',
    ['wlan', 'yes'].includes(t.internet_access) && 'Wi-Fi',
    yes('air_conditioning') && 'A/C',
    t['payment:credit_cards'] === 'yes' && 'Cards',
    t.fee === 'no' && 'Free',
  ].filter(Boolean);
  const chipBox = $('place-chips');
  chipBox.innerHTML = chips.map((c) => `<span>${c}</span>`).join('');
  chipBox.hidden = !chips.length;

  const list = $('place-info');
  list.innerHTML = '';
  for (const [icon, text] of rows) {
    const li = document.createElement('li');
    li.innerHTML = `${svg(icon)}<span></span>`;
    li.lastChild.textContent = text;
    list.appendChild(li);
  }
  if (stillLoading) list.insertAdjacentHTML('beforeend', '<li class="loading"><span></span></li>');
  if (phone) {
    $('place-call').href = `tel:${phone.split(';')[0].replace(/\s/g, '')}`;
    $('place-call').hidden = false;
  }
  if (web) {
    $('place-web').href = /^https?:/.test(web) ? web : `https://${web}`;
    $('place-web').hidden = false;
  }
}

// ---------------------------------------------------------------- photos
async function loadPhotos(tags, coord, mySeq) {
  const { photos, nearby } = await placePhotos(tags, coord).catch(() => ({ photos: [] }));
  if (mySeq !== seq || !photos.length) return;
  const box = $('place-photos');
  const track = box.querySelector('.pp-track');
  track.innerHTML = '';
  photos.forEach((ph, i) => {
    const img = document.createElement('img');
    img.alt = '';
    img.loading = i === 0 ? 'eager' : 'lazy';
    img.decoding = 'async';
    img.src = ph.thumb;
    img.onload = () => img.classList.add('loaded');
    img.onerror = () => {
      img.remove();
      if (!track.children.length) box.hidden = true;
    };
    img.onclick = () => openViewer(ph);
    track.appendChild(img);
  });
  const update = () => {
    const i = Math.min(photos.length - 1, Math.round(track.scrollLeft / Math.max(1, track.clientWidth)));
    const ph = photos[i];
    $('pp-count').textContent = `${nearby ? 'Nearby photo' : 'Photo'}${photos.length > 1 ? ` ${i + 1}/${photos.length}` : ''}`;
    const credit = $('pp-credit');
    credit.textContent = ph.credit;
    credit.href = ph.link;
  };
  track.onscroll = update;
  track.scrollLeft = 0;
  update();
  box.hidden = false;
  box.classList.remove('open');
  requestAnimationFrame(() => box.classList.add('open'));
}

function openViewer(ph) {
  const img = $('viewer-img');
  img.onerror = () => {
    img.onerror = null;
    img.src = ph.fallback || ph.thumb; // larger size not available
  };
  img.src = ph.full;
  $('viewer-credit').textContent = ph.credit;
  $('viewer-credit').href = ph.link;
  $('viewer').hidden = false;
}
const closeViewer = () => ($('viewer').hidden = true);
$('viewer-close').onclick = closeViewer;
$('viewer').onclick = (e) => e.target.id === 'viewer' && closeViewer();
$('viewer-img').onclick = closeViewer;

export function closePlace() {
  seq++;
  current = null;
  ring?.remove();
  ring = null;
  const card = $('place');
  card.classList.remove('show');
  setTimeout(() => !current && (card.hidden = true), 220);
}

export const placeOpen = () => !!current;

$('place-close').onclick = closePlace;
$('place-waypoint').onclick = () => {
  if (!current) return;
  const { coord, name, ctx } = current;
  closePlace();
  ctx.onWaypoint(coord, name);
};
$('place-go').onclick = () => {
  if (!current) return;
  const { coord, name, ctx } = current;
  closePlace();
  ctx.onGo(coord, name);
};
