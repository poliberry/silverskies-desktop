"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import type { BBox } from "@/lib/alerts/librewxr";
import { fetchMetarObservation } from "@/lib/metar-stations";
import type { MetarObservation, MetarStation } from "@/types/metar-stations";

// Wind barbs only render once zoomed in enough to be legible/useful — at a
// CONUS-wide view, ~2000 stations' worth of barbs would be both illegible
// clutter and an unnecessary request burst (same reasoning RadarStationsLayer
// already applies by being opt-in at all, just extended with a zoom gate
// here since this station network is an order of magnitude larger).
const MIN_ZOOM = 6;
// A hard cap independent of the zoom gate — a wide view at exactly the
// minimum zoom over a station-dense region (the NE US, say) could still
// contain far more than is worth rendering or fetching at once.
const MAX_STATIONS = 150;

/** Bounds a fixed number of observation fetches in flight at once, shared
 * across every station's query — without this, panning into a
 * station-dense region would fire well over a hundred simultaneous requests
 * at api.weather.gov. */
function createLimiter(maxConcurrent: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  function runNext() {
    if (active >= maxConcurrent || queue.length === 0) return;
    active++;
    const run = queue.shift();
    run?.();
  }
  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            runNext();
          });
      });
      runNext();
    });
  };
}

const limitMetarFetch = createLimiter(8);

/** Thins a list down to at most `max` entries, spread evenly across the
 * original order, rather than just slicing the front — so a station-dense
 * corner of the viewport doesn't crowd out stations spread across the rest
 * of it. */
function thin<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = items.length / max;
  const result: T[] = [];
  for (let i = 0; i < max; i++) result.push(items[Math.floor(i * step)]);
  return result;
}

export interface MetarStationObservation {
  station: MetarStation;
  observation: MetarObservation;
}

/** Filters the full station list (see useMetarStations) to the current
 * viewport, caps/thins it, and fetches each visible station's latest
 * observation — concurrency-limited and cached per-station so panning
 * back over an already-seen area doesn't re-fetch. */
export function useMetarObservations(
  stations: MetarStation[] | undefined,
  bbox: BBox,
  zoom: number,
  enabled: boolean,
): MetarStationObservation[] {
  const visibleStations = useMemo(() => {
    if (!enabled || !stations || stations.length === 0 || zoom < MIN_ZOOM) return [];
    const [west, south, east, north] = bbox;
    const inBounds = stations.filter((s) => s.lon >= west && s.lon <= east && s.lat >= south && s.lat <= north);
    return thin(inBounds, MAX_STATIONS);
  }, [stations, bbox, zoom, enabled]);

  const results = useQueries({
    queries: visibleStations.map((station) => ({
      queryKey: ["metar-observation", station.id],
      queryFn: () => limitMetarFetch(() => fetchMetarObservation(station.id)),
      staleTime: 10 * 60_000,
      refetchInterval: 12 * 60_000,
      enabled,
    })),
  });

  return useMemo(
    () =>
      visibleStations
        .map((station, i) => ({ station, observation: results[i]?.data ?? null }))
        .filter((entry): entry is MetarStationObservation => Boolean(entry.observation)),
    [visibleStations, results],
  );
}
