// Toll trip detection: notices when you get on and off a toll road (from Valhalla's road data)
// and reports the trip so the wallet can deduct the toll.
import { dist } from './geo.js';

let onToll = null; // { entry: [lng,lat], names: string[], t }
let pending = null; // waiting for one confirming non-toll sample before calling it an exit

// Best-guess account per expressway name. The user's own choice for a road always wins.
const GUESS = [
  [/skyway|slex|south luzon|star tollway|southern tagalog|tplex|tarlac.?pangasinan|naiax|naia expressway/i, 'autosweep'],
  [/nlex|north luzon|sctex|subic.?clark|cavitex|manila.?cavite|calax|cavite.?laguna|harbor link|nlex connector/i, 'easytrip'],
];
export function guessAccount(names) {
  const joined = names.join(' ');
  for (const [re, acc] of GUESS) if (re.test(joined)) return acc;
  return null;
}

/** ~1 km grid key so the same entry/exit pair matches on later trips. */
export const pointKey = ([lng, lat]) => `${lat.toFixed(2)},${lng.toFixed(2)}`;
export const tripKey = (entry, exit) => `${pointKey(entry)}>${pointKey(exit)}`;

/**
 * Feed the latest road info (from trackInfo) and your position.
 * Returns a finished trip { entry, exit, names } when you leave a toll road, otherwise null.
 */
export function updateToll(info, pos) {
  if (!info) return null;
  if (info.toll) {
    pending = null;
    if (!onToll) onToll = { entry: pos, names: [...info.names], t: Date.now() };
    else for (const n of info.names) if (!onToll.names.includes(n)) onToll.names.push(n);
    return null;
  }
  if (!onToll) return null;
  // first non-toll reading: wait for a second one so a brief mismatch isn't counted as an exit
  if (!pending) {
    pending = pos;
    return null;
  }
  const trip = { entry: onToll.entry, exit: pending, names: onToll.names };
  onToll = null;
  pending = null;
  // ignore jitter: a "trip" shorter than 300 m isn't a real toll passage
  return dist(trip.entry, trip.exit) < 300 ? null : trip;
}

export const onTollRoad = () => !!onToll;

/**
 * Toll stretches along a planned route, from its road profile (speedlimit.routeLimits):
 * [{ entry, exit, names }] for each continuous run of toll road at least 300 m long.
 */
export function routeTollSegments(profile) {
  const out = [];
  let run = null;
  for (const p of profile || []) {
    if (p.toll) {
      if (!run) run = { entry: p.pt, exit: p.pt, names: [] };
      run.exit = p.pt;
      for (const n of p.names) if (!run.names.includes(n)) run.names.push(n);
    } else if (run) {
      out.push(run);
      run = null;
    }
  }
  if (run) out.push(run);
  return out.filter((r) => dist(r.entry, r.exit) >= 300);
}
