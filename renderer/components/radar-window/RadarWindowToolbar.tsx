"use client";

import { LocationSearch } from "@/components/locations/LocationSearch";
import { RadarSettingsControls } from "@/components/radar/RadarSettingsControls";
import { ipc } from "@/lib/ipc-client";
import type { RadarSettings } from "@/hooks/useRadarSettings";
import type { LibreWxrColorScheme } from "@/lib/alerts/librewxr";
import type { WindowLocation } from "@/types/windows";

export interface RadarWindowToolbarProps {
  /** This radar window's own instance id — needed so "Open Conditions" pairs
   * the new window to *this* radar instance specifically. */
  instanceId: string;
  location: WindowLocation | null;
  onSearch: (query: string) => void | Promise<void>;
  onGps: () => void;
  isLocating: boolean;
  searchError: string | null;
  settings: RadarSettings;
  overlaysAvailable: boolean;
  colorSchemes: LibreWxrColorScheme[];
}

/**
 * The pop-out radar window's "alt bar" — location search plus every radar
 * *setting* (type/arrows/cells/polygons/overlays), lifted up here out of
 * the under-map control bar (which keeps only play/seek/live — see
 * RadarPlaybackBar). Also where a radar window spawns further windows:
 * another fully independent radar instance, or a Conditions window paired
 * to this one.
 */
export function RadarWindowToolbar({
  instanceId,
  location,
  onSearch,
  onGps,
  isLocating,
  searchError,
  settings,
  overlaysAvailable,
  colorSchemes,
}: RadarWindowToolbarProps) {
  return (
    <div className="glass-card flex flex-wrap items-start gap-4 p-3">
      <div className="w-64 flex-shrink-0">
        <LocationSearch onSearch={onSearch} onGps={onGps} isLocating={isLocating} error={searchError} />
      </div>

      <div className="min-w-0 flex-1">
        <RadarSettingsControls
          colorSchemes={colorSchemes}
          colorScheme={settings.colorScheme}
          onColorSchemeChange={settings.setColorScheme}
          showArrows={settings.showArrows}
          onToggleArrows={settings.toggleArrows}
          showCells={settings.showCells}
          onToggleCells={settings.toggleCells}
          showPolygons={settings.showPolygons}
          onTogglePolygons={settings.togglePolygons}
          showWindOverlay={settings.showWindOverlay}
          onToggleWindOverlay={settings.toggleWindOverlay}
          showTempOverlay={settings.showTempOverlay}
          onToggleTempOverlay={settings.toggleTempOverlay}
          showPrecipOverlay={settings.showPrecipOverlay}
          onTogglePrecipOverlay={settings.togglePrecipOverlay}
          showAqiOverlay={settings.showAqiOverlay}
          onToggleAqiOverlay={settings.toggleAqiOverlay}
          overlaysAvailable={overlaysAvailable}
        />
      </div>

      <div className="flex flex-shrink-0 items-center gap-2">
        <button
          className="unit-btn"
          onClick={() => void ipc.windows.openRadar()}
          title="Open another, completely independent radar instance"
        >
          New Radar Window
        </button>
        <button
          className="unit-btn"
          disabled={!location}
          onClick={() => location && void ipc.windows.openConditions({ instanceId, location })}
          title="Open a current-conditions window tracking this radar's location"
        >
          Open Conditions
        </button>
      </div>
    </div>
  );
}
