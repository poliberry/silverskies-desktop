"use client";

import { useQuery } from "@tanstack/react-query";
import { findLiveNwrFeedsNear, type NearestNwrFeed } from "@/lib/weather-radio/nwr-directory";
import type { WindowLocation } from "@/types/windows";

/** The nearest handful of confirmed-live NWR relays to a location, ranked —
 * not just the single nearest — so playback can fall back through the list
 * when one turns out to be offline despite the directory listing it "ON"
 * (see findLiveNwrFeedsNear). Cached per lat/lon (rounded, so tiny location
 * jitter doesn't refetch); long staleTime since the directory itself barely
 * changes. */
export function useNwrFeedCandidates(location: WindowLocation | null, enabled: boolean) {
  const lat = location ? Math.round(location.lat * 10) / 10 : null;
  const lon = location ? Math.round(location.lon * 10) / 10 : null;
  return useQuery<NearestNwrFeed[]>({
    queryKey: ["nwr-feed-candidates", lat, lon],
    queryFn: () => findLiveNwrFeedsNear(lat!, lon!),
    enabled: enabled && lat !== null && lon !== null,
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
  });
}
