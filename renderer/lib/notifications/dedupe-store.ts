// Persists "already notified" keys in localStorage (survives app restarts,
// scoped to this Electron profile) so the same alert/forecast/severe-weather
// heads-up doesn't re-fire every time the background watcher's interval
// ticks. Entries age out on their own — no explicit "clear" needed.
const STORAGE_KEY = "ss-notified-v1";
const MAX_AGE_MS = 26 * 3_600_000; // a little over a day — covers once-daily keys with margin

interface Entry {
  key: string;
  at: number;
}

function readAll(): Entry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Entry[]) : [];
  } catch {
    return [];
  }
}

function writeAll(entries: Entry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* storage full/unavailable — notifications just won't dedupe across restarts */
  }
}

export function hasNotified(key: string): boolean {
  return readAll().some((e) => e.key === key);
}

export function markNotified(key: string): void {
  const now = Date.now();
  const entries = readAll().filter((e) => now - e.at < MAX_AGE_MS);
  entries.push({ key, at: now });
  writeAll(entries);
}
