import type { NormalizedAlert } from "@/types/alerts";
import { resolveAlertColor } from "./color.client";
import { getPulseColorForClass, isAirQualityEvent } from "./classify";
import { fetchBomAlerts, isAustralia } from "./willyweather";
import { fetchEcccAlerts, isCanada } from "./eccc";
import { fetchLibreWxrAlerts, type BBox } from "./librewxr";
import { fetchNwsAlerts } from "./nws";
import { fetchSpcMdAlerts } from "./spc-md";

const SEVERITY_RANK: Record<string, number> = {
  Extreme: 0,
  Severe: 1,
  Moderate: 2,
  Minor: 3,
  Unknown: 4,
};

/** Cross-source de-dupe key — exported so callers merging additional alert
 * feeds outside fetchMergedAlerts (e.g. the radar map's polygon layer) can
 * dedupe against these results the same way. */
export function dedupeKey(a: NormalizedAlert): string {
  return `${a.event}|${a.areaDesc ?? ""}|${a.onset ?? ""}`.toLowerCase();
}

const NWS_LAT_RANGE: [number, number] = [15, 72];
const NWS_LON_RANGE: [number, number] = [-180, -60];

function inNwsCoverage(lat: number, lon: number): boolean {
  return lat >= NWS_LAT_RANGE[0] && lat <= NWS_LAT_RANGE[1] && lon >= NWS_LON_RANGE[0] && lon <= NWS_LON_RANGE[1];
}

/**
 * Audit-log alert feed for a location: NWS + ECCC + BOM (via WillyWeather,
 * official BOM data — richer metadata) merged with LibreWXR's global WMO
 * CAP/MeteoAlarm feed for everywhere outside their coverage, de-duped by
 * event+area+onset, sorted most-severe/most-recent first.
 */
export async function fetchMergedAlerts(
  lat: number,
  lon: number,
  libreWxrHost: string,
  willyWeatherApiKey: string | null = null,
): Promise<NormalizedAlert[]> {
  const isCa = isCanada(lat, lon);
  const isUs = inNwsCoverage(lat, lon);
  const isAu = isAustralia(lat, lon);
  const buffer = 1.5;
  const bbox: BBox = [lon - buffer, lat - buffer, lon + buffer, lat + buffer];

  const tasks: Promise<NormalizedAlert[]>[] = [fetchNwsAlerts(lat, lon)];
  if (isCa) tasks.push(fetchEcccAlerts(lat, lon));
  if (isAu) tasks.push(fetchBomAlerts(lat, lon, willyWeatherApiKey));
  if (isUs) tasks.push(fetchSpcMdAlerts(bbox));
  // LibreWXR is the global fallback for everywhere NWS/ECCC don't cover —
  // including Australia when there's no WillyWeather key configured, since
  // fetchBomAlerts silently no-ops without one and would otherwise leave
  // those locations with zero alerts. Dedup below handles any overlap once
  // a key *is* configured.
  if (!isUs && !isCa && (!isAu || !willyWeatherApiKey)) tasks.push(fetchLibreWxrAlerts(libreWxrHost, bbox));

  const results = await Promise.allSettled(tasks);
  const all = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

  const seen = new Set<string>();
  const deduped: NormalizedAlert[] = [];
  for (const alert of all) {
    const key = dedupeKey(alert);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(alert);
  }

  deduped.sort((a, b) => {
    const rankA = SEVERITY_RANK[a.severity ?? "Unknown"] ?? 4;
    const rankB = SEVERITY_RANK[b.severity ?? "Unknown"] ?? 4;
    if (rankA !== rankB) return rankA - rankB;
    return (b.onset ?? "").localeCompare(a.onset ?? "");
  });

  return deduped;
}

/**
 * The full-window severe pulse — ported from the original app's
 * getPulseColorForClass()-driven applyPulse(), then broadened: a first pass
 * still prefers the original's narrow, hazard-specific colors (tornado
 * emergency, hurricane warning, …) so those keep their exact look, but any
 * *other* Extreme/Severe alert now also pulses, using whatever color its
 * own classification resolves to. AQHI "red" readings are excluded either
 * way — that's a health-risk scale, not severe-weather urgency.
 */
export function activeSeverePulseColor(alerts: NormalizedAlert[]): string | null {
  const eligible = alerts.filter((a) => !isAirQualityEvent(a.event));

  for (const alert of eligible) {
    const color = getPulseColorForClass(alert.cssClass);
    if (color) return color;
  }
  for (const alert of eligible) {
    if (alert.severity === "Extreme" || alert.severity === "Severe") {
      return resolveAlertColor(alert.cssClass);
    }
  }
  return null;
}
