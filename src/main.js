import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { buildStyle, COLORS } from './style.js';
import { addMissingImage, legendItems, blipInfo, PIN_SIZE } from './icons.js';
import { searchPlaces, searchFoursquare, mergeResults, getRoute, reverseGeocode } from './api.js';
import { dist, bearing, cumulative, snap, pointAt, lerpAngle, angleDiff } from './geo.js';
import { fmtDist, fmtDuration, fmtClock, fmtSpeed, speedUnit, turnAngle, IMPERIAL } from './format.js';
import { compassHeading, enableCompass, compassBlocked, setKeepAwake } from './sensors.js';
import { openPlace, closePlace, placeOpen } from './place.js';
import { initQuickFind, closeQuickFind, quickFindOpen, setQuickFindVisible } from './quickfind.js';
import { getSaved, onSavedChange, getRecents, addRecent } from './saved.js';
import { speak, stop as stopSpeech, isMuted, setMuted, spokenDistance } from './voice.js';
import { routeLimits, limitAt, trackLimit } from './speedlimit.js';

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
    applyRouteFade(m, r ? r.remaining || r.coords : null);
  });
}

function setSource(m, id, data) {
  m.getSource(id)?.setData(data);
}
function setRouteLine(coords) {
  maps.forEach((m) => {
    setSource(m, 'route', lineData(coords));
    applyRouteFade(m, coords);
  });
}

// The route starts at the player, so line-progress 0 is right at the arrow. Fade the first
// ~130 m in from transparent; the fraction is recomputed as the remaining route gets shorter.
const ROUTE_FADE_M = 130;
function routeGradient(color, coords) {
  const len = coords && coords.length > 1 ? cumulative(coords).at(-1) : 0;
  const f = len > 0 ? Math.min(0.9, Math.max(0.001, ROUTE_FADE_M / len)) : 0.5;
  const rgb = color.match(/\w\w/g).map((h) => parseInt(h, 16)).join(',');
  return ['interpolate', ['linear'], ['line-progress'], 0, `rgba(${rgb},0)`, f, `rgba(${rgb},1)`, 1, `rgba(${rgb},1)`];
}
function applyRouteFade(m, coords) {
  if (!m.getLayer('route-line')) return;
  m.setPaintProperty('route-line', 'line-gradient', routeGradient(COLORS.route, coords));
  m.setPaintProperty('route-casing', 'line-gradient', routeGradient(COLORS.routeEdge, coords));
}
function lineData(coords) {
  return coords && coords.length > 1
    ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }
    : EMPTY;
}

// ---------------------------------------------------------------- markers
const PLAYER_SVG = '<div class="beam"></div><svg viewBox="0 0 64 64"><path d="M32 5 55 57 32 45 9 57z" fill="#fff" stroke="#0b0d10" stroke-width="5" stroke-linejoin="round"/></svg>';
const DEST_SVG = '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="#ff5fb4" stroke="#0b0d10" stroke-width="3.5"/></svg>';

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
  new maplibregl.Marker({ element: el('dest', DEST_SVG), anchor: 'center' }),
  new maplibregl.Marker({ element: el('dest small', DEST_SVG), anchor: 'center' }),
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
  trackSpeedLimit(c);
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
  updateLimit(now);
}

// Speed limit sign: from the route's profile while navigating, otherwise from a periodic lookup
// of the road you're on. Hidden where OpenStreetMap has no limit.
function updateLimit(now) {
  // compare speed every frame; look the limit up at most once a second
  if (state.limitVal) $('speed').classList.toggle('over', fmtSpeed(state.speed) > state.limitVal + (IMPERIAL ? 3 : 5));
  if (now - (state.lastLimitAt || 0) < 1000) return;
  state.lastLimitAt = now;
  let kmh = null;
  if (state.route?.limits) kmh = limitAt(state.route.limits, state.target);
  else if (state.freeLimit && Date.now() - state.freeLimit.t < 45000 && dist(state.freeLimit.pos, state.target) < 500) kmh = state.freeLimit.kmh;
  const sign = $('limit');
  if (!kmh) {
    state.limitVal = null;
    sign.hidden = true;
    $('speed').classList.remove('over');
    return;
  }
  const limit = IMPERIAL ? Math.round(kmh / 1.609344 / 5) * 5 : Math.round(kmh);
  state.limitVal = limit;
  $('limit-val').textContent = limit;
  sign.hidden = false;
}

function trackSpeedLimit(coord) {
  const t = (state.track ||= []);
  if (!t.length || dist(t[t.length - 1], coord) > 10) t.push(coord);
  if (t.length > 8) t.shift();
  if (state.route || state.speed < 4 || t.length < 3) return;
  if (Date.now() - (state.lastFreeLookup || 0) < 15000) return;
  state.lastFreeLookup = Date.now();
  trackLimit(t.slice(-6))
    .then((kmh) => (state.freeLimit = { kmh, t: Date.now(), pos: coord }))
    .catch(() => {});
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
  edge.style.transform = `rotate(${a}deg) translateY(${-(r - 10)}px) rotate(${-a}deg)`;
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
  if (quickFindOpen()) return closeQuickFind();
  if (state.mode === 'map') setDestination([e.lngLat.lng, e.lngLat.lat]);
});
map.on('mouseenter', 'poi-blips', () => (map.getCanvas().style.cursor = 'pointer'));
map.on('mouseleave', 'poi-blips', () => (map.getCanvas().style.cursor = ''));

function showPlace(feature) {
  // the quick-find list hides behind the card and comes back when the card closes
  if (quickFindOpen()) setQuickFindVisible(false);
  openPlace(map, feature, {
    from: state.target,
    heading: map.getBearing(),
    onWaypoint: (coord, name) => setDestination(coord, name, true),
    onGo: async (coord, name) => {
      if (await setDestination(coord, name, true)) startNav();
    },
    onSaved: (msg) => toast(msg, 2000),
    onClose: () => quickFindOpen() && setQuickFindVisible(true),
  });
}

/** Open the details card for a list item (quick find, saved place, recent search). */
function openItem(item) {
  showPlace({
    properties: { name: item.name, class: item.cls || null, blip: item.blip, catLabel: item.fsq?.categories?.[0]?.name },
    geometry: { coordinates: item.coord },
  });
  map.easeTo({ center: item.coord, duration: 600 });
}

// ---------------------------------------------------------------- quick find + saved places
initQuickFind(map, {
  getPos: () => state.target,
  openItem,
  showArea: (coords) => {
    if (state.mode === 'drive') enterMap();
    const b = new maplibregl.LngLatBounds();
    coords.forEach((c) => b.extend(c));
    const panel = Math.round(window.innerHeight * 0.45);
    map.fitBounds(b, { padding: { top: 100, bottom: panel, left: 80, right: 40 }, maxZoom: 16, pitch: 0, bearing: 0, duration: 800 });
  },
});

let savedPins = [];
function renderSavedPins() {
  savedPins.forEach((m) => m.remove());
  savedPins = [];
  const s = getSaved();
  const all = [
    s.home && { ...s.home, blip: 'blip-home' },
    s.work && { ...s.work, blip: 'blip-work' },
    ...s.favorites.map((f) => ({ ...f, blip: 'blip-fav' })),
  ].filter(Boolean);
  for (const p of all) {
    const img = document.createElement('img');
    img.src = blipInfo(p.blip).url;
    img.className = 'qf-pin';
    img.style.width = `${PIN_SIZE.width * 0.8}px`;
    img.style.height = `${PIN_SIZE.height * 0.8}px`;
    img.onclick = (e) => {
      e.stopPropagation();
      openItem(p);
    };
    savedPins.push(new maplibregl.Marker({ element: img, anchor: 'bottom' }).setLngLat(p.coord).addTo(map));
  }
}
onSavedChange(renderSavedPins);
renderSavedPins();
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
  if (!q.value.trim()) return showSuggestions();
  if (q.value.trim().length < 3) return (results.hidden = true);
  searchTimer = setTimeout(runSearch, 350);
});
q.addEventListener('focus', () => !q.value.trim() && showSuggestions());
q.addEventListener('blur', () => setTimeout(() => !q.value.trim() && (results.hidden = true), 200));

// Empty search box: one-tap Home / Work / favorites and recent searches
function showSuggestions() {
  const s = getSaved();
  const rows = [
    s.home && { ...s.home, label: 'Home', blip: 'blip-home' },
    s.work && { ...s.work, label: 'Work', blip: 'blip-work' },
    ...s.favorites.slice(0, 3).map((f) => ({ ...f, label: 'Favorite', blip: 'blip-fav' })),
    ...getRecents().slice(0, 5).map((r) => ({ ...r, label: r.sub || 'Recent' })),
  ].filter(Boolean);
  results.innerHTML = '';
  if (!rows.length) return (results.hidden = true);
  for (const it of rows) {
    const li = document.createElement('li');
    li.className = 'r-suggest';
    li.innerHTML = `${it.blip ? `<img src="${blipInfo(it.blip).url}" alt="">` : '<i class="r-clock">↺</i>'}<div><div class="r-name"></div><div class="r-sub"></div></div>`;
    li.querySelector('.r-name').textContent = it.name;
    li.querySelector('.r-sub').textContent = it.label;
    li.onmousedown = (e) => e.preventDefault(); // keep focus so blur doesn't hide the list first
    li.onclick = () => choose(it);
    results.appendChild(li);
  }
  results.hidden = false;
}
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
  let items = mergeResults(fsqItems, osmItems, near);
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
  addRecent(item);
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
    r.limits = null;
    routeLimits(r.coords).then((p) => state.route === r && (r.limits = p)).catch(() => {});
    state.voice = null;
    updateNav(true);
    if (isReroute) {
      toast('Rerouting…', 1500);
      speak('Route updated.');
    }
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
    announce(next, next.along - s.along);
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

// Spoken prompts: early warning, a closer reminder, then "now". Distances scale with speed.
function announce(step, d) {
  const spd = state.speed;
  const far = spd > 22 ? 1500 : spd > 12 ? 600 : 300;
  const mid = spd > 12 ? 250 : 120;
  const now = Math.max(25, spd * 2.5);
  const lower = step.text.charAt(0).toLowerCase() + step.text.slice(1);
  if (!state.voice || state.voice.step !== step) {
    const followsAnother = !!state.voice;
    state.voice = { step, said: new Set() };
    // the next turn comes right after the one just made: announce it straight away
    if (followsAnother && d <= mid && d > now) {
      state.voice.said.add('far').add('mid');
      speak(`Then ${lower}.`);
      return;
    }
  }
  const v = state.voice;
  if (d <= now && !v.said.has('now') && step.type !== 'arrive') {
    v.said.add('now').add('mid').add('far');
    speak(step.text + '.');
  } else if (d <= mid && d > now && !v.said.has('mid')) {
    v.said.add('mid').add('far');
    speak(`In ${spokenDistance(fmtDist(d))}, ${lower}.`);
  } else if (d <= far && d > mid + 50 && !v.said.has('far')) {
    v.said.add('far');
    speak(`In ${spokenDistance(fmtDist(d))}, ${lower}.`);
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
  $('btn-voice').hidden = false;
  state.voice = null;
  const r = state.route;
  speak(`Starting route to ${state.dest?.name || 'your destination'}. About ${fmtDuration(r.duration)}.`);
  updateNav(true);
  enterDrive();
}

function arrive() {
  toast(`You have arrived at ${state.dest?.name || 'your destination'}`, 4000);
  speak(`You have arrived at ${state.dest?.name || 'your destination'}.`);
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
  state.voice = null;
  $('btn-voice').hidden = true;
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

$('btn-voice').classList.toggle('muted', isMuted());
$('btn-voice').onclick = () => {
  setMuted(!isMuted());
  $('btn-voice').classList.toggle('muted', isMuted());
  toast(isMuted() ? 'Voice guidance off' : 'Voice guidance on', 1500);
  if (!isMuted()) speak('Voice guidance on.');
};

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
