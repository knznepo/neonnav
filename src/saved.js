// Saved places (Home, Work, Favorites) and recent searches, stored on this device.
const SAVED_KEY = 'neonnav:saved';
const RECENT_KEY = 'neonnav:recent';
const MAX_RECENT = 8;

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage full or blocked */ }
};

const listeners = new Set();
export const onSavedChange = (fn) => listeners.add(fn);
const changed = () => listeners.forEach((fn) => fn(getSaved()));

/** { home: place|null, work: place|null, favorites: place[] }  place = { name, coord, cls? } */
export function getSaved() {
  const s = read(SAVED_KEY, {});
  return { home: s.home || null, work: s.work || null, favorites: Array.isArray(s.favorites) ? s.favorites : [] };
}

const same = (a, b) => a && b && a.name === b.name && Math.abs(a.coord[0] - b.coord[0]) < 1e-5 && Math.abs(a.coord[1] - b.coord[1]) < 1e-5;

/** kind: 'home' | 'work' | 'favorite' */
export function savePlace(kind, place) {
  const s = getSaved();
  const p = { name: place.name, coord: place.coord, cls: place.cls || null };
  if (kind === 'favorite') {
    if (!s.favorites.some((f) => same(f, p))) s.favorites.unshift(p);
  } else {
    s[kind] = p;
  }
  write(SAVED_KEY, s);
  changed();
}

export function removePlace(place) {
  const s = getSaved();
  if (same(s.home, place)) s.home = null;
  if (same(s.work, place)) s.work = null;
  s.favorites = s.favorites.filter((f) => !same(f, place));
  write(SAVED_KEY, s);
  changed();
}

/** Which saved kinds this place currently is (e.g. ['home','favorite']). */
export function savedKinds(place) {
  const s = getSaved();
  return [same(s.home, place) && 'home', same(s.work, place) && 'work', s.favorites.some((f) => same(f, place)) && 'favorite'].filter(Boolean);
}

export function getRecents() {
  const r = read(RECENT_KEY, []);
  return Array.isArray(r) ? r : [];
}

export function addRecent(item) {
  const r = getRecents().filter((x) => !same(x, item));
  r.unshift({ name: item.name, sub: item.sub || '', coord: item.coord });
  write(RECENT_KEY, r.slice(0, MAX_RECENT));
}

export function clearRecents() {
  write(RECENT_KEY, []);
}
