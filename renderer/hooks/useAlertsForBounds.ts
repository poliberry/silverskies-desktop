import { useQuery } from "@tanstack/react-query";
import { fetchLibreWxrAlerts, type BBox } from "@/lib/alerts/librewxr";
import { fetchSpcMdAlerts } from "@/lib/alerts/spc-md";
import { fetchMergedAlerts, dedupeKey, SEVERITY_RANK } from "@/lib/alerts/merge";
import { useSettings } from "./useSettings";
import type { NormalizedAlert } from "@/types/alerts";

/** Leaflet's own bounds aren't wrapped to ±180 — a viewport panned across
 * the antimeridian can hand back e.g. west=170, east=200 instead of
 * east=-160. Averaging those *raw* values first is what makes the
 * wraparound center come out right (170 & 200 average to 185, the true
 * center of that span); wrapping each end into ±180 independently before
 * averaging would give a nonsense center on the wrong side of the world
 * instead. So this only ever wraps the *final* center value — see its one
 * call site below. */
function normalizeLon(lon: number): number {
  let l = lon % 360;
  if (l > 180) l -= 360;
  if (l < -180) l += 360;
  return l;
}

/** Merged alert feed for a map viewport (or a user-drawn selection within
 * one) instead of a single point — powers the audit log's "show what's on
 * the radar" view. Same three-source merge AlertPolygonsLayer already uses
 * to paint alert polygons on the map: the two bbox-native feeds (LibreWXR,
 * SPC MD) plus a fetchMergedAlerts call at the bbox's own center point,
 * which catches whatever NWS/ECCC/BOM already has that LibreWXR's relay
 * hasn't caught up to yet — see AlertPolygonsLayer's own comment on that
 * query for the full reasoning. Deduped by id + dedupeKey like that layer
 * does, rather than sharing a helper with it — each caller doing its own
 * small dedupe loop over the shared dedupeKey export is the established
 * pattern here (see merge.ts's own comment on dedupeKey). */
export function useAlertsForBounds(bbox: BBox | null) {
  const { config } = useSettings();
  const libreWxrHost = config?.libreWxrHost ?? "https://api.librewxr.net";
  const willyWeatherApiKey = config?.willyWeatherApiKey ?? null;

  return useQuery({
    queryKey: ["alerts-for-bounds", bbox, libreWxrHost, willyWeatherApiKey],
    queryFn: async () => {
      const box = bbox as BBox;
      const centerLat = (box[1] + box[3]) / 2;
      // fetchMergedAlerts does point-in-coverage-range checks on this value
      // (inNwsCoverage etc.) and builds its own buffer bbox around it — an
      // out-of-range raw average (e.g. 190) fails every coverage check and
      // produces a degenerate fallback bbox, silently missing whatever's
      // actually visible in a wrapped viewport. The two bbox-native fetchers
      // below still get the raw box unchanged; they already clamp it
      // themselves (see librewxr.ts's clampBBox) with the same accepted
      // "lose a sliver of coverage at the antimeridian" tradeoff as
      // AlertPolygonsLayer's identical query.
      const centerLon = normalizeLon((box[0] + box[2]) / 2);

      const results = await Promise.allSettled([
        fetchLibreWxrAlerts(libreWxrHost, box),
        fetchSpcMdAlerts(box),
        fetchMergedAlerts(centerLat, centerLon, libreWxrHost, willyWeatherApiKey),
      ]);
      const all = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

      const seen = new Set<string>();
      const deduped: NormalizedAlert[] = [];
      for (const alert of all) {
        const dk = dedupeKey(alert);
        if (seen.has(alert.id) || seen.has(dk)) continue;
        seen.add(alert.id);
        seen.add(dk);
        deduped.push(alert);
      }

      // fetchMergedAlerts' own slice already comes back sorted, but merging
      // it back in with the two bbox-native feeds and re-deduping loses that
      // — re-sort the combined result so the audit log still reads
      // most-severe/most-recent first like it always has.
      deduped.sort((a, b) => {
        const rankA = SEVERITY_RANK[a.severity ?? "Unknown"] ?? 4;
        const rankB = SEVERITY_RANK[b.severity ?? "Unknown"] ?? 4;
        if (rankA !== rankB) return rankA - rankB;
        return (b.onset ?? "").localeCompare(a.onset ?? "");
      });
      return deduped;
    },
    enabled: bbox !== null,
    refetchInterval: 5 * 60_000,
  });
}
