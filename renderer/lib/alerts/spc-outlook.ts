import type { AlertGeometry } from "@/types/alerts";

const QUERY_URL =
  "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer/1/query";

interface OutlookProperties {
  dn: number;
  label: string; // e.g. "SLGT"
  label2: string; // e.g. "Slight Risk"
  stroke: string; // SPC's own official hex color for this category
  fill: string;
  valid: string; // bare UTC "YYYYMMDDHHmm", e.g. "202608121200"
  expire: string;
  issue: string;
}

interface OutlookFeatureRaw {
  type: "Feature";
  properties: OutlookProperties;
  geometry: AlertGeometry;
}

export interface SpcOutlookFeature {
  code: string;
  name: string;
  level: number;
  stroke: string;
  fill: string;
  valid: string;
  expire: string;
  issue: string;
  geometry: AlertGeometry;
}

/** SPC's outlook timestamps come back as bare UTC "YYYYMMDDHHmm" strings
 * (e.g. "202608121200"), not ISO — reconstruct a real timestamp so the rest
 * of the app (fmtTime, etc.) can treat these like any other alert time. */
function parseSpcTimestamp(raw: string): string {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return raw;
  const [, y, mo, d, h, mi] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi)).toISOString();
}

/**
 * SPC Day 1 Categorical Convective Outlook: Thunderstorm/Marginal/Slight/
 * Enhanced/Moderate/High risk polygons, reissued roughly five times a day.
 * Pulled from the same public NOAA ArcGIS MapServer family as the
 * Mesoscale Discussions in spc-md.ts. Unlike that layer (and the LibreWXR
 * alert-polygon layer), this one isn't fetched per-viewport bbox — the
 * whole CONUS layer is only ever a handful of polygons, so one unscoped
 * query covers every location at once.
 */
export async function fetchSpcCategoricalOutlook(): Promise<SpcOutlookFeature[]> {
  try {
    const res = await fetch(`${QUERY_URL}?where=1%3D1&outFields=*&f=geojson`);
    if (!res.ok) return [];
    const geo = await res.json();
    const features: OutlookFeatureRaw[] = geo.features ?? [];
    return features.map((f) => ({
      code: f.properties.label,
      name: f.properties.label2,
      level: f.properties.dn,
      stroke: f.properties.stroke,
      fill: f.properties.fill,
      valid: parseSpcTimestamp(f.properties.valid),
      expire: parseSpcTimestamp(f.properties.expire),
      issue: parseSpcTimestamp(f.properties.issue),
      geometry: f.geometry,
    }));
  } catch {
    return [];
  }
}

type Ring = [number, number][]; // GeoJSON [lon, lat] pairs

function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lon: number, lat: number, rings: Ring[]): boolean {
  const [exterior, ...holes] = rings;
  if (!exterior || !pointInRing(lon, lat, exterior)) return false;
  return !holes.some((hole) => pointInRing(lon, lat, hole));
}

/** Highest-tier outlook category whose polygon contains the given point, if
 * any. SPC's categories nest (the Slight Risk area sits entirely inside the
 * Marginal Risk area, which sits inside the Thunderstorm area, ...), so a
 * point can legitimately fall inside several of these polygons at once —
 * the highest `level` is the one that actually describes the risk there. */
export function findOutlookAtPoint(
  features: SpcOutlookFeature[],
  lat: number,
  lon: number,
): SpcOutlookFeature | null {
  let best: SpcOutlookFeature | null = null;
  for (const feature of features) {
    const geom = feature.geometry;
    if (!geom) continue;
    const contains =
      geom.type === "Polygon"
        ? pointInPolygon(lon, lat, geom.coordinates as Ring[])
        : geom.type === "MultiPolygon"
          ? (geom.coordinates as Ring[][]).some((rings) => pointInPolygon(lon, lat, rings))
          : false;
    if (contains && (!best || feature.level > best.level)) best = feature;
  }
  return best;
}
