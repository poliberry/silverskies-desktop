import type { RadarStation } from "@/types/radar-stations";

// Official, keyless NWS API — https://api.weather.gov/radar/stations.
// Filtered to WSR-88D (the actual NEXRAD network) so every marker this
// produces has a real, clickable single-site radar behind it; the same
// endpoint also lists TDWR (airport terminal doppler) and wind-profiler
// sites, which aren't part of NCEP's RIDGE II single-site product set below
// and would otherwise be dead clicks.
const STATIONS_URL = "https://api.weather.gov/radar/stations?stationType=WSR-88D";

interface RadarStationFeature {
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    id: string;
    name: string;
    elevation?: { value: number };
    latency?: { levelTwoLastReceivedTime?: string };
    rda?: {
      properties?: {
        volumeCoveragePattern?: string;
        operabilityStatus?: string;
        alarmSummary?: string;
      };
    };
  };
}

function parseVcp(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

export async function fetchRadarStations(): Promise<RadarStation[]> {
  const r = await fetch(STATIONS_URL, { headers: { Accept: "application/geo+json" } });
  if (!r.ok) throw new Error(`radar/stations error ${r.status}`);
  const d = await r.json();
  const features: RadarStationFeature[] = d.features ?? [];
  return features.map((f): RadarStation => {
    const p = f.properties;
    const rda = p.rda?.properties;
    return {
      id: p.id,
      name: p.name,
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      elevationM: p.elevation?.value ?? null,
      vcp: parseVcp(rda?.volumeCoveragePattern),
      operabilityStatus: rda?.operabilityStatus ?? null,
      alarmSummary: rda?.alarmSummary ?? null,
      lastReceivedTime: p.latency?.levelTwoLastReceivedTime ?? null,
    };
  });
}

/** Standard published WSR-88D Volume Coverage Patterns — not exhaustive,
 * just the commonly-encountered ones; an unrecognized code still shows
 * plainly as "VCP {n}" rather than guessing. */
const VCP_LABELS: Record<number, string> = {
  11: "Precipitation (Legacy)",
  12: "Precipitation",
  21: "Precipitation",
  31: "Clear Air (Long Pulse)",
  32: "Clear Air",
  35: "Clear Air",
  112: "Precipitation",
  121: "Precipitation",
  212: "Precipitation",
  215: "Precipitation",
};

export function vcpLabel(vcp: number | null): string {
  if (vcp === null) return "Unknown";
  return VCP_LABELS[vcp] ?? `VCP ${vcp}`;
}

/** VCPs that splice in supplemental low-level scans (SAILS / MESO-SAILS)
 * between the rest of a volume scan, for faster low-level updates — the
 * closest real, documented NEXRAD concept to a "FastScan" mode. */
const SAILS_VCPS = new Set([112, 212, 215]);

export function hasSails(vcp: number | null): boolean {
  return vcp !== null && SAILS_VCPS.has(vcp);
}

// A radar counts as actively "Live" if Level II data was received recently
// — offline/lagging radars fall back to showing their last-known scan time
// instead of a live badge that isn't true.
const LIVE_THRESHOLD_MS = 15 * 60_000;

export function isStationLive(lastReceivedTime: string | null): boolean {
  if (!lastReceivedTime) return false;
  return Date.now() - new Date(lastReceivedTime).getTime() < LIVE_THRESHOLD_MS;
}
