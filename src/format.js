// Units follow the device locale: miles/mph for US, UK, Liberia, Myanmar; metric elsewhere.
const lang = (navigator.language || 'en-US').toUpperCase();
export const IMPERIAL = /-(US|GB|LR|MM)$/.test(lang) || lang === 'EN';

export function fmtDist(m) {
  if (IMPERIAL) {
    const mi = m / 1609.344;
    if (mi < 0.1) return `${Math.max(50, Math.round((m * 3.28084) / 50) * 50)} ft`;
    return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
  }
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function fmtDuration(s) {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function fmtClock(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export const speedUnit = IMPERIAL ? 'mph' : 'km/h';
export function fmtSpeed(mps) {
  return Math.round(Math.max(0, mps) * (IMPERIAL ? 2.23694 : 3.6));
}

// Rotation (deg) for the turn arrow, by OSRM maneuver modifier.
const TURN_ANGLE = {
  straight: 0, 'slight right': 45, right: 90, 'sharp right': 135, uturn: 180,
  'slight left': -45, left: -90, 'sharp left': -135,
};
export function turnAngle(step) {
  return TURN_ANGLE[step.modifier] ?? 0;
}
