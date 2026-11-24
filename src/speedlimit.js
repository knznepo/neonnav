// Road speed limits from OpenStreetMap via the free Valhalla service (FOSSGIS).
//  - While navigating: one lookup for the whole route.
//  - While driving without a route: a lookup of your recent track every ~15 s.
import { dist } from './geo.js';

const VALHALLA = 'https://valhalla1.openstreetmap.de/trace_attributes';

async function trace(points) {
  const res = await fetch(VALHALLA, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shape: points.map(([lon, lat]) => ({ lat, lon })),
      costing: 'auto',
      shape_match: 'map_snap',
      filters: { attributes: ['edge.speed_limit', 'edge.begin_shape_index', 'edge.end_shape_index', 'shape'], action: 'include' },
    }),
  });
  if (!res.ok) throw new Error('speed limit lookup failed');
  const j = await res.json();
  const shape = decodePolyline6(j.shape || '');
  // one entry per matched shape point: the limit (km/h) of the edge it belongs to
  const limits = new Array(shape.length).fill(null);
  for (const e of j.edges || []) {
    for (let i = e.begin_shape_index; i <= e.end_shape_index && i < shape.length; i++) limits[i] = e.speed_limit ?? limits[i];
  }
  return shape.map((pt, i) => ({ pt, kmh: limits[i] }));
}

/** Thin a line to at most `max` points, at least `minGap` metres apart. */
function thin(coords, max = 1200, minGap = 15) {
  let gap = minGap;
  for (;;) {
    const out = [coords[0]];
    for (let i = 1; i < coords.length; i++) if (dist(out[out.length - 1], coords[i]) >= gap) out.push(coords[i]);
    if (out[out.length - 1] !== coords[coords.length - 1]) out.push(coords[coords.length - 1]);
    if (out.length <= max) return out;
    gap *= 1.6;
  }
}

/** Speed-limit profile for a route; look it up with limitAt(). */
export async function routeLimits(coords) {
  if (!coords || coords.length < 2) return null;
  return trace(thin(coords));
}

/** Limit (km/h) of the closest profile point within 40 m, or null. */
export function limitAt(profile, pos) {
  if (!profile?.length || !pos) return null;
  let best = null;
  let bestD = 40;
  for (const p of profile) {
    const d = dist(p.pt, pos);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best ? best.kmh : null;
}

/** Limit (km/h) on the road at the end of a recent GPS track, or null. */
export async function trackLimit(track) {
  if (!track || track.length < 2) return null;
  const profile = await trace(track);
  for (let i = profile.length - 1; i >= 0; i--) if (profile[i].kmh) return profile[i].kmh;
  return null;
}

function decodePolyline6(str) {
  const out = [];
  let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let result = 0, shift = 0, b;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lon += delta;
    }
    out.push([lon / 1e6, lat / 1e6]);
  }
  return out;
}
