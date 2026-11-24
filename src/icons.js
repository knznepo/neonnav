// Original blip icons drawn on canvas at runtime (no external sprite sheet needed).

const RATIO = 2;
const SIZE = 36; // css px

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
};

const cache = new Map();

function makeCanvas(id) {
  const spec = BLIPS[id];
  if (!spec) return null;
  const px = SIZE * RATIO;
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const g = cv.getContext('2d');
  const c = px / 2;
  g.beginPath();
  g.arc(c, c, c - 5, 0, Math.PI * 2);
  g.fillStyle = spec.color;
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = '#0b0d10';
  g.stroke();
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  spec.draw(g, c, px);
  return cv;
}

export function addMissingImage(map, id) {
  if (map.hasImage(id)) return;
  let entry = cache.get(id);
  if (!entry) {
    const cv = makeCanvas(id);
    if (!cv) return;
    entry = { data: cv.getContext('2d').getImageData(0, 0, cv.width, cv.height), url: cv.toDataURL() };
    cache.set(id, entry);
  }
  map.addImage(id, entry.data, { pixelRatio: RATIO });
}

export function legendItems() {
  return Object.entries(BLIPS).map(([id, b]) => {
    if (!cache.has(id)) {
      const cv = makeCanvas(id);
      cache.set(id, { data: cv.getContext('2d').getImageData(0, 0, cv.width, cv.height), url: cv.toDataURL() });
    }
    return { id, label: b.label, url: cache.get(id).url };
  });
}

// ---- glyphs (drawn in a 72x72 box, centre c) ----
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
  g.fillStyle = '#ff5a4f';
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

/** Icon data URL, colour and label for a blip id (used by the place card). */
export function blipInfo(id) {
  const b = BLIPS[id];
  if (!b) return null;
  legendItems(); // makes sure every icon is rendered and cached
  return { url: cache.get(id).url, color: b.color, label: b.label };
}
