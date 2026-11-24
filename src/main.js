import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { buildStyle } from './style.js';
import { addMissingImage, legendItems } from './icons.js';
import { searchPlaces, searchFoursquare, mergeResults, getRoute, reverseGeocode } from './api.js';
import { dist, bearing, cumulative, snap, pointAt, lerpAngle, angleDiff } from './geo.js';
import { fmtDist, fmtDuration, fmtClock, fmtSpeed, speedUnit, turnAngle } from './format.js';
import { compassHeading, enableCompass, compassBlocked, setKeepAwake } from './sensors.js';
import { openPlace, closePlace, placeOpen } from './place.js';

// Native GPS that keeps running with the screen off / app in background (used while navigating).
const BgGeo = registerPlugin('BackgroundGeolocation');
const NATIVE = Capacitor.isNativePlatform();

const $ = (id) => document.getElementById(id);
const DEFAULT_POS = [-80.1918, 25.7617]; // Miami, used when location is unavailable
const LAST_KEY = 'neonnav:lastpos';
const EMPTY = { type: 'FeatureCollection', features: [] };
const DRIVE_PITCH = 60;
const SIM_SPEED = 17; // m/s for demo drive

const state = {
  pos: null,          // displayed (smoothed) position
  heading: 0,         // displayed heading (where the arrow points)
  camBearing: 0,      // map/radar rotation; follows heading only while moving
  target: null,       // latest true position
  targetHeading: 0,
  speed: 0,
  zoom: 16.5,
  mode: 'drive',      // 'drive' | 'map'
  follow: true,
  navigating: false,
  dest: null,         // { coord, name }
  route: null,
  sim: null,          // { along }
  lastRealFix: null,
  fallback: false,
  offRouteCount: 0,
  lastReroute: 0,
  lastNavUpdate: 0,
  lastTrim: 0,
  nextStepAlong: Infinity,
  currentRoad: '',
  street: { t: 0, pos: null },
  transitionUntil: 0,
  lastDestAt: 0,
  needsRender: true,
};

// ---------------------------------------------------------------- maps
const START = loadLastPos();
const map = new maplibregl.Map({
  container: 'map',
  style: buildStyle(),
  center: START || [0, 20],
  zoom: START ? 14 : 1.5,
  attributionControl: false,
  maxPitch: 70,
});
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-right');
// start with the attribution collapsed to the (i) button so it doesn't cover the HUD
map.once('load', () => document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));

const radar = new maplibregl.Map({
  container: 'radar',
  style: buildStyle({ radar: true }),
  center: START || DEFAULT_POS,
  zoom: 15,
  pitch: 35,
  interactive: false,
  attributionControl: false,
});

const maps = [map, radar];
if (import.meta.env.DEV || location.search.includes('debug')) window.neonnav = { map, radar, state };
for (const m of maps) {
  m.on('styleimagemissing', (e) => addMissingImage(m, e.id));
  m.on('load', () => {
    const r = state.route;
    setSource(m, 'route', lineData(r ? r.remaining || r.coords : null));
  });
}

function setSource(m, id, data) {
  m.getSource(id)?.setData(data);
}
function setRouteLine(coords) {
  maps.forEach((m) => setSource(m, 'route', lineData(coords)));
}
function lineData(coords) {
  return coords && coords.length > 1
    ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }
    : EMPTY;
}

// ---------------------------------------------------------------- markers
const PLAYER_SVG = '<div class="beam"></div><svg viewBox="0 0 64 64"><path d="M32 5 55 57 32 45 9 57z" fill="#fff" stroke="#0b0d10" stroke-width="5" stroke-linejoin="round"/></svg>';
const DEST_SVG = '<svg viewBox="0 0 34 44"><path d="M17 42C17 42 3 26 3 16a14 14 0 0 1 28 0c0 10-14 26-14 26z" fill="#ffcc00" stroke="#0b0d10" stroke-width="3"/><circle cx="17" cy="16" r="5" fill="#0b0d10"/></svg>';

function el(cls, html) {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  return d;
}

const playerMarkers = [
  new maplibregl.Marker({ element: el('player', PLAYER_SVG), rotationAlignment: 'map', pitchAlignment: 'map' }),
  new maplibregl.Marker({ element: el('player small', PLAYER_SVG), rotationAlignment: 'map', pitchAlignment: 'map' }),
];
const destMarkers = [
  new maplibregl.Marker({ element: el('dest', DEST_SVG), anchor: 'bottom' }),
  new maplibregl.Marker({ element: el('dest small', DEST_SVG), anchor: 'bottom' }),
];

// ---------------------------------------------------------------- location
function onFix(coord, heading, speed) {
  state.lastFixAt = Date.now();
  state.target = coord;
  state.targetHeading = heading;
  state.speed = speed;
  if (!state.pos || dist(state.pos, coord) > 500) {
    const first = !state.pos;
    state.pos = [...coord];
    state.heading = heading;
    playerMarkers.forEach((mk, i) => mk.setLngLat(coord).addTo(maps[i]));
    if (first) enterDrive();
  }
  state.needsRender = true;
  updateNav();
  updateStreet();
}

// Last known position is remembered so the map opens where you were, not on a default city.
function loadLastPos() {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY));
    if (Array.isArray(v) && v.length === 2 && v.every(Number.isFinite)) return v;
  } catch { /* storage unavailable */ }
  return null;
}
let lastSave = 0;
function saveLastPos(c) {
  if (Date.now() - lastSave < 30000) return;
  lastSave = Date.now();
  try { localStorage.setItem(LAST_KEY, JSON.stringify(c.map((n) => +n.toFixed(5)))); } catch { /* ignore */ }
}

let watchId = null;
let slowTimer = null;

async function startLocation() {
  $('street-text').textContent = 'Locating…';
  if (!Capacitor.isNativePlatform() && !window.isSecureContext) return useFallback('insecure');
  if (Capacitor.isNativePlatform()) {
    try {
      let perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted') perm = await Geolocation.requestPermissions();
      if (perm.location === 'denied') return useFallback('denied');
    } catch {
      return useFallback('services-off'); // Android throws when Location is switched off
    }
  }

  // 1) quick coarse fix (cached / network) so the map snaps to you right away
  Geolocation.getCurrentPosition({ enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 8000 })
    .then((p) => !state.lastRealFix && handlePosition(p))
    .catch(() => {});

  // 2) continuous high-accuracy GPS
  if (NATIVE) {
    startNativeWatch(state.navigating);
  } else try {
    if (watchId) await Geolocation.clearWatch({ id: watchId });
    watchId = await Geolocation.watchPosition({ enableHighAccuracy: true, timeout: 30000, maximumAge: 3000 }, (p, err) => {
      if (p) handlePosition(p);
      else handleLocationError(err);
    });
  } catch (e) {
    handleLocationError(e);
  }

  clearTimeout(slowTimer);
  slowTimer = setTimeout(() => !state.lastRealFix && useFallback('slow'), 12000);
}

// Native watcher. With `background` on, Android shows a "navigating" notification and iOS keeps
// GPS running when the screen is off or you switch apps.
let bgWatcherId = null;
let bgWatcherMode = null;
async function startNativeWatch(background) {
  if (bgWatcherId && bgWatcherMode === background) return;
  const old = bgWatcherId;
  bgWatcherMode = background;
  try {
    bgWatcherId = await BgGeo.addWatcher(
      {
        ...(background && {
          backgroundTitle: 'NeonNav is navigating',
          backgroundMessage: 'Tap to return to your route.',
        }),
        requestPermissions: true,
        stale: false,
        distanceFilter: 0,
      },
      (loc, err) => {
        if (err) {
          if (err.code === 'NOT_AUTHORIZED') handleLocationError({ code: 1 });
          return;
        }
        if (loc) handlePosition({ coords: { longitude: loc.longitude, latitude: loc.latitude, speed: loc.speed, heading: loc.bearing } });
      },
    );
  } catch (e) {
    handleLocationError(e);
  }
  if (old) BgGeo.removeWatcher({ id: old }).catch(() => {});
}

function handlePosition(p) {
  const c = [p.coords.longitude, p.coords.latitude];
  const time = p.timestamp || Date.now();
  const prev = state.lastRealFix;
  const movedM = prev ? dist(prev.coord, c) : 0;

  // Speed: use the GPS value; if the phone doesn't give one (common on iPhone), estimate it
  // from consecutive fixes, ignoring jumps caused by low-accuracy readings.
  let spd = p.coords.speed;
  if (spd == null || !Number.isFinite(spd) || spd < 0) {
    const dt = prev ? (time - prev.time) / 1000 : 0;
    const accurate = (p.coords.accuracy ?? 0) <= 50;
    spd = accurate && dt > 0.5 && dt < 10 ? movedM / dt : 0;
    if (spd > 70) spd = 0;
  }

  // Heading: GPS course while moving; the compass when standing still or walking slowly.
  let h = p.coords.heading;
  const gpsHeadingOk = h != null && Number.isFinite(h) && h >= 0;
  const travelBearing = movedM > 4 ? bearing(prev.coord, c) : state.targetHeading;
  if (spd >= 2.5) {
    if (!gpsHeadingOk) h = travelBearing;
  } else {
    h = compassHeading() ?? travelBearing;
  }
  state.lastRealFix = { coord: c, heading: h, time };
  saveLastPos(c);
  if (state.fallback) {
    state.fallback = false;
    state.pos = null; // jump from the approximate spot to the real one
    $('btn-center').hidden = state.mode === 'drive' && state.follow;
    toast('Location found', 1500);
  }
  if (!state.sim) onFix(c, h, spd);
}

function handleLocationError(err) {
  if (state.lastRealFix) return;
  const msg = String(err?.message || '').toLowerCase();
  if (err?.code === 1 || msg.includes('denied')) useFallback('denied');
  else if (msg.includes('disabled') || msg.includes('not enabled') || msg.includes('services')) useFallback('services-off');
  // timeouts / temporarily unavailable: keep waiting; the slow timer covers it
}

const FALLBACK_MSG = {
  insecure: 'Location needs a secure connection. Open the app over https:// or on localhost.',
  denied: 'Location access is blocked. Allow it in your browser or phone settings, then tap the arrow button.',
  'services-off': 'Location services are off. Turn them on, then tap the arrow button.',
  slow: 'Still waiting for GPS… showing your approximate area for now.',
};

async function useFallback(reason) {
  if (state.lastRealFix) return;
  toast(FALLBACK_MSG[reason], 6000);
  $('btn-center').hidden = false;
  if (state.fallback) return;
  state.fallback = true;
  const c = await approximatePosition();
  if (state.lastRealFix) return;
  $('street-text').textContent = 'Approximate location';
  onFix(c, 0, 0);
}

// Last saved position, else a rough city-level guess from the IP address, else Miami.
async function approximatePosition() {
  const last = loadLastPos();
  if (last) return last;
  try {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 5000);
    const j = await (await fetch('https://get.geojs.io/v1/ip/geo.json', { signal: ctl.signal })).json();
    const c = [Number(j.longitude), Number(j.latitude)];
    if (c.every(Number.isFinite)) return c;
  } catch { /* offline or blocked */ }
  return DEFAULT_POS;
}

// ---------------------------------------------------------------- render loop
let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (state.sim) stepSim(dt);
  // if fixes stop arriving (some phones only report on change), treat it as stopped
  else if (Date.now() - (state.lastFixAt || 0) > 4000) state.speed = 0;
  if (!state.sim && state.speed < 2.5) {
    const ch = compassHeading(); // standing still or walking: point where the phone points
    if (ch != null) state.targetHeading = ch;
  }

  if (state.target && state.pos) {
    const k = state.sim ? 1 : 1 - Math.exp(-dt * 3.5);
    const nx = state.pos[0] + (state.target[0] - state.pos[0]) * k;
    const ny = state.pos[1] + (state.target[1] - state.pos[1]) * k;
    const nh = lerpAngle(state.heading, state.targetHeading, 1 - Math.exp(-dt * (state.sim ? 6 : 4)));
    const tz = targetZoom();
    const nz = state.zoom + (tz - state.zoom) * (1 - Math.exp(-dt * 1.5));
    // Like Google Maps: while moving the map turns to face your direction of travel;
    // when you stop, the map holds still and only the arrow turns with the phone.
    const moving = state.sim || state.speed >= 2.5;
    const nb = moving ? lerpAngle(state.camBearing, nh, 1 - Math.exp(-dt * 2.5)) : state.camBearing;
    const moved =
      Math.abs(nx - state.pos[0]) + Math.abs(ny - state.pos[1]) > 1e-9 ||
      Math.abs(angleDiff(state.heading, nh)) > 0.02 ||
      Math.abs(angleDiff(state.camBearing, nb)) > 0.02 ||
      Math.abs(nz - state.zoom) > 0.002;
    state.pos = [nx, ny];
    state.heading = nh;
    state.camBearing = nb;
    state.zoom = nz;
    if (moved || state.needsRender) render(now);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function targetZoom() {
  const kmh = state.speed * 3.6;
  return kmh > 90 ? 15.2 : kmh > 50 ? 15.9 : 16.6;
}

function render(now) {
  state.needsRender = false;
  playerMarkers.forEach((mk) => mk.setLngLat(state.pos).setRotation(state.heading));
  radar.jumpTo({ center: state.pos, bearing: state.camBearing, zoom: state.zoom - 1.6 });
  if (state.mode === 'drive' && state.follow && now > state.transitionUntil) {
    map.jumpTo({ center: state.pos, bearing: state.camBearing, pitch: DRIVE_PITCH, zoom: state.zoom });
  }
  updateRadarOverlay();
  $('speed-val').textContent = fmtSpeed(state.speed);
}

function updateRadarOverlay() {
  const size = $('radar-wrap').clientWidth;
  const r = size / 2;
  const n = -state.camBearing;
  $('radar-n').style.transform = `rotate(${n}deg) translateY(${-(r - 13)}px) rotate(${-n}deg)`;

  const edge = $('radar-edge');
  if (!state.dest) return (edge.hidden = true);
  const p = radar.project(state.dest.coord);
  const dx = p.x - r;
  const dy = p.y - r;
  if (Math.hypot(dx, dy) < r - 12) return (edge.hidden = true);
  const a = (Math.atan2(dx, -dy) * 180) / Math.PI;
  edge.hidden = false;
  edge.style.transform = `rotate(${a}deg) translateY(${-(r - 10)}px) rotate(${-a}deg) rotate(45deg)`;
}

// ---------------------------------------------------------------- modes
function drivePadding() {
  return { top: Math.round(window.innerHeight * 0.24), bottom: 0, left: 0, right: 0 };
}

function updateAwake() {
  setKeepAwake(state.mode === 'drive' || state.navigating);
}

function enterDrive(instant = false) {
  state.mode = 'drive';
  updateAwake();
  state.follow = true;
  document.body.classList.replace('mode-map', 'mode-drive');
  $('btn-center').hidden = !state.fallback;
  if (!state.pos) return;
  const cam = { center: state.pos, bearing: state.camBearing, pitch: DRIVE_PITCH, zoom: state.zoom, padding: drivePadding() };
  if (instant) {
    map.jumpTo(cam);
  } else {
    state.transitionUntil = performance.now() + 900;
    map.easeTo({ ...cam, duration: 900 });
  }
  setTimeout(() => radar.resize(), 0);
  state.needsRender = true;
}

function enterMap() {
  state.mode = 'map';
  state.camBearing = 0;
  updateAwake();
  state.follow = false;
  document.body.classList.replace('mode-drive', 'mode-map');
  $('btn-center').hidden = false;
  const padding = { top: 90, bottom: 200, left: 40, right: 40 };
  if (state.route) {
    fitRoute(padding);
  } else {
    map.easeTo({ center: state.pos || map.getCenter(), zoom: 14.5, pitch: 0, bearing: 0, padding, duration: 900 });
  }
}

function fitRoute(padding = { top: 100, bottom: 260, left: 50, right: 50 }) {
  const b = new maplibregl.LngLatBounds();
  state.route.coords.forEach((c) => b.extend(c));
  map.fitBounds(b, { padding, pitch: 0, bearing: 0, duration: 900, maxZoom: 16 });
}

$('btn-mode').onclick = () => (state.mode === 'drive' ? enterMap() : enterDrive());
$('btn-center').onclick = () => {
  if (!state.lastRealFix) startLocation();
  if (state.mode === 'map') {
    map.easeTo({ center: state.pos || DEFAULT_POS, zoom: 15, duration: 700 });
  } else {
    enterDrive();
  }
};

const stopFollow = (e) => {
  if (!e.originalEvent || state.mode !== 'drive' || !state.follow) return;
  state.follow = false;
  $('btn-center').hidden = false;
};
let resumeTimer = null;
map.on('moveend', (e) => {
  if (!e.originalEvent || state.mode !== 'drive' || state.follow || !state.navigating) return;
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => {
    if (state.mode === 'drive' && !state.follow && state.navigating && !placeOpen()) enterDrive();
  }, 10000);
});
map.on('dragstart', stopFollow);
map.on('rotatestart', stopFollow);
map.on('pitchstart', stopFollow);

window.addEventListener('resize', () => {
  if (state.mode === 'drive') map.setPadding(drivePadding());
});

// ---------------------------------------------------------------- waypoint input
function pickPoi(pt) {
  const r = 14; // generous hit area for fingers
  return map.queryRenderedFeatures([[pt.x - r, pt.y - r], [pt.x + r, pt.y + r]], { layers: ['poi-blips'] })[0];
}
map.on('click', (e) => {
  const poi = pickPoi(e.point);
  if (poi) return showPlace(poi);
  if (placeOpen()) return closePlace();
  if (state.mode === 'map') setDestination([e.lngLat.lng, e.lngLat.lat]);
});
map.on('mouseenter', 'poi-blips', () => (map.getCanvas().style.cursor = 'pointer'));
map.on('mouseleave', 'poi-blips', () => (map.getCanvas().style.cursor = ''));

function showPlace(feature) {
  openPlace(map, feature, {
    from: state.target,
    heading: map.getBearing(), // direction arrow is relative to the screen
    onWaypoint: (coord, name) => setDestination(coord, name, true),
    onGo: async (coord, name) => {
      if (await setDestination(coord, name, true)) startNav();
    },
  });
}
map.on('contextmenu', (e) => setDestination([e.lngLat.lng, e.lngLat.lat]));

let lp = null;
map.on('touchstart', (e) => {
  clearTimeout(lp?.timer);
  if (e.points.length !== 1) return (lp = null);
  const ll = e.lngLat;
  lp = { start: e.point, timer: setTimeout(() => {
    navigator.vibrate?.(30);
    setDestination([ll.lng, ll.lat]);
  }, 600) };
});
map.on('touchmove', (e) => {
  if (lp && Math.hypot(e.point.x - lp.start.x, e.point.y - lp.start.y) > 10) clearTimeout(lp.timer);
});
['touchend', 'touchcancel'].forEach((t) => map.on(t, () => clearTimeout(lp?.timer)));

// ---------------------------------------------------------------- search
const q = $('q');
const results = $('results');
let searchTimer = null;
let searchSeq = 0;

q.addEventListener('input', () => {
  $('q-clear').hidden = !q.value;
  clearTimeout(searchTimer);
  if (q.value.trim().length < 3) return (results.hidden = true);
  searchTimer = setTimeout(runSearch, 350);
});
q.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    clearTimeout(searchTimer);
    runSearch(true);
  }
});
$('q-clear').onclick = () => {
  q.value = '';
  $('q-clear').hidden = true;
  results.hidden = true;
  q.focus();
};

async function runSearch(pickFirst = false) {
  const text = q.value.trim();
  if (!text) return;
  const seq = ++searchSeq;
  const near = state.target || map.getCenter().toArray();
  // OpenStreetMap (Photon) and Foursquare in parallel; either can fail without breaking search
  const [osm, fsq] = await Promise.allSettled([searchPlaces(text, near), searchFoursquare(text, near)]);
  const osmItems = osm.status === 'fulfilled' ? osm.value : [];
  const fsqItems = fsq.status === 'fulfilled' ? fsq.value : [];
  let items = mergeResults(fsqItems, osmItems);
  if (!items.length && osm.status === 'rejected' && fsq.status === 'rejected') items = null;
  if (seq !== searchSeq) return;
  if (pickFirst && items?.length) return choose(items[0]);
  results.innerHTML = '';
  if (!items || !items.length) {
    results.innerHTML = `<li class="r-empty">${items ? 'No results' : 'Search unavailable, check your connection'}</li>`;
  }
  for (const it of items || []) {
    const li = document.createElement('li');
    li.tabIndex = 0;
    li.innerHTML = '<div class="r-name"></div><div class="r-sub"></div>';
    li.firstChild.textContent = it.name;
    li.lastChild.textContent = it.sub;
    li.onclick = () => choose(it);
    results.appendChild(li);
  }
  if (items?.some((it) => it.source === 'foursquare')) {
    results.insertAdjacentHTML('beforeend', '<li class="r-credit">Business results powered by Foursquare</li>');
  }
  results.hidden = false;
}

function choose(item) {
  results.hidden = true;
  q.value = item.name;
  q.blur();
  setDestination(item.coord, item.name);
}

// ---------------------------------------------------------------- routing
async function setDestination(coord, name, fromButton = false) {
  const now = Date.now();
  if (!fromButton && now - state.lastDestAt < 800) return false; // long-press + contextmenu can both fire
  closePlace();
  state.lastDestAt = now;
  stopSim();
  state.navigating = false;
  setNavLayout(false);
  state.dest = { coord, name: name || 'Waypoint' };
  destMarkers.forEach((mk, i) => mk.setLngLat(coord).addTo(maps[i]));
  showSheet();
  $('dest-meta').textContent = 'Finding route…';
  if (!name) {
    reverseGeocode(coord).then((r) => {
      if (r?.name && state.dest?.coord === coord) {
        state.dest.name = r.name;
        $('dest-name').textContent = r.name;
      }
    }).catch(() => {});
  }
  const ok = await computeRoute();
  if (ok && state.dest?.coord === coord) {
    if (state.mode === 'drive') enterMap();
    else fitRoute();
  }
  return ok;
}

async function computeRoute(isReroute = false) {
  const from = state.target;
  if (!state.dest) return false;
  if (!from) {
    $('dest-meta').textContent = 'Waiting for your location…';
    return false;
  }
  state.lastReroute = Date.now();
  const destRef = state.dest;
  try {
    const r = await getRoute(from, destRef.coord);
    if (state.dest !== destRef) return false;
    r.cum = cumulative(r.coords);
    let fromIdx = 0;
    for (const st of r.steps) {
      const s = snap(r.coords, r.cum, st.location, fromIdx);
      st.along = s.along;
      fromIdx = s.index;
    }
    r.avgSpeed = r.distance / Math.max(1, r.duration);
    r.remaining = null;
    state.route = r;
    state.offRouteCount = 0;
    setRouteLine(r.coords);
    updateNav(true);
    if (isReroute) toast('Rerouting…', 1500);
    return true;
  } catch (e) {
    if (!isReroute) $('dest-meta').textContent = e.message || 'No route found';
    return false;
  }
}

function updateNav(force = false) {
  const r = state.route;
  if (!r || !state.target) return;
  const now = performance.now();
  if (!force && state.sim && now - state.lastNavUpdate < 200) return;
  state.lastNavUpdate = now;

  const s = snap(r.coords, r.cum, state.target);
  const total = r.cum[r.cum.length - 1];
  const remaining = Math.max(0, total - s.along);

  if (state.navigating && !state.sim) {
    if (s.offset > 45) state.offRouteCount++;
    else state.offRouteCount = 0;
    if (state.offRouteCount >= 3 && Date.now() - state.lastReroute > 10000) computeRoute(true);
  }
  if (state.navigating && remaining < 25) return arrive();

  let current = null;
  let next = null;
  for (const st of r.steps) {
    if (st.along <= s.along + 3) current = st;
    else { next = st; break; }
  }
  next = next || r.steps[r.steps.length - 1];
  state.currentRoad = current?.name || '';
  state.nextStepAlong = next.along;

  const secs = remaining / r.avgSpeed;
  $('dest-meta').innerHTML = `<b>${fmtDuration(secs)}</b> · ${fmtDist(remaining)} · ETA ${fmtClock(Date.now() + secs * 1000)}`;

  if (state.navigating) {
    if (state.currentRoad) $('street-text').textContent = state.currentRoad;
    $('turn-dist').textContent = fmtDist(Math.max(0, next.along - s.along));
    $('turn-text').textContent = next.text;
    const arrow = $('turn-arrow').firstElementChild;
    arrow.style.transform = next.type === 'arrive' ? 'rotate(0deg) scale(0.8)' : `rotate(${turnAngle(next)}deg)`;
    if (now - state.lastTrim > 300) {
      state.lastTrim = now;
      r.remaining = [s.point, ...r.coords.slice(s.index + 1)];
      setRouteLine(r.remaining);
    }
  }
}

function startNav() {
  if (!state.route) return;
  state.navigating = true;
  setNavLayout(true);
  closePlace();
  if (NATIVE) startNativeWatch(true);
  updateAwake();
  $('search').hidden = true;
  results.hidden = true;
  $('turn').hidden = false;
  $('btn-go').hidden = true;
  updateNav(true);
  enterDrive();
}

function arrive() {
  toast(`You have arrived at ${state.dest?.name || 'your destination'}`, 4000);
  clearRoute();
}

function clearRoute() {
  stopSim();
  state.route = null;
  state.dest = null;
  state.navigating = false;
  setNavLayout(false);
  if (NATIVE) startNativeWatch(false);
  updateAwake();
  state.nextStepAlong = Infinity;
  state.currentRoad = '';
  destMarkers.forEach((mk) => mk.remove());
  setRouteLine(null);
  $('sheet').hidden = true;
  $('turn').hidden = true;
  $('search').hidden = false;
  q.value = '';
  $('q-clear').hidden = true;
  state.needsRender = true;
}

// While navigating, the trip card sits compactly under the turn card so the map stays clear.
function setNavLayout(on) {
  document.body.classList.toggle('nav', on);
  if (on) $('top').appendChild($('sheet'));
  else $('bottom').prepend($('sheet'));
}

function showSheet() {
  $('sheet').hidden = false;
  $('dest-name').textContent = state.dest.name;
  $('btn-go').hidden = false;
  $('btn-demo').textContent = 'Demo drive';
  $('turn').hidden = true;
  $('search').hidden = false;
}

$('btn-go').onclick = startNav;
$('btn-cancel').onclick = clearRoute;
$('btn-demo').onclick = () => (state.sim ? stopSim() : startSim());

// ---------------------------------------------------------------- demo drive
function startSim() {
  if (!state.route) return;
  if (!state.navigating) startNav();
  const r = state.route;
  state.sim = { along: snap(r.coords, r.cum, state.target).along };
  $('btn-demo').textContent = 'Stop demo';
}

function stopSim() {
  if (!state.sim) return;
  state.sim = null;
  $('btn-demo').textContent = 'Demo drive';
  state.speed = 0;
  if (state.lastRealFix && !state.fallback) {
    state.target = state.lastRealFix.coord;
    state.targetHeading = state.lastRealFix.heading;
    updateNav(true);
  }
}

function stepSim(dt) {
  const r = state.route;
  if (!r) return stopSim();
  const toTurn = state.nextStepAlong - state.sim.along;
  const speed = toTurn < 60 && toTurn > 0 ? SIM_SPEED * 0.5 : SIM_SPEED;
  state.sim.along += speed * dt;
  const here = pointAt(r.coords, r.cum, state.sim.along);
  const ahead = pointAt(r.coords, r.cum, state.sim.along + 20);
  state.target = here.point;
  state.speed = speed;
  if (dist(here.point, ahead.point) > 1) state.targetHeading = bearing(here.point, ahead.point);
  updateNav();
}

// ---------------------------------------------------------------- street name
async function updateStreet() {
  if (state.navigating && state.currentRoad) {
    $('street-text').textContent = state.currentRoad;
    return;
  }
  const now = Date.now();
  const last = state.street;
  if (now - last.t < 20000 && last.pos && dist(last.pos, state.target) < 60) return;
  last.t = now;
  last.pos = state.target;
  try {
    const r = await reverseGeocode(state.target);
    if (r?.street && !(state.navigating && state.currentRoad)) $('street-text').textContent = r.street;
  } catch {
    /* offline: keep previous label */
  }
}

// ---------------------------------------------------------------- misc UI
let toastTimer = null;
function toast(msg, ms = 2500) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

$('speed-unit').textContent = speedUnit;
$('legend-list').innerHTML = legendItems()
  .map((i) => `<li><img src="${i.url}" alt="">${i.label}</li>`)
  .join('');

if (!Capacitor.isNativePlatform() && 'serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Compass: works straight away on Android/desktop. iOS Safari only shows its
// "Motion & Orientation" prompt in response to a completed tap (touchend/click), so we
// ask on the first tap, and offer a compass button on phones if that didn't happen.
enableCompass().then(refreshCompassUi);
const onFirstGesture = async () => {
  const ok = await enableCompass({ fromGesture: true });
  updateAwake(); // some browsers only grant the screen wake lock after a tap
  refreshCompassUi();
  if (ok) {
    window.removeEventListener('touchend', onFirstGesture);
    window.removeEventListener('click', onFirstGesture);
  }
};
window.addEventListener('touchend', onFirstGesture);
window.addEventListener('click', onFirstGesture);

const isPhone = matchMedia('(pointer: coarse)').matches;
function refreshCompassUi() {
  const active = compassHeading(5000) != null;
  document.body.classList.toggle('has-compass', active);
  $('btn-compass').hidden = active || !isPhone;
}
setInterval(refreshCompassUi, 2000);
$('btn-compass').onclick = async () => {
  const ok = await enableCompass({ fromGesture: true });
  setTimeout(refreshCompassUi, 600);
  if (!ok && compassBlocked()) {
    toast('Compass access was denied. Close the tab, reopen the site, and tap Allow when Safari asks about Motion & Orientation.', 7000);
  } else if (!ok) {
    toast('No compass found on this device.', 3000);
  }
};

startLocation();
updateAwake();
