// Usage events for Google Tag Manager / Google Analytics. Never includes locations, place names,
// search text or balances: only which feature was used.
const KEY = 'neonnav:analytics';

export function analyticsEnabled() {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function setAnalyticsEnabled(on) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch { /* ignore */ }
}

export function track(event, params = {}) {
  if (!analyticsEnabled()) return;
  (window.dataLayer = window.dataLayer || []).push({ event, ...params });
}
