import type { AlertGeometry, NormalizedAlert } from "@/types/alerts";

// Zone boundaries never move — caching by URL for the life of the app avoids
// re-fetching the same county/zone shape for every alert that references it
// (a single Winter Storm Watch can span dozens of counties, and many alerts
// share the same zones across refetches).
// Only successful lookups are cached — a transient failure or a 5xx
// shouldn't permanently blank a zone out for the rest of the session, so
// misses are never written here and simply get retried on the next call.
const zoneCache = new Map<string, AlertGeometry>();

// Bounds the fan-out for a single alert covering an unusually large number
// of zones (e.g. a statewide advisory) — the goal is "renders somewhere
// reasonable," not a pixel-perfect union of every affected county.
const MAX_ZONES_PER_ALERT = 30;

async function fetchZoneGeometry(url: string): Promise<AlertGeometry | null> {
  const cached = zoneCache.get(url);
  if (cached) return cached;
  try {
    const r = await fetch(url, { headers: { Accept: "application/geo+json" } });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.geometry) return null;
    const geometry = d.geometry as AlertGeometry;
    zoneCache.set(url, geometry);
    return geometry;
  } catch {
    return null;
  }
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
