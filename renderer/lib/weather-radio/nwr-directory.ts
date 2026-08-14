// noaaweatherradio.org publishes a public, unauthenticated directory of NWR
// transmitters (nationwide, no API key/account needed) backing their own
// "Radio Finder" tool — confirmed by fetching it directly. It's plain JS
// (`var data = {...};`), not JSON, so it's parsed by stripping that
// assignment rather than executed (never eval a third-party script).
const DIRECTORY_URL = "https://noaaweatherradio.org/NWR-radio-finder-data.js";

interface NwrDirectoryData {
  // state -> city -> "CALLSIGN|STATE|CITY|LAT|LON|FREQ|POWER|STATUS|COVERAGE|SOURCE|MOUNTNAME"
  radios: Record<string, Record<string, string>>;
  // callsign -> ["WRO|ON|N|https://wxradio.org/MOUNT|Provider Name|Provider URL|date", ...]
  // Only callsigns present here, with status "ON", actually have a live
  // relay stream — most of the ~1400 transmitters in `radios` don't.
  inservice: Record<string, string[]>;
}

export interface NwrFeed {
  callsign: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
  coverage: string;
  streamUrl: string;
  provider: string;
}

let cached: Promise<NwrFeed[]> | null = null;

async function parseDirectory(): Promise<NwrFeed[]> {
  const r = await fetch(DIRECTORY_URL);
  if (!r.ok) throw new Error(`NWR directory fetch failed: ${r.status}`);
  const text = await r.text();
  const jsonText = text.replace(/^\s*var\s+data\s*=\s*/, "").replace(/;\s*$/, "");
  const data: NwrDirectoryData = JSON.parse(jsonText);

  const feeds: NwrFeed[] = [];
  for (const cities of Object.values(data.radios)) {
    for (const raw of Object.values(cities)) {
      const parts = raw.split("|");
      const callsign = parts[0];
      const inservice = data.inservice[callsign]?.[0];
      if (!inservice) continue;
      const [, status, , streamUrl, provider] = inservice.split("|");
      if (status !== "ON" || !streamUrl) continue;
      feeds.push({
        callsign,
        state: parts[1],
        city: parts[2],
        lat: Number(parts[3]),
        lon: Number(parts[4]),
        coverage: parts[8] ?? parts[2],
        streamUrl,
        provider: provider || "Volunteer relay",
      });
    }
  }
  return feeds;
}

/** Fetched once and cached for the process lifetime — the directory changes
 * on noaaweatherradio.org's own schedule (they regenerate it periodically),
 * not something this app needs to poll for. */
function fetchNwrDirectory(): Promise<NwrFeed[]> {
  if (!cached) cached = parseDirectory().catch((err) => {
    cached = null;
    throw err;
  });
  return cached;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface NearestNwrFeed {
  feed: NwrFeed;
  distanceKm: number;
}

/** Finds the closest confirmed-live NWR relay to a given point, out of the
 * ~120 transmitters noaaweatherradio.org's directory currently lists as
 * actually streaming (out of ~1400 total transmitters nationwide — most
 * don't have a volunteer relay at all, so "nearest" can occasionally still
 * be quite far away, especially outside the contiguous US). Returns null
 * only if the directory itself is unreachable or empty. */
export async function findNearestLiveNwrFeed(lat: number, lon: number): Promise<NearestNwrFeed | null> {
  const feeds = await fetchNwrDirectory();
  if (feeds.length === 0) return null;
  let best: NearestNwrFeed | null = null;
  for (const feed of feeds) {
    const distanceKm = haversineKm(lat, lon, feed.lat, feed.lon);
    if (!best || distanceKm < best.distanceKm) best = { feed, distanceKm };
  }
  return best;
}
