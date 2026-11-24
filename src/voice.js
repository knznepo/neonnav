// Spoken turn-by-turn guidance. Native apps use the system text-to-speech engine (Android's
// WebView has no speechSynthesis); browsers use the Web Speech API.
import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

const NATIVE = Capacitor.isNativePlatform();
const MUTE_KEY = 'neonnav:muted';
let muted = false;
try {
  muted = localStorage.getItem(MUTE_KEY) === '1';
} catch { /* ignore */ }

export const isMuted = () => muted;
export function setMuted(on) {
  muted = on;
  try {
    localStorage.setItem(MUTE_KEY, on ? '1' : '0');
  } catch { /* ignore */ }
  if (on) stop();
}

const lang = navigator.language || 'en-US';

export async function speak(text) {
  if (muted || !text) return;
  try {
    if (NATIVE) {
      await TextToSpeech.stop().catch(() => {});
      await TextToSpeech.speak({ text, lang, rate: 1.0, pitch: 1.0, volume: 1.0, category: 'playback' });
    } else if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = 1.0;
      speechSynthesis.speak(u);
    }
  } catch {
    /* no TTS engine available */
  }
}

export function stop() {
  if (NATIVE) TextToSpeech.stop().catch(() => {});
  else if ('speechSynthesis' in window) speechSynthesis.cancel();
}

/** Turn "350 ft" / "1.2 km" into words a voice reads naturally. */
export function spokenDistance(d) {
  return d
    .replace(/\bft\b/, 'feet')
    .replace(/\bmi\b/, (m) => (d.startsWith('1 ') ? 'mile' : 'miles'))
    .replace(/\bkm\b/, 'kilometers')
    .replace(/\bm\b/, 'meters');
}
