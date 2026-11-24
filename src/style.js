// Custom dark "game radar" map style for MapLibre, using free OpenFreeMap vector tiles
// (OpenMapTiles schema). Tweak COLORS to restyle the whole map.

export const COLORS = {
  land: '#1d2127',
  residential: '#22272e',
  industrial: '#26232b',
  park: '#1c3627',
  wood: '#1a3123',
  sand: '#3a3427',
  water: '#0e3a56',
  waterLine: '#15506f',
  waterLabel: '#5fa8d3',
  building: '#2b313a',
  roadMinor: '#414854',
  roadMid: '#6c7482',
  roadMajor: '#9ba4b1',
  motorway: '#d8dde4',
  rail: '#4e4654',
  label: '#e8ecf1',
  labelDim: '#9aa4b1',
  halo: '#0b0d10',
  route: '#ff5fb4',      // pink route band
  routeEdge: '#ffe2f1',  // light edge lines along both sides
};

const C = COLORS;
const EMPTY = { type: 'FeatureCollection', features: [] };
const inClass = (...c) => ['in', ['get', 'class'], ['literal', c]];
const width = (...stops) => ['interpolate', ['exponential', 1.6], ['zoom'], ...stops];
const FONT = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];
const NAME = ['coalesce', ['get', 'name:latin'], ['get', 'name']];

// POI class -> blip image id (images are drawn in icons.js)
export const POI_BLIPS = {
  fuel: 'blip-fuel',
  restaurant: 'blip-food', fast_food: 'blip-food', cafe: 'blip-food', bar: 'blip-food',
  beer: 'blip-food', ice_cream: 'blip-food', bakery: 'blip-food',
  shop: 'blip-shop', grocery: 'blip-shop', clothing_store: 'blip-shop', department_store: 'blip-shop',
  hospital: 'blip-health', doctors: 'blip-health', pharmacy: 'blip-health', dentist: 'blip-health',
  police: 'blip-police',
  bank: 'blip-bank', atm: 'blip-bank',
  lodging: 'blip-hotel',
  parking: 'blip-parking',
  attraction: 'blip-fun', museum: 'blip-fun', theatre: 'blip-fun', cinema: 'blip-fun', stadium: 'blip-fun',
};

const poiIcon = ['match', ['get', 'class'], ...Object.entries(POI_BLIPS).flat(), ''];

export function buildStyle({ radar = false } = {}) {
  const r = radar ? 1.35 : 1; // radar draws roads a bit thicker

  const layers = [
    { id: 'background', type: 'background', paint: { 'background-color': C.land } },
    {
      id: 'landcover-wood', type: 'fill', source: 'omt', 'source-layer': 'landcover',
      filter: inClass('wood', 'forest'), paint: { 'fill-color': C.wood },
    },
    {
      id: 'landcover-grass', type: 'fill', source: 'omt', 'source-layer': 'landcover',
      filter: inClass('grass', 'farmland', 'wetland'), paint: { 'fill-color': C.park, 'fill-opacity': 0.7 },
    },
    {
      id: 'landcover-sand', type: 'fill', source: 'omt', 'source-layer': 'landcover',
      filter: inClass('sand', 'beach'), paint: { 'fill-color': C.sand },
    },
    {
      id: 'landuse-residential', type: 'fill', source: 'omt', 'source-layer': 'landuse',
      filter: inClass('residential', 'suburb', 'neighbourhood'), paint: { 'fill-color': C.residential },
    },
    {
      id: 'landuse-industrial', type: 'fill', source: 'omt', 'source-layer': 'landuse',
      filter: inClass('industrial', 'commercial', 'retail', 'railway'), paint: { 'fill-color': C.industrial },
    },
    {
      id: 'landuse-green', type: 'fill', source: 'omt', 'source-layer': 'landuse',
      filter: inClass('cemetery', 'stadium', 'pitch', 'playground'), paint: { 'fill-color': C.park },
    },
    { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': C.park, 'fill-opacity': 0.85 } },
    {
      id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water',
      filter: ['!=', ['get', 'brunnel'], 'tunnel'], paint: { 'fill-color': C.water },
    },
    {
      id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway',
      paint: { 'line-color': C.waterLine, 'line-width': width(10, 0.5, 18, 6) },
    },
    {
      id: 'aeroway', type: 'line', source: 'omt', 'source-layer': 'aeroway',
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: { 'line-color': C.roadMid, 'line-width': width(11, 1, 18, 30) },
    },
    radar
      ? {
          id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14,
          paint: { 'fill-color': C.building },
        }
      : {
          id: 'building', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 14,
          paint: {
            'fill-extrusion-color': C.building,
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': 0.85,
          },
        },
    roadLayer('road-path', inClass('path', 'track'), C.roadMinor, width(15, 0.5, 18, 2), { minzoom: 15, dash: [2, 2] }),
    roadLayer('road-minor', inClass('minor', 'service'), C.roadMinor, width(12, 0.4 * r, 16, 4 * r, 18, 14 * r), { minzoom: 12 }),
    roadLayer('road-mid', inClass('secondary', 'tertiary'), C.roadMid, width(9, 0.5 * r, 14, 2.5 * r, 18, 18 * r)),
    roadLayer('road-major', inClass('primary', 'trunk'), C.roadMajor, width(7, 0.6 * r, 14, 3.5 * r, 18, 24 * r)),
    roadLayer('road-motorway', inClass('motorway'), C.motorway, width(5, 0.6 * r, 14, 4 * r, 18, 28 * r)),
    roadLayer('rail', inClass('rail'), C.rail, width(12, 0.5, 18, 3), { dash: [3, 3] }),

    // GPS route (data set at runtime): a pink band with lighter edges. The fade near the
    // player is applied at runtime with a line-gradient (see routeGradient in main.js).
    {
      id: 'route-casing', type: 'line', source: 'route',
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': C.routeEdge, 'line-width': width(10, 6.5 * r, 14, 12 * r, 18, 31 * r) },
    },
    {
      id: 'route-line', type: 'line', source: 'route',
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': C.route, 'line-width': width(10, 4 * r, 14, 8 * r, 18, 25 * r) },
    },
  ];

  if (!radar) {
    layers.push(
      {
        id: 'water-label', type: 'symbol', source: 'omt', 'source-layer': 'water_name',
        layout: { 'text-field': NAME, 'text-font': FONT, 'text-size': 12, 'text-letter-spacing': 0.15 },
        paint: { 'text-color': C.waterLabel, 'text-halo-color': C.halo, 'text-halo-width': 1.2 },
      },
      {
        id: 'road-label', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 13,
        layout: {
          'symbol-placement': 'line', 'text-field': NAME, 'text-font': FONT,
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 18, 14],
        },
        paint: { 'text-color': C.labelDim, 'text-halo-color': C.halo, 'text-halo-width': 1.5 },
      },
      {
        id: 'place-district', type: 'symbol', source: 'omt', 'source-layer': 'place',
        filter: inClass('suburb', 'neighbourhood', 'quarter', 'village', 'hamlet'),
        layout: {
          'text-field': NAME, 'text-font': FONT_BOLD, 'text-transform': 'uppercase',
          'text-letter-spacing': 0.25, 'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 16, 14],
          'text-max-width': 8,
        },
        paint: { 'text-color': C.labelDim, 'text-halo-color': C.halo, 'text-halo-width': 1.5 },
      },
      {
        id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place',
        filter: inClass('city', 'town'),
        layout: {
          'text-field': NAME, 'text-font': FONT_BOLD, 'text-transform': 'uppercase',
          'text-letter-spacing': 0.2, 'text-size': ['interpolate', ['linear'], ['zoom'], 6, 12, 14, 22],
        },
        paint: { 'text-color': C.label, 'text-halo-color': C.halo, 'text-halo-width': 2 },
      },
    );
  }

  layers.push({
    id: 'poi-blips', type: 'symbol', source: 'omt', 'source-layer': 'poi',
    minzoom: 13,
    filter: ['in', ['get', 'class'], ['literal', Object.keys(POI_BLIPS)]],
    layout: {
      'icon-image': poiIcon,
      'icon-size': radar ? 0.62 : ['interpolate', ['linear'], ['zoom'], 13, 0.55, 17, 0.85],
      'icon-padding': radar ? 10 : 22,
      'symbol-sort-key': ['get', 'rank'],
    },
  });

  return {
    version: 8,
    name: radar ? 'radar' : 'main',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
      route: { type: 'geojson', data: EMPTY, lineMetrics: true }, // lineMetrics enables line-gradient
    },
    layers,
  };
}

function roadLayer(id, filter, color, lineWidth, { minzoom, dash } = {}) {
  const layer = {
    id, type: 'line', source: 'omt', 'source-layer': 'transportation', filter,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': lineWidth },
  };
  if (minzoom) layer.minzoom = minzoom;
  if (dash) {
    layer.paint['line-dasharray'] = dash;
    layer.layout['line-cap'] = 'butt';
  }
  return layer;
}
