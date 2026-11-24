// Tiny opening_hours reader for the common OSM forms, e.g.
//   "24/7" | "Mo-Fr 08:00-18:00; Sa 09:00-14:00; Su off" | "Mo-Su 10:00-02:00"
// Returns true (open), false (closed) or null when the format is too complex to be sure.
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export function isOpenNow(spec, now = new Date()) {
  if (!spec) return null;
  const s = spec.trim();
  if (s === '24/7') return true;
  const today = (now.getDay() + 6) % 7; // Monday = 0
  const minutes = now.getHours() * 60 + now.getMinutes();
  const schedule = Array.from({ length: 7 }, () => null); // per day: list of [start, end]

  for (const rule of s.split(';').map((r) => r.trim()).filter(Boolean)) {
    const m = rule.match(/^((?:[A-Z][a-z](?:-[A-Z][a-z])?)(?:,(?:[A-Z][a-z](?:-[A-Z][a-z])?))*)?\s*(.*)$/);
    if (!m) return null;
    const days = m[1] ? expandDays(m[1]) : [0, 1, 2, 3, 4, 5, 6];
    if (!days) return null;
    const times = m[2].trim();
    let ranges;
    if (times === 'off' || times === 'closed') ranges = [];
    else {
      ranges = [];
      for (const t of times.split(',')) {
        const tm = t.trim().match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
        if (!tm) return null;
        ranges.push([+tm[1] * 60 + +tm[2], +tm[3] * 60 + +tm[4]]);
      }
    }
    for (const d of days) schedule[d] = ranges; // later rules override earlier ones
  }

  const check = (day, fromYesterday) => {
    for (const [a, b] of schedule[day] || []) {
      if (b <= a) { // past midnight
        if (fromYesterday ? minutes < b : minutes >= a) return true;
      } else if (!fromYesterday && minutes >= a && minutes < b) return true;
    }
    return false;
  };
  if (schedule.every((d) => d === null)) return null;
  return check(today, false) || check((today + 6) % 7, true);
}

function expandDays(str) {
  const out = [];
  for (const part of str.split(',')) {
    const [a, b] = part.split('-').map((d) => DAYS.indexOf(d));
    if (a < 0 || (b !== undefined && b < 0)) return null;
    if (b === undefined) out.push(a);
    else for (let i = a; ; i = (i + 1) % 7) { out.push(i); if (i === b) break; }
  }
  return out;
}
