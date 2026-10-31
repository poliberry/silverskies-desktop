"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchRadarStations } from "@/lib/radar-stations";

/** All 159 WSR-88D stations, shared across the map's marker layer and the
 * station dialog (same query key → the dialog reads from cache, no extra
 * fetch when it opens for a station the layer already loaded). */
export function useRadarStations(enabled: boolean) {
  return useQuery({
    queryKey: ["radar-stations"],
    queryFn: fetchRadarStations,
    enabled,
    // Station metadata (VCP, live-scan timestamp, alarms) changes on its
    // own schedule — refetch often enough that a station dialog's "Live"
    // badge and scan time stay meaningfully current while it's open.
    refetchInterval: 2 * 60_000,
    staleTime: 60_000,
  });
}
