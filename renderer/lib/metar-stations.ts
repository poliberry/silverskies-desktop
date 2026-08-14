import type { MetarObservation, MetarStation } from "@/types/metar-stations";

// Same keyless api.weather.gov host as lib/radar-stations.ts — the
// descriptive User-Agent it (and every other api.weather.gov call) needs is
// injected globally by electron/main.ts's registerUserAgentHeader, not set
// here. Unlike /radar/stations, this list endpoint has no bbox filter, so
// the full ~2000+-station ASOS/AWOS network is paginated in here once and
// cached long-term (see useMetarStations) — bounds filtering happens
// client-side, in useMetarObservations.
const STATIONS_URL = "https://api.weather.gov/stations?limit=500";

interface MetarStationFeature {
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    stationIdentifier: string;
    name: string;
  };
}

interface StationListPage {
  features: MetarStationFeature[];
  pagination?: { next?: string };
}

export async function fetchMetarStationList(): Promise<MetarStation[]> {
  const stations: MetarStation[] = [];
  let url: string | undefined = STATIONS_URL;
  // A hard page cap, not just "follow `next` until absent" — a malformed or
  // unexpectedly endless pagination chain shouldn't be able to turn one
  // toggle into an unbounded fetch loop.
  for (let page = 0; page < 20 && url; page++) {
    const r: Response = await fetch(url, { headers: { Accept: "application/geo+json" } });
    if (!r.ok) break;
    const d: StationListPage = await r.json();
    for (const f of d.features ?? []) {
      stations.push({
        id: f.properties.stationIdentifier,
        name: f.properties.name,
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
      });
    }
    url = d.pagination?.next;
  }
  return stations;
}

interface MetarObservationResponse {
  properties: {
    stationId: string;
    timestamp: string | null;
    windDirection: { value: number | null };
    windSpeed: { value: number | null };
    windGust: { value: number | null };
  };
}

const KMH_TO_KT = 0.539957;

export async function fetchMetarObservation(stationId: string): Promise<MetarObservation | null> {
  const r = await fetch(`https://api.weather.gov/stations/${stationId}/observations/latest`, {
    headers: { Accept: "application/geo+json" },
  });
  if (!r.ok) return null;
  const d: MetarObservationResponse = await r.json();
  const p = d.properties;
  return {
    stationId: p.stationId,
    windDirectionDeg: p.windDirection?.value ?? null,
    windSpeedKt: p.windSpeed?.value != null ? p.windSpeed.value * KMH_TO_KT : null,
    windGustKt: p.windGust?.value != null ? p.windGust.value * KMH_TO_KT : null,
    timestamp: p.timestamp ?? null,
  };
}
