// Small geo helpers. Coordinates are [lng, lat]; distances in metres.

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function dist(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function bearing(a, b) {
  const p1 = rad(a[1]);
  const p2 = rad(b[1]);
  const dl = rad(b[0] - a[0]);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function cumulative(coords) {
  const out = [0];
  for (let i = 1; i < coords.length; i++) out.push(out[i - 1] + dist(coords[i - 1], coords[i]));
  return out;
}

/** Nearest point on a polyline to p, searching segments from index `from`. */
export function snap(coords, cum, p, from = 0) {
  const kx = Math.cos(rad(p[1])) * 111320;
  const ky = 110540;
  let best = { offset: Infinity, index: from, along: cum[from] ?? 0, point: coords[from] };
  for (let i = Math.max(0, from); i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky;
    const dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * ky;
    const len = dx * dx + dy * dy;
    let t = len ? -(ax * dx + ay * dy) / len : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.offset) {
      best = {
        offset: d,
        index: i,
        along: cum[i] + t * (cum[i + 1] - cum[i]),
        point: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])],
      };
    }
  }
  return best;
}

/** Point at a distance along a polyline. */
export function pointAt(coords, cum, along) {
  const total = cum[cum.length - 1];
  const d = Math.max(0, Math.min(total, along));
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid; else hi = mid;
  }
  const a = coords[lo], b = coords[hi];
  const seg = cum[hi] - cum[lo];
  const t = seg ? (d - cum[lo]) / seg : 0;
  return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], done: d >= total };
}

export function angleDiff(a, b) {
  return ((b - a + 540) % 360) - 180;
}

export function lerpAngle(a, b, t) {
  return (a + angleDiff(a, b) * t + 360) % 360;
}
