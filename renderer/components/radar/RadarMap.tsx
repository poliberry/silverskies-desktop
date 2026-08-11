"use client";

import dynamic from "next/dynamic";

// Leaflet touches `window` at module scope, so it can only ever run in the
// browser — dynamic-import it with ssr disabled from this Client Component
// (Next 16: `ssr: false` is only honored when `dynamic()` is called inside
// a 'use client' file, not from a Server Component).
const LeafletRadarMap = dynamic(() => import("./LeafletRadarMap").then((m) => m.LeafletRadarMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center glass-card">
      <div>
        <div className="loading-spinner" />
        <div className="loading-text">Loading radar…</div>
      </div>
    </div>
  ),
});

export interface RadarMapProps {
  lat: number;
  lon: number;
  label: string;
  libreWxrHost: string;
  theme: "light" | "dark";
  /** Preloaded in the background (radar tiles warmed at a fixed zoom) so
   * switching to one of these feels instant. */
  preloadLocations?: { lat: number; lon: number }[];
}

export function RadarMap(props: RadarMapProps) {
  return <LeafletRadarMap {...props} />;
}
