// Export / import everything the app stores on this device (map progress, saved places,
// RFID balances, settings) as a single JSON file.
const PREFIX = 'neonnav:';

export function exportData() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(PREFIX)) data[k] = localStorage.getItem(k);
  }
  return { app: 'neonnav', version: 1, exportedAt: new Date().toISOString(), data };
}

/** Save the backup: share sheet if available, else a download, else copy to clipboard. */
export async function saveBackup() {
  const json = JSON.stringify(exportData());
  const name = `neonnav-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'NeonNav backup' });
      return 'shared';
    }
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';
  }
  try {
    const url = URL.createObjectURL(file);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return 'downloaded';
  } catch { /* fall through */ }
  await navigator.clipboard.writeText(json);
  return 'copied';
}

/** Restore from a backup file's text. Returns the number of entries restored. */
export function importData(text) {
  const parsed = JSON.parse(text);
  if (parsed?.app !== 'neonnav' || typeof parsed.data !== 'object') throw new Error('Not a NeonNav backup file');
  let n = 0;
  for (const [k, v] of Object.entries(parsed.data)) {
    if (k.startsWith(PREFIX) && typeof v === 'string') {
      localStorage.setItem(k, v);
      n++;
    }
  }
  return n;
}
