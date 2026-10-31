// Ported from the original app's geocode()/reverseGeocode(). Open-Meteo's
// geocoding API is tried first (fast, global); Nominatim is the fallback
// for the search box, and is also used for reverse geocoding GPS fixes.

export interface GeocodeResult {
  lat: number;
  lon: number;
  label: string;
}

// Open-Meteo's geocoding API returns full region names in `admin1` (e.g.
// "Wyoming"), not postal codes — matching a 2-letter code against that
// field needs the code spelled out first.
const REGION_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick",
  NL: "Newfoundland and Labrador", NS: "Nova Scotia", NT: "Northwest Territories",
  NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec",
  SK: "Saskatchewan", YT: "Yukon",
};

interface OpenMeteoGeocodeResult {
  latitude: number;
  longitude: number;
  name: string;
  admin1?: string;
}

export async function geocode(query: string): Promise<GeocodeResult> {
  // Strip trailing state/country codes like ", AZ" or ", US" that confuse Open-Meteo.
  const cityOnly = query.replace(/,\s*[A-Za-z]{2}(\s*,.*)?$/, "").trim();

  try {
    const r = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityOnly)}&count=5&language=en&format=json`,
    );
    const d = await r.json();
    const results: OpenMeteoGeocodeResult[] = d.results ?? [];
    if (results.length) {
      const stateMatch = query.match(/,\s*([A-Za-z]{2})\b/);
      const stateCode = stateMatch?.[1]?.toUpperCase();
      const regionName = stateCode ? REGION_NAMES[stateCode] : undefined;
      const loc = regionName
        ? results.find((res) => res.admin1?.toLowerCase() === regionName.toLowerCase()) ?? results[0]
        : results[0];
      return {
        lat: loc.latitude,
        lon: loc.longitude,
        label: `${loc.name}${loc.admin1 ? ", " + loc.admin1 : ""}`,
      };
    }
  } catch {
    /* fall through to Nominatim */
  }

  const r2 = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
    { headers: { "Accept-Language": "en" } },
  );
  const d2 = await r2.json();
  if (!d2?.length) throw new Error("Location not found");
  const loc2 = d2[0];
  const parts: string[] = loc2.display_name.split(",").map((s: string) => s.trim());
  const city = parts[0];
  const admin = parts.find((p, i) => i > 0 && !p.toLowerCase().includes(city.toLowerCase())) ?? parts[1] ?? "";
  const label = admin ? `${city}, ${admin}` : city;
  return { lat: parseFloat(loc2.lat), lon: parseFloat(loc2.lon), label };
}

export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10`,
      { headers: { "Accept-Language": "en" } },
    );
    if (!r.ok) throw new Error("Nominatim error");
    const d = await r.json();
    const a = d.address ?? {};
    const city = a.city || a.town || a.village || a.municipality || a.county || "";
    const state = a.state_code || a.state || "";
    if (city && state) return `${city}, ${state}`;
    if (city) return city;
    return `${Math.abs(lat).toFixed(2)}°${lat < 0 ? "S" : "N"}`;
  } catch {
    return `${Math.abs(lat).toFixed(2)}°${lat < 0 ? "S" : "N"}`;
  }
}

/** Fallback location when there's no saved/active location and geolocation
 * is unavailable or denied — matches the original app's default. */
export const DEFAULT_LOCATION: GeocodeResult = {
  lat: 32.834,
  lon: -109.7076,
  label: "Safford, AZ",
};
