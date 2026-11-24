// Cloudflare Worker that forwards Foursquare Places requests and adds your key,
// so the key never ships inside the app. Free Cloudflare plan is enough.
//
// Deploy:  npx wrangler deploy worker/fsq-proxy.js --name neonnav-fsq --compatibility-date 2025-01-01
//          npx wrangler secret put FSQ_KEY --name neonnav-fsq     (paste your Foursquare service key)
// Then build the app with VITE_FSQ_PROXY=https://neonnav-fsq.<your-subdomain>.workers.dev

const ALLOWED_PARAMS = new Set(['query', 'll', 'radius', 'limit', 'fields', 'sort', 'near']);
const ALLOWED_FIELDS = new Set(['fsq_place_id', 'name', 'categories', 'location', 'latitude', 'longitude', 'distance', 'tel', 'website']);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, X-Places-Api-Version',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/places/search') {
      return new Response('Not found', { status: 404, headers: CORS });
    }

    // Only pass through what the app uses, and only the cheaper "Pro" fields.
    const upstream = new URL('https://places-api.foursquare.com/places/search');
    for (const [k, v] of url.searchParams) if (ALLOWED_PARAMS.has(k)) upstream.searchParams.set(k, v);
    const fields = (upstream.searchParams.get('fields') || '').split(',').filter((f) => ALLOWED_FIELDS.has(f));
    upstream.searchParams.set('fields', fields.length ? fields.join(',') : [...ALLOWED_FIELDS].join(','));
    const limit = Math.min(10, Number(upstream.searchParams.get('limit')) || 6);
    upstream.searchParams.set('limit', String(limit));

    const res = await fetch(upstream, {
      headers: {
        Authorization: `Bearer ${env.FSQ_KEY}`,
        'X-Places-Api-Version': '2025-06-17',
        Accept: 'application/json',
      },
    });
    return new Response(res.body, {
      status: res.status,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    });
  },
};
