// Compass heading (so the arrow turns while you stand still) and keep-screen-awake.
import { KeepAwake } from '@capacitor-community/keep-awake';

let heading = null;
let headingAt = 0;
let started = false;

/** Latest compass heading in degrees (0 = north), or null if none recently. */
export function compassHeading(maxAgeMs = 1500) {
  return heading != null && performance.now() - headingAt < maxAgeMs ? heading : null;
}

function onOrientation(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0 && e.webkitCompassAccuracy !== -1) {
    h = e.webkitCompassHeading; // iOS: degrees clockwise from north
  } else if (e.absolute && typeof e.alpha === 'number') {
    h = 360 - e.alpha; // Android: alpha is counter-clockwise from north
  }
  if (h == null) return;
  const screenAngle = screen.orientation?.angle ?? window.orientation ?? 0;
  heading = (h + screenAngle + 360) % 360;
  headingAt = performance.now();
}

function startCompass() {
  if (started) return;
  started = true;
  // iOS reports webkitCompassHeading on 'deviceorientation'; Android reports absolute alpha on
  // 'deviceorientationabsolute'. Listen to both; relative-only readings are ignored in onOrientation.
  window.addEventListener('deviceorientationabsolute', onOrientation);
  window.addEventListener('deviceorientation', onOrientation);
}

const needsPermission = typeof window.DeviceOrientationEvent?.requestPermission === 'function';

/**
 * Starts listening right away (Android/desktop deliver events without asking). Where the browser
 * gates motion sensors behind a permission (iOS, newer Chrome), this must also be called from a
 * tap; it returns true once the compass is usable.
 */
export async function enableCompass({ fromGesture = false } = {}) {
  startCompass();
  if (heading != null || !needsPermission) return true;
  if (!fromGesture) return false;
  try {
    const result = await window.DeviceOrientationEvent.requestPermission();
    denied = result === 'denied';
    return result === 'granted';
  } catch {
    return false;
  }
}

let denied = false;
/** True if the user explicitly refused motion access (iOS keeps refusing until the tab reloads). */
export const compassBlocked = () => denied;

let awake = false;
/** Keep the screen on (native: plugin, web: Screen Wake Lock API). Safe to call repeatedly. */
export async function setKeepAwake(on) {
  if (on === awake) return;
  try {
    if (on) await KeepAwake.keepAwake();
    else await KeepAwake.allowSleep();
    awake = on;
  } catch {
    /* unsupported or needs a user gesture; retried on next tap */
  }
}
