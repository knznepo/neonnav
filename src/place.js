// Place details card shown when a map blip is tapped.
import { POI_BLIPS } from './style.js';
import { blipInfo } from './icons.js';
import { placeDetails, placePhotos, reverseGeocode, foursquareEnabled, foursquareMatch } from './api.js';
import { dist, bearing } from './geo.js';
import { fmtDist, fmtDuration } from './format.js';
import { isOpenNow } from './hours.js';
import { savePlace, removePlace, savedKinds } from './saved.js';

const $ = (id) => document.getElementById(id);

const NICE = {
  fuel: 'Gas Station', fast_food: 'Fast Food', ice_cream: 'Ice Cream', clothing_store: 'Clothing Store',
  department_store: 'Department Store', doctors: 'Doctor', atm: 'ATM', lodging: 'Hotel', beer: 'Bar',
  attraction: 'Attraction', parking: 'Parking',
};
const titleCase = (s) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

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

/**
 * @param map       main MapLibre map (for the selection ring)
 * @param feature   rendered POI feature
 * @param ctx       { from: [lng,lat]|null, heading, onWaypoint(coord,name), onGo(coord,name) }
 */
export function openPlace(map, feature, ctx) {
  const p = feature.properties;
  const coord = feature.geometry.coordinates.slice(0, 2);
  const blipId = p.blip || POI_BLIPS[p.class];
  const info = blipInfo(blipId) || { url: '', color: '#d63cff', label: 'Place' };
  const name = p['name:latin'] || p.name || NICE[p.subclass] || titleCase(p.subclass || p.class || 'Place');
  const category = p.catLabel || NICE[p.subclass] || NICE[p.class] || titleCase(p.subclass || p.class || info.label);
  current = { coord, name, cls: p.class || null, ctx, photos: [] };
  const mySeq = ++seq;

  const card = $('place');
  card.style.setProperty('--cat', info.color);
  const avatar = $('place-avatar-img');
  avatar.src = info.url;
  avatar.className = 'is-icon';
  $('place-photo-count').hidden = true;
  $('place-photo-credit').hidden = true;
  $('place-cat').textContent = category;
  $('place-name').textContent = name;
  $('place-badge').hidden = true;

  // one-line description, e.g. "0.4 mi northeast of you · about 2 min by car"
  if (ctx.from) {
    const d = dist(ctx.from, coord);
    const dir = COMPASS[Math.round(bearing(ctx.from, coord) / 45) % 8];
    // rough city-driving estimate: roads ~35% longer than straight line, ~40 km/h average
    $('place-desc').textContent = `${fmtDist(d)} ${dir} of you · about ${fmtDuration((d * 1.35) / 11)} by car`;
  } else {
    $('place-desc').textContent = category;
  }

  $('place-info').innerHTML = '<li class="loading"><span></span><span></span></li>';
  $('place-chips').hidden = true;
  $('place-call').hidden = true;
  $('place-web').hidden = true;
  $('place-save').hidden = true;
  refreshSaved();
  card.hidden = false;
  card.classList.remove('show');
  requestAnimationFrame(() => card.classList.add('show'));

  loadDetails(p.name, coord, mySeq);
}

function loadDetails(name, coord, mySeq) {
  let tags;
  let rev;
  let fsq;
  let pending = foursquareEnabled ? 3 : 2;
  const done = () => {
    pending--;
    if (mySeq === seq) renderDetails(tags || {}, rev, pending > 0, fsq);
  };
  if (foursquareEnabled) foursquareMatch(name, coord).then((r) => (fsq = r), () => {}).finally(done);
  placeDetails(name, coord)
    .then((t) => (tags = t), () => {})
    .finally(() => {
      done();
      loadPhotos(tags, coord, mySeq); // photo links live in the place's tags
    });
  reverseGeocode(coord).then((r) => (rev = r), () => {}).finally(done);
}

function renderDetails(t, rev, stillLoading, fsq) {
  const rows = [];
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  let fromFsq = false; // only credit Foursquare when it actually supplied something shown
  const fsqAddress = fsq?.location?.formatted_address;
  const address = street ? [street, t['addr:city']].filter(Boolean).join(', ') : fsqAddress || rev?.address;
  if (!street && fsqAddress) fromFsq = true;
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
  const osmPhone = t.phone || t['contact:phone'];
  const phone = osmPhone || fsq?.tel;
  if (!osmPhone && fsq?.tel) fromFsq = true;
  if (phone) rows.push(['phone', phone]);
  const osmWeb = t.website || t['contact:website'];
  const web = osmWeb || fsq?.website;
  if (!osmWeb && fsq?.website) fromFsq = true;
  if (web) rows.push(['globe', web.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')]);
  const extra = [t.cuisine && titleCase(t.cuisine.replace(/;/g, ', ')), t.brand || t.operator].filter(Boolean).join(' · ');
  if (extra) rows.push(['tag', extra]);
  if (t.wheelchair === 'yes') rows.push(['access', 'Wheelchair accessible']);
  if (!rows.length && !stillLoading) rows.push(['tag', 'No extra details found for this place yet']);

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
  if (fromFsq && !stillLoading) list.insertAdjacentHTML('beforeend', '<li class="credit">Some details from Foursquare</li>');
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
  // "nearby" photos may show a different building, so they never stand in for the place itself
  if (mySeq !== seq || !photos.length || nearby) return;
  const avatar = $('place-avatar-img');
  const first = photos[0];
  const probe = new Image();
  probe.onload = () => {
    if (mySeq !== seq) return;
    current.photos = photos;
    avatar.src = first.thumb;
    avatar.className = 'is-photo';
    const count = $('place-photo-count');
    count.textContent = photos.length > 1 ? `1/${photos.length}` : '';
    count.hidden = photos.length < 2;
    const credit = $('place-photo-credit');
    credit.textContent = `${nearby ? 'Nearby photo' : 'Photo'}: ${first.credit}`;
    credit.href = first.link;
    credit.hidden = false;
  };
  probe.src = first.thumb;
}

let gallery = { photos: [], i: 0 };
function openViewer(photos, i = 0) {
  gallery = { photos, i };
  showPhoto();
  $('viewer').hidden = false;
}
function showPhoto() {
  const { photos, i } = gallery;
  const ph = photos[i];
  const img = $('viewer-img');
  img.onerror = () => {
    img.onerror = null;
    img.src = ph.fallback || ph.thumb; // larger size not available
  };
  img.src = ph.full;
  $('viewer-credit').textContent = ph.credit;
  $('viewer-credit').href = ph.link;
  $('viewer-count').textContent = photos.length > 1 ? `${i + 1} / ${photos.length}` : '';
  $('viewer-prev').hidden = $('viewer-next').hidden = photos.length < 2;
}
const step = (n) => {
  gallery.i = (gallery.i + n + gallery.photos.length) % gallery.photos.length;
  showPhoto();
};
const closeViewer = () => ($('viewer').hidden = true);
$('viewer-close').onclick = closeViewer;
$('viewer').onclick = (e) => e.target.id === 'viewer' && closeViewer();
$('viewer-prev').onclick = () => step(-1);
$('viewer-next').onclick = () => step(1);
// swipe between photos
let touchX = null;
$('viewer').addEventListener('touchstart', (e) => (touchX = e.touches[0].clientX), { passive: true });
$('viewer').addEventListener('touchend', (e) => {
  if (touchX == null || gallery.photos.length < 2) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
  touchX = null;
});
$('place-avatar').onclick = () => current?.photos.length && openViewer(current.photos, 0);

// ---------------------------------------------------------------- saving
function refreshSaved() {
  const kinds = current ? savedKinds(current) : [];
  $('place-save-btn').classList.toggle('on', kinds.length > 0);
  document.querySelectorAll('#place-save button').forEach((b) => {
    b.classList.toggle('on', kinds.includes(b.dataset.kind));
    if (b.dataset.kind === 'remove') b.hidden = !kinds.length;
  });
}
$('place-save-btn').onclick = () => {
  $('place-save').hidden = !$('place-save').hidden;
  refreshSaved();
};
$('place-save').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b || !current) return;
  const kind = b.dataset.kind;
  const place = { name: current.name, coord: current.coord, cls: current.cls };
  if (kind === 'remove') removePlace(place);
  else savePlace(kind, place);
  refreshSaved();
  current.ctx.onSaved?.(kind === 'remove' ? `Removed ${current.name}` : `Saved ${current.name} as ${kind === 'favorite' ? 'a favorite' : kind[0].toUpperCase() + kind.slice(1)}`);
};

export function closePlace() {
  seq++;
  const closing = current;
  current = null;
  const card = $('place');
  card.classList.remove('show');
  setTimeout(() => !current && (card.hidden = true), 220);
  closing?.ctx.onClose?.();
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
