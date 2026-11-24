// Original map pins drawn on canvas at runtime (no external sprite sheet needed).
// Shape: a rounded-square "speech bubble" with a small tail pointing at the spot.

const RATIO = 2;
const W = 40; // css px
const H = 48; // css px (bubble + tail)

export const BLIPS = {
  'blip-fuel':    { label: 'Gas',      color: '#ff5a4f', draw: fuel },
  'blip-food':    { label: 'Food',     color: '#ffb300', draw: food },
  'blip-shop':    { label: 'Shops',    color: '#29b6f6', draw: bag },
  'blip-health':  { label: 'Health',   color: '#ef3b4f', draw: cross },
  'blip-police':  { label: 'Police',   color: '#4c6ef5', draw: shield },
  'blip-bank':    { label: 'Bank',     color: '#2fbf71', draw: text('$') },
  'blip-hotel':   { label: 'Hotel',    color: '#9c4dff', draw: text('H') },
  'blip-parking': { label: 'Parking',  color: '#1e88e5', draw: text('P') },
  'blip-fun':     { label: 'Fun',      color: '#ff4fa3', draw: star },
  // saved places (not part of the map legend)
  'blip-home':    { label: 'Home',     color: '#17646b', draw: house, legend: false },
  'blip-work':    { label: 'Work',     color: '#56657d', draw: briefcase, legend: false },
  'blip-fav':     { label: 'Favorite', color: '#e8a600', draw: star, legend: false },
};

const cache = new Map();

function makeCanvas(id) {
  const spec = BLIPS[id];
  if (!spec) return null;
  const cv = document.createElement('canvas');
  cv.width = W * RATIO;
  cv.height = H * RATIO;
  const g = cv.getContext('2d');
  const s = 64; // bubble size (device px)
  const x = (cv.width - s) / 2;
  const y = 6;
  const r = 15;
  const cx = cv.width / 2;
  const tailTop = y + s - 2;

  // bubble + tail as one outline so the border wraps both
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + s - r, y);
  g.quadraticCurveTo(x + s, y, x + s, y + r);
  g.lineTo(x + s, y + s - r);
  g.quadraticCurveTo(x + s, y + s, x + s - r, y + s);
  g.lineTo(cx + 9, y + s);
  g.lineTo(cx, tailTop + 18);
  g.lineTo(cx - 9, y + s);
  g.lineTo(x + r, y + s);
  g.quadraticCurveTo(x, y + s, x, y + s - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
  g.fillStyle = spec.color;
  g.fill();
  g.lineWidth = 5;
  g.lineJoin = 'round';
  g.strokeStyle = '#0b0d10';
  g.stroke();

  // glyphs are designed for a 72px box centred at 36,36; fit them inside the bubble
  g.save();
  g.translate(cx, y + s / 2);
  g.scale(0.92, 0.92);
  g.translate(-36, -36);
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  spec.draw(g, 36);
  g.restore();
  return cv;
}

function entry(id) {
  let e = cache.get(id);
  if (!e) {
    const cv = makeCanvas(id);
    if (!cv) return null;
    e = { data: cv.getContext('2d').getImageData(0, 0, cv.width, cv.height), url: cv.toDataURL() };
    cache.set(id, e);
  }
  return e;
}

export function addMissingImage(map, id) {
  if (map.hasImage(id)) return;
  const e = entry(id);
  if (e) map.addImage(id, e.data, { pixelRatio: RATIO });
}

export function legendItems() {
  return Object.entries(BLIPS)
    .filter(([, b]) => b.legend !== false)
    .map(([id, b]) => ({ id, label: b.label, url: entry(id).url }));
}

/** Icon data URL, colour and label for a blip id. */
export function blipInfo(id) {
  const b = BLIPS[id];
  if (!b) return null;
  return { url: entry(id).url, color: b.color, label: b.label };
}

/** Pin size in css px, for DOM markers that reuse the same artwork. */
export const PIN_SIZE = { width: W, height: H };

// ---- glyphs (drawn in a 72x72 box, centre c = 36) ----
function text(ch) {
  return (g, c) => {
    g.font = '700 40px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(ch, c, c + 2);
  };
}
function fuel(g, c) {
  g.fillRect(c - 14, c - 16, 18, 32);
  g.fillStyle = BLIPS['blip-fuel'].color;
  g.fillRect(c - 10, c - 12, 10, 8);
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(c + 4, c - 8);
  g.lineTo(c + 12, c - 2);
  g.lineTo(c + 12, c + 12);
  g.stroke();
}
function food(g, c) {
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(c - 9, c - 16); g.lineTo(c - 9, c + 16);
  g.moveTo(c - 15, c - 16); g.lineTo(c - 15, c - 4); g.lineTo(c - 3, c - 4); g.lineTo(c - 3, c - 16);
  g.stroke();
  g.beginPath();
  g.ellipse(c + 9, c - 6, 5, 10, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(c + 9, c); g.lineTo(c + 9, c + 16);
  g.stroke();
}
function bag(g, c) {
  g.fillRect(c - 13, c - 6, 26, 22);
  g.lineWidth = 4;
  g.beginPath();
  g.arc(c, c - 6, 7, Math.PI, 0);
  g.stroke();
}
function cross(g, c) {
  g.fillRect(c - 5, c - 16, 10, 32);
  g.fillRect(c - 16, c - 5, 32, 10);
}
function shield(g, c) {
  g.beginPath();
  g.moveTo(c, c - 17);
  g.lineTo(c + 14, c - 11);
  g.quadraticCurveTo(c + 14, c + 10, c, c + 18);
  g.quadraticCurveTo(c - 14, c + 10, c - 14, c - 11);
  g.closePath();
  g.fill();
}
function star(g, c) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 7 : 17;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    g.lineTo(c + r * Math.cos(a), c + r * Math.sin(a));
  }
  g.closePath();
  g.fill();
}
function house(g, c) {
  // roof
  g.beginPath();
  g.moveTo(c, c - 18);
  g.lineTo(c + 19, c - 1);
  g.lineTo(c - 19, c - 1);
  g.closePath();
  g.fill();
  // walls with a door cut-out
  g.fillRect(c - 13, c - 2, 26, 18);
  g.fillStyle = BLIPS['blip-home'].color;
  g.fillRect(c - 4, c + 5, 8, 11);
}
function briefcase(g, c) {
  g.fillRect(c - 16, c - 8, 32, 22);
  g.lineWidth = 4;
  g.strokeRect(c - 6, c - 15, 12, 8);
}
