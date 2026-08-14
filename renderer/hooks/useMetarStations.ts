"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchMetarStationList } from "@/lib/metar-stations";

/** The full ASOS/AWOS station list (~2000+ sites) — fetched once and cached
 * long-term (station locations don't change) since, unlike the WSR-88D
 * radar-station list, this endpoint has no bbox filter to fetch just a
 * viewport's worth. Bounds filtering happens downstream in
 * useMetarObservations. */
export function useMetarStations(enabled: boolean) {
  return useQuery({
    queryKey: ["metar-stations"],
    queryFn: fetchMetarStationList,
    enabled,
    staleTime: 24 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
  });
}
