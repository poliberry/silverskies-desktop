"use client";

import dynamic from "next/dynamic";
import type { RadarSettings } from "@/hooks/useRadarSettings";
import type { BBox } from "@/lib/alerts/librewxr";

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
  /** Settings toggle for the SPC Day 1 Categorical Outlook overlay. */
  spcOutlookEnabled: boolean;
  /** Owned by whichever component hosts this radar instance (Shell for the
   * docked map, RadarWindow for a pop-out) — see hooks/useRadarSettings.ts.
   * Each instance gets its own independent settings object. */
  settings: RadarSettings;
  /** False when a pop-out window's alt bar (RadarWindowToolbar) is already
   * rendering RadarSettingsDropdowns — the under-map bar then shows only
   * playback controls instead of duplicating them. Defaults to true. */
  renderSettingsInline?: boolean;
  /** Fires with whatever bbox should currently drive this radar instance's
   * audit log: the map's own viewport, or a user's shift-drag selection
   * within it when one is active. Called on mount, on pan/zoom, and whenever
   * a selection is drawn or cleared. */
  onBoundsChange?: (bbox: BBox) => void;
}

export function RadarMap(props: RadarMapProps) {
  return <LeafletRadarMap {...props} />;
}
