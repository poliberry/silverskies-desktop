"use client";

import { useQuery } from "@tanstack/react-query";
import { findNearestLiveNwrFeed } from "@/lib/weather-radio/nwr-directory";
import type { WindowLocation } from "@/types/windows";

/** Resolves the nearest confirmed-live NWR relay stream to a location — see
 * lib/weather-radio/nwr-directory.ts. Cached per lat/lon (rounded, so tiny
 * location jitter doesn't refetch) since the directory itself barely
 * changes; a long staleTime avoids re-fetching the ~1400-transmitter
 * directory on every Settings/Sheet open. */
export function useNearestNwrFeed(location: WindowLocation | null, enabled: boolean) {
  const lat = location ? Math.round(location.lat * 10) / 10 : null;
  const lon = location ? Math.round(location.lon * 10) / 10 : null;
  return useQuery({
    queryKey: ["nwr-nearest-feed", lat, lon],
    queryFn: () => findNearestLiveNwrFeed(lat!, lon!),
    enabled: enabled && lat !== null && lon !== null,
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
  });
}
