// RFID toll balances (Easytrip, Autosweep) entered by the user, with learned toll amounts.
// Stored on this device only.
const KEY = 'neonnav:wallet';

// Colours sampled from the reference design. glyph = original icon drawn for this app;
// logo = optional image in public/logos/ that replaces the glyph if you add one.
export const ACCOUNTS = {
  easytrip: {
    label: 'Easytrip',
    color: '#b18cda',
    logo: 'logos/easytrip.png',
    // three "fast lane" speed lines forming an E
    glyph: '<path d="M7 6.5h10M7 12h7.5M7 17.5h10M7 6.5v11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  autosweep: {
    label: 'Autosweep',
    color: '#69c979',
    logo: 'logos/autosweep.png',
    // a sweeping arc with an arrowhead
    glyph: '<path d="M17.5 8.5A6.5 6.5 0 1 0 18.5 13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M14.2 8.6h3.6V5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  },
};

const blank = () => ({
  balances: { easytrip: null, autosweep: null },
  tolls: {}, // tripKey -> { amount, account, label }
  roads: {}, // road name -> account (last used)
  history: [], // { t, account, delta, note }
});

function load() {
  try {
    const w = JSON.parse(localStorage.getItem(KEY));
    return w ? { ...blank(), ...w, balances: { ...blank().balances, ...w.balances } } : blank();
  } catch {
    return blank();
  }
}
let wallet = load();
const listeners = new Set();
export const onWalletChange = (fn) => listeners.add(fn);

function save(change) {
  try {
    localStorage.setItem(KEY, JSON.stringify(wallet));
  } catch { /* storage full */ }
  listeners.forEach((fn) => fn(wallet, change));
}

export const getWallet = () => wallet;
export const hasAnyBalance = () => Object.values(wallet.balances).some((b) => b != null);

const round2 = (n) => Math.round(n * 100) / 100;

function log(account, delta, note) {
  wallet.history.unshift({ t: Date.now(), account, delta: round2(delta), note });
  wallet.history = wallet.history.slice(0, 50);
}

export function setBalance(account, value) {
  const before = wallet.balances[account];
  const v = value === null || value === '' ? null : round2(Number(value));
  if (v !== null && !Number.isFinite(v)) return;
  wallet.balances[account] = v;
  if (v !== null) log(account, before == null ? v : v - before, 'Balance set');
  save({ account, delta: before == null || v == null ? 0 : v - before });
}

export function addBalance(account, amount, note = 'Reload') {
  const a = round2(Number(amount));
  if (!Number.isFinite(a) || a === 0) return;
  wallet.balances[account] = round2((wallet.balances[account] || 0) + a);
  log(account, a, note);
  save({ account, delta: a });
}

export function deduct(account, amount, note) {
  addBalance(account, -Math.abs(amount), note);
}

export const getToll = (key) => wallet.tolls[key] || null;

/** rec = { amount, account, label, entry: [lng,lat], exit: [lng,lat] } */
export function learnToll(key, rec) {
  wallet.tolls[key] = { ...rec, amount: round2(Number(rec.amount)) };
  save({});
}

/** A learned trip whose entry and exit are both within `radius` metres (sampling isn't exact). */
export function findToll(entry, exit, distFn, radius = 2000) {
  for (const [key, t] of Object.entries(wallet.tolls)) {
    if (t.entry && t.exit && distFn(t.entry, entry) < radius && distFn(t.exit, exit) < radius) return { key, ...t };
  }
  return null;
}

export function forgetToll(key) {
  delete wallet.tolls[key];
  save({});
}

export function rememberRoad(names, account) {
  for (const n of names) wallet.roads[n] = account;
  save({});
}

export const roadAccount = (names) => names.map((n) => wallet.roads[n]).find(Boolean) || null;

export const fmtPeso = (n) =>
  n == null ? '—' : `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
