"use client";

import type { LibreWxrColorScheme } from "@/lib/alerts/librewxr";

export interface RadarSettingsControlsProps {
  colorSchemes: LibreWxrColorScheme[];
  colorScheme: number;
  onColorSchemeChange: (id: number) => void;
  showArrows: boolean;
  onToggleArrows: () => void;
  showCells: boolean;
  onToggleCells: () => void;
  showPolygons: boolean;
  onTogglePolygons: () => void;
  showWindOverlay: boolean;
  onToggleWindOverlay: () => void;
  showTempOverlay: boolean;
  onToggleTempOverlay: () => void;
  showPrecipOverlay: boolean;
  onTogglePrecipOverlay: () => void;
  showAqiOverlay: boolean;
  onToggleAqiOverlay: () => void;
  /** False when no OpenWeatherMap key is configured yet (Settings → Data
   * Sources) — the overlay buttons render disabled with an explanatory
   * title instead of silently doing nothing when clicked. */
  overlaysAvailable: boolean;
  className?: string;
}

/**
 * Radar type/arrows/cells/polygons + the weather-overlay toggles — the
 * "radar settings" half of a radar instance's controls, as opposed to
 * playback (RadarPlaybackBar). Rendered inline under the map for the main
 * docked instance (via RadarControls), and lifted into the alt bar
 * (RadarWindowToolbar) for pop-out radar windows — same component either
 * way, just a different parent container.
 */
export function RadarSettingsControls({
  colorSchemes,
  colorScheme,
  onColorSchemeChange,
  showArrows,
  onToggleArrows,
  showCells,
  onToggleCells,
  showPolygons,
  onTogglePolygons,
  showWindOverlay,
  onToggleWindOverlay,
  showTempOverlay,
  onToggleTempOverlay,
  showPrecipOverlay,
  onTogglePrecipOverlay,
  showAqiOverlay,
  onToggleAqiOverlay,
  overlaysAvailable,
  className,
}: RadarSettingsControlsProps) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <div className="settings-bar-group">
        {colorSchemes.slice(0, 6).map((scheme) => (
          <button
            key={scheme.id}
            className={`unit-btn ${colorScheme === scheme.id ? "active" : ""}`}
            onClick={() => onColorSchemeChange(scheme.id)}
            title={scheme.name}
          >
            {scheme.name.length > 10 ? scheme.name.slice(0, 9) + "…" : scheme.name}
          </button>
        ))}
      </div>
      <div className="settings-bar-group">
        <button className={`unit-btn ${showArrows ? "active" : ""}`} onClick={onToggleArrows}>
          Arrows
        </button>
        <button className={`unit-btn ${showCells ? "active" : ""}`} onClick={onToggleCells}>
          Cells
        </button>
        <button className={`unit-btn ${showPolygons ? "active" : ""}`} onClick={onTogglePolygons}>
          Polygons
        </button>
      </div>
      <div
        className="settings-bar-group"
        title={overlaysAvailable ? undefined : "Add an OpenWeatherMap API key in Settings → Data Sources to enable overlays"}
      >
        <button
          className={`unit-btn ${showWindOverlay ? "active" : ""}`}
          onClick={onToggleWindOverlay}
          disabled={!overlaysAvailable}
        >
          Wind
        </button>
        <button
          className={`unit-btn ${showTempOverlay ? "active" : ""}`}
          onClick={onToggleTempOverlay}
          disabled={!overlaysAvailable}
        >
          Temp
        </button>
        <button
          className={`unit-btn ${showPrecipOverlay ? "active" : ""}`}
          onClick={onTogglePrecipOverlay}
          disabled={!overlaysAvailable}
        >
          Precip
        </button>
        <button
          className={`unit-btn ${showAqiOverlay ? "active" : ""}`}
          onClick={onToggleAqiOverlay}
          disabled={!overlaysAvailable}
        >
          AQI
        </button>
      </div>
    </div>
  );
}
