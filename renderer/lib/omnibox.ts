// The omnibox's query understanding + place search. Free text like "is it
// raining at the Eiffel Tower?", "weather in Paris tomorrow", "40.71, -74.0"
// or "near me" is first reduced to an intent (see parseOmniboxQuery), then
// place intents are resolved against:
//
//  - Photon (photon.komoot.io, OpenStreetMap data) for live, as-you-type
//    suggestions — built for autocomplete, and indexes landmarks, POIs,
//    parks, airports, and street addresses, not just cities.
//  - Nominatim, only for an explicit Enter with nothing better to pick —
//    its usage policy forbids autocomplete, so it's never hit per keystroke.

export type PlaceKind =
  | "city"
  | "region"
  | "landmark"
  | "nature"
  | "park"
  | "airport"
  | "education"
  | "address"
  | "street"
  | "water"
  | "place";

export interface PlaceSuggestion {
  id: string;
  lat: number;
  lon: number;
  /** Short, human label — becomes the active location's label. */
  label: string;
  /** Surrounding context ("Paris, Île-de-France, France"). */
  subtitle: string;
  kind: PlaceKind;
}

export type OmniboxIntent =
  | { kind: "empty" }
  | { kind: "gps"; raw: string }
  | { kind: "coords"; raw: string; lat: number; lon: number }
  | { kind: "place"; raw: string; query: string };

// ── Query understanding ─────────────────────────────────────────────────

const GPS_PHRASE =
  /^(?:near me|nearby|here|right here|my location|current location|my current location|where i am|around me|around here|my area|locate me|me)$/i;

// Conversational lead-ins ("what's", "show me", "is it", "the") — stripped
// repeatedly until nothing more matches.
const LEAD_IN =
  /^(?:what(?:'s|s| is| was| will)?|how(?:'s|s| is)?|show(?: me)?|get(?: me)?|give me|check|find|go to|take me to|search(?: for)?|look up|jump to|open|is it|is there|will it|will there be|does it|should i|when will it|any|the|a|an)\s+/i;

// Weather nouns that can open a query on their own ("radar Denver",
// "forecast for Tulsa").
const WEATHER_NOUN =
  /^(?:current\s+)?(?:weather|forecast|radar|conditions|temps?|temperature|alerts?|warnings?|outlook|sunrise|sunset|humidity|uv)(?:\s+(?:like|be|look(?:ing)?(?: like)?|report|map))?\s+/i;

// Weather verbs/adjectives are only stripped when a preposition follows —
// otherwise "Hot Springs" or "Rainier" would lose their first word.
const WEATHER_WORD_WITH_PREP =
  /^(?:(?:going to|gonna)\s+)?(?:rain(?:ing|y)?|snow(?:ing|y)?|storm(?:ing|s|y)?|hail(?:ing)?|thunder(?:storms?|ing)?|wind(?:y)?|sunny|cloudy|foggy|hot|cold|warm|freezing|nice|clear|flooding|tornado(?:es)?|hurricanes?|like|be)\s+(?=(?:in|at|for|near|around|over|by|on|out)\b)/i;

const PREPOSITION = /^(?:in|at|for|near|around|over|by|on|of|out(?:\s+(?:in|at))?)\s+/i;

const TRAILING =
  /\s+(?:weather|forecast|radar|conditions|temperature|temps?|alerts?|right now|now|currently|today|tonight|tomorrow(?: (?:morning|afternoon|night))?|this (?:week|weekend|morning|afternoon|evening)|next (?:week|weekend)|later|please)$/i;

/** Reduces free text to what should actually be geocoded. Exported for the
 * "Searching for …" hint the omnibox shows when it rewrote the query. */
export function extractPlaceQuery(raw: string): string {
  let q = raw.trim().replace(/[?!.]+$/, "").trim();
  for (let i = 0; i < 12; i++) {
    const before = q;
    q = q
      .replace(LEAD_IN, "")
      .replace(WEATHER_NOUN, "")
      .replace(WEATHER_WORD_WITH_PREP, "")
      .replace(PREPOSITION, "")
      .replace(TRAILING, "")
      .replace(/[?!.,]+$/, "")
      .trim();
    if (q === before) break;
  }
  return q;
}

function parseCoords(raw: string): { lat: number; lon: number } | null {
  // A pasted map URL ("…/@40.7128,-74.0060,12z").
  const url = raw.match(/@(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (url) return validCoords(Number(url[1]), Number(url[2]));

  // "40.7128, -74.0060" · "40.7128 -74.0060" · "40.71°N 74.00°W" · "40.7N, 74W"
  const m = raw
    .trim()
    .match(/^(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])?\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  let lat = Number(m[1]);
  let lon = Number(m[3]);
  if (m[2]?.toUpperCase() === "S") lat = -Math.abs(lat);
  if (m[4]?.toUpperCase() === "W") lon = -Math.abs(lon);
  return validCoords(lat, lon);
}

function validCoords(lat: number, lon: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export function parseOmniboxQuery(raw: string): OmniboxIntent {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "empty" };
  const coords = parseCoords(trimmed);
  if (coords) return { kind: "coords", raw: trimmed, ...coords };
  const query = extractPlaceQuery(trimmed);
  if (!query || GPS_PHRASE.test(query) || GPS_PHRASE.test(trimmed)) return { kind: "gps", raw: trimmed };
  return { kind: "place", raw: trimmed, query };
}

export function formatCoords(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(3)}°${lat < 0 ? "S" : "N"}, ${Math.abs(lon).toFixed(3)}°${lon < 0 ? "W" : "E"}`;
}

// ── Photon (live suggestions) ───────────────────────────────────────────

interface PhotonProperties {
  osm_id?: number;
  osm_type?: string;
  osm_key?: string;
  osm_value?: string;
  type?: string;
  name?: string;
  housenumber?: string;
  street?: string;
  city?: string;
  district?: string;
  county?: string;
  state?: string;
  country?: string;
  countrycode?: string;
  postcode?: string;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: PhotonProperties;
}

const CITY_VALUES = new Set(["city", "town", "village", "hamlet", "suburb", "neighbourhood", "quarter", "borough", "municipality", "locality"]);
const REGION_VALUES = new Set(["state", "country", "county", "region", "province", "island", "archipelago"]);

function kindOf(key = "", value = "", type = ""): PlaceKind {
  if (key === "place" && CITY_VALUES.has(value)) return "city";
  if ((key === "place" || key === "boundary") && REGION_VALUES.has(value)) return "region";
  if (type === "state" || type === "country" || type === "county") return "region";
  if (type === "city" || type === "district" || type === "locality") return "city";
  if (key === "aeroway") return "airport";
  if (key === "natural" && /water|bay|lake|strait|spring/.test(value)) return "water";
  if (key === "waterway" || key === "water") return "water";
  if (key === "natural") return "nature";
  if (key === "leisure" || key === "boundary") return "park";
  if (key === "amenity" && /university|college|school/.test(value)) return "education";
  if (key === "tourism" || key === "historic" || key === "man_made" || key === "amenity" || key === "building")
    return "landmark";
  if (key === "highway") return "street";
  if (type === "house" || key === "place" && value === "house") return "address";
  if (type === "street") return "street";
  return "place";
}

const uniq = (parts: (string | undefined)[]) =>
  parts.filter((p, i, all): p is string => Boolean(p) && all.indexOf(p) === i);

function fromPhoton(f: PhotonFeature): PlaceSuggestion | null {
  const p = f.properties;
  const [lon, lat] = f.geometry.coordinates;
  const kind = kindOf(p.osm_key, p.osm_value, p.type);
  const locality = p.city ?? p.district ?? p.county;
  const name =
    kind === "address" && p.street ? uniq([p.housenumber, p.street]).join(" ") : (p.name ?? p.street ?? locality);
  if (!name) return null;

  // Cities read best as "Tucson, Arizona"; everything smaller than a city
  // reads best anchored to the city it's in ("Eiffel Tower, Paris").
  const anchor = kind === "city" || kind === "region" ? (p.state ?? p.country) : (locality ?? p.state ?? p.country);
  const label = anchor && anchor !== name ? `${name}, ${anchor}` : name;
  const subtitle = uniq([kind === "city" || kind === "region" ? undefined : locality, p.state, p.country])
    .filter((s) => s !== name)
    .join(", ");

  return { id: `photon:${p.osm_type ?? ""}${p.osm_id ?? `${lat},${lon}`}`, lat, lon, label, subtitle, kind };
}

function dedupe(places: PlaceSuggestion[]): PlaceSuggestion[] {
  const kept: PlaceSuggestion[] = [];
  for (const pl of places) {
    // The same landmark often appears as several OSM objects (a node, the
    // building around it, a park polygon) a few hundred metres to a few km
    // apart — same label within ~5 km is the same place to a user.
    const dup = kept.some(
      (k) =>
        k.label.toLowerCase() === pl.label.toLowerCase() &&
        Math.abs(k.lat - pl.lat) < 0.05 &&
        Math.abs(k.lon - pl.lon) < 0.05,
    );
    if (!dup) kept.push(pl);
  }
  return kept;
}

export async function suggestPlaces(
  query: string,
  opts: { signal?: AbortSignal; near?: { lat: number; lon: number } | null; limit?: number } = {},
): Promise<PlaceSuggestion[]> {
  const params = new URLSearchParams({ q: query, limit: String(opts.limit ?? 8), lang: "en" });
  if (opts.near) {
    // Gently prefers results near what's already on screen — "Springfield"
    // should resolve to the nearby one first — without hiding far matches.
    params.set("lat", opts.near.lat.toFixed(3));
    params.set("lon", opts.near.lon.toFixed(3));
    params.set("location_bias_scale", "0.3");
  }
  const r = await fetch(`https://photon.komoot.io/api/?${params}`, { signal: opts.signal });
  if (!r.ok) throw new Error(`Photon ${r.status}`);
  const d = (await r.json()) as { features?: PhotonFeature[] };
  return dedupe((d.features ?? []).map(fromPhoton).filter((p): p is PlaceSuggestion => p !== null));
}

// ── Nominatim (explicit deep search) ────────────────────────────────────

interface NominatimResult {
  place_id: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  category?: string;
  type?: string;
  addresstype?: string;
  address?: Record<string, string>;
}

export async function deepSearchPlaces(query: string, signal?: AbortSignal): Promise<PlaceSuggestion[]> {
  const params = new URLSearchParams({ q: query, format: "jsonv2", limit: "6", addressdetails: "1" });
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    signal,
    headers: { "Accept-Language": "en" },
  });
  if (!r.ok) throw new Error(`Nominatim ${r.status}`);
  const results = (await r.json()) as NominatimResult[];
  return dedupe(
    results.map((res) => {
      const a = res.address ?? {};
      const kind = kindOf(res.category, res.type, res.addresstype);
      const name = res.name || res.display_name.split(",")[0].trim();
      const locality = a.city || a.town || a.village || a.municipality || a.county;
      const anchor = kind === "city" || kind === "region" ? (a.state ?? a.country) : (locality ?? a.state ?? a.country);
      return {
        id: `nominatim:${res.place_id}`,
        lat: Number(res.lat),
        lon: Number(res.lon),
        label: anchor && anchor !== name ? `${name}, ${anchor}` : name,
        subtitle: uniq([kind === "city" ? undefined : locality, a.state, a.country])
          .filter((s) => s !== name)
          .join(", "),
        kind,
      };
    }),
  );
}

// ── Recents ─────────────────────────────────────────────────────────────

const RECENTS_KEY = "silverskies.omnibox.recent";
const MAX_RECENTS = 6;

export function loadRecentPlaces(): PlaceSuggestion[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as PlaceSuggestion[]).slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

export function rememberRecentPlace(place: PlaceSuggestion): PlaceSuggestion[] {
  const next = [
    place,
    ...loadRecentPlaces().filter(
      (p) => p.id !== place.id && !(p.label === place.label && Math.abs(p.lat - place.lat) < 0.01),
    ),
  ].slice(0, MAX_RECENTS);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Non-critical.
  }
  return next;
}

export const PLACE_KIND_META: Record<PlaceKind, { icon: string; label: string }> = {
  city: { icon: "buildings", label: "City" },
  region: { icon: "map-trifold", label: "Region" },
  landmark: { icon: "flag-banner", label: "Landmark" },
  nature: { icon: "mountains", label: "Nature" },
  park: { icon: "tree", label: "Park" },
  airport: { icon: "airplane-tilt", label: "Airport" },
  education: { icon: "graduation-cap", label: "Campus" },
  address: { icon: "house-line", label: "Address" },
  street: { icon: "road-horizon", label: "Street" },
  water: { icon: "waves", label: "Water" },
  place: { icon: "map-pin", label: "Place" },
};
