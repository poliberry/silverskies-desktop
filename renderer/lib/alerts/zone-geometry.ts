import type { AlertGeometry, NormalizedAlert } from "@/types/alerts";

// Zone boundaries never move — caching by URL for the life of the app avoids
// re-fetching the same county/zone shape for every alert that references it
// (a single Winter Storm Watch can span dozens of counties, and many alerts
// share the same zones across refetches).
const zoneCache = new Map<string, AlertGeometry | null>();

// Bounds the fan-out for a single alert covering an unusually large number
// of zones (e.g. a statewide advisory) — the goal is "renders somewhere
// reasonable," not a pixel-perfect union of every affected county.
const MAX_ZONES_PER_ALERT = 30;

async function fetchZoneGeometry(url: string): Promise<AlertGeometry | null> {
  if (zoneCache.has(url)) return zoneCache.get(url) ?? null;
  let result: AlertGeometry | null = null;
  try {
    const r = await fetch(url, { headers: { Accept: "application/geo+json" } });
    if (r.ok) {
      const d = await r.json();
      if (d.geometry) result = d.geometry as AlertGeometry;
    }
  } catch {
    // Left as null — this zone just won't contribute to the combined shape.
  }
  zoneCache.set(url, result);
  return result;
}

/** Flattens any mix of Polygon/MultiPolygon zone shapes into one MultiPolygon's
 * coordinate rings, so the result still fits `AlertGeometry`'s loose shape. */
function combineZoneGeometries(geometries: AlertGeometry[]): AlertGeometry | null {
  const rings: unknown[] = [];
  for (const g of geometries) {
    if (g.type === "Polygon") rings.push(g.coordinates);
    else if (g.type === "MultiPolygon") rings.push(...(g.coordinates as unknown[]));
  }
  if (!rings.length) return null;
  return { type: "MultiPolygon", coordinates: rings };
}

/**
 * Fills in `geometry` for alerts that came back with none (typical of
 * zone/county-based products like Heat Watches/Advisories) by resolving and
 * combining their `affectedZones` boundary shapes. Alerts that already have
 * geometry, or have neither geometry nor affected zones, pass through
 * unchanged.
 */
export async function fillMissingGeometry(alerts: NormalizedAlert[]): Promise<NormalizedAlert[]> {
  return Promise.all(
    alerts.map(async (a) => {
      if (a.geometry) return a;
      const zones = a.affectedZones?.slice(0, MAX_ZONES_PER_ALERT);
      if (!zones?.length) return a;

      const results = await Promise.allSettled(zones.map(fetchZoneGeometry));
      const resolved = results
        .filter((r): r is PromiseFulfilledResult<AlertGeometry | null> => r.status === "fulfilled")
        .map((r) => r.value)
        .filter((g): g is AlertGeometry => g !== null);

      const combined = combineZoneGeometries(resolved);
      return combined ? { ...a, geometry: combined } : a;
    }),
  );
}
