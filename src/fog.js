// Exploration fog: everything you haven't been near is covered by a dark, translucent overlay.
//  - Revealed: the town/city you're in (OpenStreetMap boundary via Nominatim) and a corridor
//    around every place you've actually been (real GPS only, not demo drives).
//  - Saved on this device, so the explored area grows over time.
import union from '@turf/union';
import difference from '@turf/difference';
import circle from '@turf/circle';
import simplify from '@turf/simplify';
import { featureCollection, polygon } from '@turf/helpers';
import { dist } from './geo.js';

const KEY = 'neonnav:explored';
const ON_KEY = 'neonnav:fog';
const TOWNS_KEY = 'neonnav:towns';
const REVEAL_KM = 0.45; // radius revealed around where you go
const STEP_M = 200; // reveal again after moving this far
const WORLD = polygon([[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]]);
const EMPTY = { type: 'FeatureCollection', features: [] };

const read = (k, f) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? f;
  } catch {
    return f;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch { /* storage full: keep working in memory */ }
};

let explored = read(KEY, null); // Feature<Polygon|MultiPolygon> | null
let enabled = read(ON_KEY, true);
let lastReveal = null;
let cachedFog = null;
const listeners = new Set();

export const onFogChange = (fn) => listeners.add(fn);
const changed = () => {
  cachedFog = null;
  listeners.forEach((fn) => fn());
};

export const fogEnabled = () => enabled;
export function setFogEnabled(on) {
  enabled = on;
  write(ON_KEY, on);
  changed();
}

/** GeoJSON for the fog layer: the world minus everything explored. */
export function fogData() {
  if (!enabled || !explored) return EMPTY; // nothing to show until we know where you are
  if (!cachedFog) {
    try {
      cachedFog = difference(featureCollection([WORLD, explored])) || EMPTY;
    } catch {
      cachedFog = EMPTY;
    }
  }
  return cachedFog;
}

function add(feature) {
  try {
    explored = explored ? union(featureCollection([explored, feature])) : feature;
    // keep storage small: simplify once the shape gets detailed
    const size = JSON.stringify(explored.geometry).length;
    if (size > 400000) explored = simplify(explored, { tolerance: 0.0002, highQuality: false });
    write(KEY, explored);
    changed();
  } catch {
    /* geometry error: skip this piece */
  }
}

/** Reveal a circle around a real GPS position (throttled by distance). */
export function revealAround(pos) {
  if (lastReveal && dist(lastReveal, pos) < STEP_M) return;
  lastReveal = pos;
  add(circle(pos, REVEAL_KM, { steps: 28, units: 'kilometers' }));
}

/** Reveal the town/city containing this position (once per town). */
export async function revealTown(pos) {
  const u = new URL('https://nominatim.openstreetmap.org/reverse');
  u.searchParams.set('format', 'geojson');
  u.searchParams.set('lat', pos[1].toFixed(5));
  u.searchParams.set('lon', pos[0].toFixed(5));
  u.searchParams.set('zoom', '10'); // city / municipality level
  u.searchParams.set('polygon_geojson', '1');
  u.searchParams.set('polygon_threshold', '0.0005'); // simplified outline, smaller download
  try {
    const res = await fetch(u);
    if (!res.ok) throw new Error('town lookup failed');
    const f = (await res.json()).features?.[0];
    const id = f && `${f.properties.osm_type}${f.properties.osm_id}`;
    const towns = read(TOWNS_KEY, []);
    if (f && /Polygon/.test(f.geometry?.type)) {
      if (towns.includes(id)) return f.properties.name;
      add({ type: 'Feature', properties: {}, geometry: f.geometry });
      write(TOWNS_KEY, [...towns, id]);
      return f.properties.name;
    }
  } catch {
    /* offline or no boundary: fall through */
  }
  // no boundary available: reveal a generous circle instead
  add(circle(pos, 3, { steps: 48, units: 'kilometers' }));
  return null;
}

/** Reveal a corridor along a path (e.g. the likely road between two GPS fixes after a gap). */
export function revealPath(coords) {
  if (!coords || coords.length < 2) return;
  const pts = [coords[0]];
  for (const c of coords) if (dist(pts[pts.length - 1], c) >= 150) pts.push(c);
  pts.push(coords[coords.length - 1]);
  const circles = pts.map((pt) => circle(pt, REVEAL_KM, { steps: 16, units: 'kilometers' }));
  try {
    // one union of everything at once is far faster than adding circles one by one
    const merged = union(featureCollection(explored ? [explored, ...circles] : circles));
    explored = merged;
    write(KEY, explored);
    lastReveal = coords[coords.length - 1];
    changed();
  } catch {
    /* geometry error: skip */
  }
}

export function resetExploration() {
  explored = null;
  lastReveal = null;
  write(KEY, null);
  write(TOWNS_KEY, []);
  changed();
}
