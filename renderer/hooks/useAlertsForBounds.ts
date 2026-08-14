import { useQuery } from "@tanstack/react-query";
import { fetchLibreWxrAlerts, type BBox } from "@/lib/alerts/librewxr";
import { fetchSpcMdAlerts } from "@/lib/alerts/spc-md";
import { fetchMergedAlerts, dedupeKey, SEVERITY_RANK } from "@/lib/alerts/merge";
import { useSettings } from "./useSettings";
import type { NormalizedAlert } from "@/types/alerts";

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
      const centerLon = (box[0] + box[2]) / 2;

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
