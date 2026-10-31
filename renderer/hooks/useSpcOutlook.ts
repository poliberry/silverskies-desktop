import { useQuery } from "@tanstack/react-query";
import { fetchSpcCategoricalOutlook } from "@/lib/alerts/spc-outlook";

/** SPC Day 1 Categorical Outlook polygons — shared by the radar overlay
 * layer and the alerts-panel banner (both call this independently; react-
 * query dedupes the identical query key into one network fetch, same as
 * the radar map's own alert-polygon layer fetching separately from the
 * audit log's useAlerts). Disabled entirely via the `enabled` flag when the
 * Settings toggle is off. */
export function useSpcOutlook(enabled: boolean) {
  return useQuery({
    queryKey: ["spc-categorical-outlook"],
    queryFn: fetchSpcCategoricalOutlook,
    enabled,
    // The outlook only reissues around five fixed synoptic times a day
    // (0100Z, 0600Z, 1300Z, 1630Z, 2000Z) — no need to poll as tightly as
    // the 5-minute alert feeds.
    refetchInterval: 15 * 60_000,
  });
}
