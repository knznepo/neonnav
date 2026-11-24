// Free, keyless services built on OpenStreetMap data.
//  - Photon (komoot) for search + reverse geocoding
//  - OSRM public demo server for driving routes
// Both are fair-use public servers; for a production app with real traffic,
// self-host them or switch to a paid tier (see README).

const PHOTON = 'https://photon.komoot.io';
const OSRM = 'https://router.project-osrm.org';

export async function searchPlaces(query, near) {
  const u = new URL(`${PHOTON}/api/`);
  u.searchParams.set('q', query);
  u.searchParams.set('limit', '6');
  if (near) {
    u.searchParams.set('lon', near[0].toFixed(5));
    u.searchParams.set('lat', near[1].toFixed(5));
  }
  const res = await fetch(u);
  if (!res.ok) throw new Error('Search failed');
  const data = await res.json();
  return data.features.map((f) => {
    const p = f.properties;
    const street = [p.housenumber, p.street].filter(Boolean).join(' ');
    return {
      name: p.name || street || p.city || 'Place',
      sub: [p.name ? street : '', p.city, p.state, p.country].filter(Boolean).join(', '),
      coord: f.geometry.coordinates,
    };
  });
}

export async function reverseGeocode(coord) {
  const u = new URL(`${PHOTON}/reverse`);
  u.searchParams.set('lon', coord[0].toFixed(5));
  u.searchParams.set('lat', coord[1].toFixed(5));
  const res = await fetch(u);
  if (!res.ok) return null;
  const p = (await res.json()).features?.[0]?.properties;
  if (!p) return null;
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  return {
    street: p.street || p.name || '',
    name: p.name || p.street || p.city || '',
    address: [street, p.city || p.district, p.state].filter(Boolean).join(', '),
  };
}

// Extra details for a map place (hours, phone, website…) from OpenStreetMap:
// Photon finds the matching OSM element, then the official OSM API returns its tags.
const OSM_API = 'https://api.openstreetmap.org/api/0.6';
const OSM_TYPES = { N: 'node', W: 'way', R: 'relation' };

export async function placeDetails(name, coord) {
  if (!name) return null;
  const u = new URL(`${PHOTON}/api/`);
  u.searchParams.set('q', name);
  u.searchParams.set('lon', coord[0].toFixed(5));
  u.searchParams.set('lat', coord[1].toFixed(5));
  u.searchParams.set('limit', '5');
  const res = await fetch(u);
  if (!res.ok) return null;
  const match = (await res.json()).features.find(
    (f) => f.properties.name === name && f.properties.osm_id && haversine(f.geometry.coordinates, coord) < 150,
  );
  if (!match) return null;
  const type = OSM_TYPES[match.properties.osm_type];
  if (!type) return null;
  const el = await fetch(`${OSM_API}/${type}/${match.properties.osm_id}.json`);
  if (!el.ok) return null;
  return (await el.json()).elements?.[0]?.tags || null;
}

function haversine(a, b) {
  const r = Math.PI / 180;
  const x = (b[0] - a[0]) * r * Math.cos(((a[1] + b[1]) / 2) * r);
  const y = (b[1] - a[1]) * r;
  return Math.hypot(x, y) * 6371000;
}

export async function getRoute(from, to) {
  const url = `${OSRM}/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Routing service unavailable');
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No route found');
  const route = data.routes[0];
  return {
    coords: route.geometry.coordinates,
    distance: route.distance,
    duration: route.duration,
    steps: route.legs[0].steps.map((s) => ({
      location: s.maneuver.location,
      type: s.maneuver.type,
      modifier: s.maneuver.modifier || 'straight',
      name: s.name || s.ref || '',
      text: instruction(s),
    })),
  };
}

function instruction(s) {
  const m = s.maneuver;
  const road = s.name || s.ref || '';
  const onto = road ? ` onto ${road}` : '';
  const mod = m.modifier || '';
  switch (m.type) {
    case 'depart': return road ? `Head out on ${road}` : 'Head out';
    case 'arrive': return 'Arrive at your destination';
    case 'roundabout':
    case 'rotary': return `At the roundabout, take exit ${m.exit ?? ''}${onto}`.replace('  ', ' ');
    case 'merge': return `Merge${onto}`;
    case 'on ramp': return `Take the ramp${onto}`;
    case 'off ramp': return `Take the exit${onto}`;
    case 'fork': return `Keep ${mod.replace('slight ', '')}${onto}`;
    case 'continue':
    case 'new name': return `Continue${onto}`;
    default:
      if (mod === 'straight') return `Continue straight${onto}`;
      if (mod === 'uturn') return `Make a U-turn${onto}`;
      return `Turn ${mod}${onto}`;
  }
}

// ---------------------------------------------------------------- photos
// Photos come from the place's OpenStreetMap tags (image, wikimedia_commons, wikidata,
// wikipedia), resolved through Wikimedia Commons for thumbnails and author credit.
// If none are tagged, geotagged Commons photos taken within a few metres are used,
// flagged as `nearby` so the UI can say so.
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const MAX_PHOTOS = 5;

const api = async (base, params) => {
  const u = new URL(base);
  for (const [k, v] of Object.entries({ format: 'json', origin: '*', ...params })) u.searchParams.set(k, v);
  const res = await fetch(u);
  if (!res.ok) throw new Error('photo lookup failed');
  return res.json();
};
const settle = (p) => p.catch(() => []);

export async function placePhotos(tags, coord) {
  const t = tags || {};
  const direct = [];
  const lookups = [];

  for (const v of (t.image || '').split(';').map((x) => x.trim()).filter(Boolean)) {
    const file = v.match(/commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/);
    if (file) lookups.push(Promise.resolve([decodeURIComponent(file[1]).replace(/_/g, ' ')]));
    else if (/^https:\/\/.+\.(jpe?g|png|webp)(\?.*)?$/i.test(v)) direct.push({ thumb: v, full: v, credit: new URL(v).hostname, link: v });
  }

  const wc = (t.wikimedia_commons || '').trim();
  if (wc.startsWith('File:')) lookups.push(Promise.resolve([wc]));
  else if (wc.startsWith('Category:')) {
    lookups.push(settle(api(COMMONS, { action: 'query', list: 'categorymembers', cmtitle: wc, cmtype: 'file', cmlimit: 6 })
      .then((j) => j.query.categorymembers.map((m) => m.title))));
  }

  if (/^Q\d+$/.test(t.wikidata || '')) {
    lookups.push(settle(api('https://www.wikidata.org/w/api.php', { action: 'wbgetclaims', entity: t.wikidata, property: 'P18' })
      .then((j) => (j.claims?.P18 || []).slice(0, 3).map((c) => `File:${c.mainsnak.datavalue.value}`))));
  }

  const wp = (t.wikipedia || '').match(/^([a-z-]+):(.+)$/);
  if (wp) {
    lookups.push(settle(api(`https://${wp[1]}.wikipedia.org/w/api.php`, { action: 'query', titles: wp[2], prop: 'pageimages', piprop: 'name' })
      .then((j) => Object.values(j.query.pages).map((p) => p.pageimage).filter(Boolean).map((n) => `File:${n}`))));
  }

  let titles = [...new Set((await Promise.all(lookups)).flat())];
  let nearby = false;
  if (!titles.length && !direct.length && coord) {
    titles = await settle(api(COMMONS, {
      action: 'query', list: 'geosearch', gscoord: `${coord[1]}|${coord[0]}`, gsradius: 30, gsnamespace: 6, gslimit: 4,
    }).then((j) => j.query.geosearch.map((g) => g.title)));
    nearby = titles.length > 0;
  }

  const photos = [...direct, ...(await commonsInfo(titles.slice(0, MAX_PHOTOS)))].slice(0, MAX_PHOTOS);
  return { photos, nearby };
}

async function commonsInfo(titles) {
  if (!titles.length) return [];
  const j = await api(COMMONS, {
    action: 'query', titles: titles.join('|'), prop: 'imageinfo',
    iiprop: 'url|mime|extmetadata', iiurlwidth: 960, iiextmetadatafilter: 'Artist|LicenseShortName',
  }).catch(() => null);
  if (!j?.query?.pages) return [];
  const order = new Map(titles.map((tt, i) => [tt, i]));
  return Object.values(j.query.pages)
    .filter((p) => p.imageinfo?.[0] && /^image\/(jpeg|png|webp)$/.test(p.imageinfo[0].mime))
    .sort((a, b) => (order.get(a.title) ?? 99) - (order.get(b.title) ?? 99))
    .map((p) => {
      const ii = p.imageinfo[0];
      const meta = ii.extmetadata || {};
      const artist = stripHtml(meta.Artist?.value || '') || 'Wikimedia Commons';
      const license = meta.LicenseShortName?.value || '';
      return {
        thumb: ii.thumburl || ii.url,
        full: (ii.thumburl || ii.url).replace(/\/960px-/, '/1920px-'),
        fallback: ii.thumburl || ii.url,
        credit: [artist, license].filter(Boolean).join(' · '),
        link: ii.descriptionurl,
      };
    });
}

// DOMParser builds an inert document, so markup in third-party credits can't run anything.
function stripHtml(html) {
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
  return text.trim().replace(/\s+/g, ' ').slice(0, 80);
}

// ---------------------------------------------------------------- Foursquare (optional)
// Adds business search results and fills missing phone/website/address on place cards.
// Configure ONE of these at build time (see README):
//   VITE_FSQ_PROXY = URL of your proxy that adds the key (safe for shared builds)
//   VITE_FSQ_KEY   = Foursquare service key (personal builds only; it ends up inside the app)
const FSQ_KEY = import.meta.env.VITE_FSQ_KEY;
const FSQ_PROXY = import.meta.env.VITE_FSQ_PROXY;
export const foursquareEnabled = Boolean(FSQ_KEY || FSQ_PROXY);
// "Pro" fields only; hours/rating/photos are pricier "Premium" fields.
const FSQ_FIELDS = 'fsq_place_id,name,categories,location,latitude,longitude,distance,tel,website';

async function fsq(path, params) {
  const base = (FSQ_PROXY || 'https://places-api.foursquare.com').replace(/\/$/, '');
  const u = new URL(base + path);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  const headers = { Accept: 'application/json', 'X-Places-Api-Version': '2025-06-17' };
  if (!FSQ_PROXY) headers.Authorization = `Bearer ${FSQ_KEY}`;
  const res = await fetch(u, { headers });
  if (!res.ok) throw new Error(`Foursquare ${res.status}`);
  return res.json();
}

function fsqItem(r) {
  const loc = r.location || {};
  return {
    name: r.name,
    sub: [r.categories?.[0]?.name, loc.formatted_address || [loc.address, loc.locality].filter(Boolean).join(', ')]
      .filter(Boolean)
      .join(' · '),
    coord: [r.longitude, r.latitude],
    source: 'foursquare',
    fsq: r,
  };
}

export async function searchFoursquare(query, near) {
  if (!foursquareEnabled || !near) return [];
  const j = await fsq('/places/search', {
    query,
    ll: `${near[1].toFixed(5)},${near[0].toFixed(5)}`,
    limit: 6,
    fields: FSQ_FIELDS,
  });
  return (j.results || []).filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude)).map(fsqItem);
}

/** Best Foursquare match for a named place at a location (or null). */
export async function foursquareMatch(name, coord) {
  if (!foursquareEnabled || !name) return null;
  const j = await fsq('/places/search', {
    query: name,
    ll: `${coord[1].toFixed(5)},${coord[0].toFixed(5)}`,
    radius: 150,
    limit: 3,
    fields: FSQ_FIELDS,
  });
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const want = norm(name);
  return (j.results || []).find((r) => {
    const got = norm(r.name);
    return got && (got.includes(want) || want.includes(got)) && haversine([r.longitude, r.latitude], coord) < 150;
  }) || null;
}

/** Foursquare results first (better business coverage), then OSM, without near-duplicates. */
export function mergeResults(primary, secondary, max = 8) {
  const out = [];
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const it of [...primary, ...secondary]) {
    // same name within 250 m = same place (sources often pin a venue at different spots)
    const dup = out.some((o) => norm(o.name) === norm(it.name) && haversine(o.coord, it.coord) < 250);
    if (!dup) out.push(it);
    if (out.length >= max) break;
  }
  return out;
}
