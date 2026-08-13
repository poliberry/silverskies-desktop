import { useState } from "react";

/**
 * The "radar settings" half of a radar instance's controls — color scheme,
 * arrows/cells, the alert-polygons toggle, and the weather overlay toggles.
 * Deliberately separate from playback state (selectedIndex/isPlaying, which
 * stay local to LeafletRadarMap) because these are the controls that move
 * up into a pop-out radar window's alt bar (RadarWindowToolbar) instead of
 * staying in the under-map control bar — see RadarSettingsDropdowns.tsx.
 *
 * Each radar instance (the docked map in Shell, or any pop-out RadarWindow)
 * owns its own independent useRadarSettings() call — nothing here is
 * synced across windows/instances by design.
 */
export interface RadarSettings {
  colorScheme: number;
  setColorScheme: (id: number) => void;
  showArrows: boolean;
  toggleArrows: () => void;
  showCells: boolean;
  toggleCells: () => void;
  /** Default true — preserves the pre-existing always-on behavior of
   * AlertPolygonsLayer for anyone who never touches the new toggle. */
  showPolygons: boolean;
  togglePolygons: () => void;
  showWindOverlay: boolean;
  toggleWindOverlay: () => void;
  showTempOverlay: boolean;
  toggleTempOverlay: () => void;
  showPrecipOverlay: boolean;
  togglePrecipOverlay: () => void;
  showAqiOverlay: boolean;
  toggleAqiOverlay: () => void;
  /** WSR-88D station markers with individual clickable radar viewers —
   * default off, since 159 markers on top of everything else is a lot of
   * visual noise for anyone who just wants the base radar. */
  showRadarStations: boolean;
  toggleRadarStations: () => void;
}

export function useRadarSettings(): RadarSettings {
  const [colorScheme, setColorScheme] = useState(1);
  const [showArrows, setShowArrows] = useState(false);
  const [showCells, setShowCells] = useState(false);
  const [showPolygons, setShowPolygons] = useState(true);
  const [showWindOverlay, setShowWindOverlay] = useState(false);
  const [showTempOverlay, setShowTempOverlay] = useState(false);
  const [showPrecipOverlay, setShowPrecipOverlay] = useState(false);
  const [showAqiOverlay, setShowAqiOverlay] = useState(false);
  const [showRadarStations, setShowRadarStations] = useState(false);

  return {
    colorScheme,
    setColorScheme,
    showArrows,
    toggleArrows: () => setShowArrows((v) => !v),
    showCells,
    toggleCells: () => setShowCells((v) => !v),
    showPolygons,
    togglePolygons: () => setShowPolygons((v) => !v),
    showWindOverlay,
    toggleWindOverlay: () => setShowWindOverlay((v) => !v),
    showTempOverlay,
    toggleTempOverlay: () => setShowTempOverlay((v) => !v),
    showPrecipOverlay,
    togglePrecipOverlay: () => setShowPrecipOverlay((v) => !v),
    showAqiOverlay,
    toggleAqiOverlay: () => setShowAqiOverlay((v) => !v),
    showRadarStations,
    toggleRadarStations: () => setShowRadarStations((v) => !v),
  };
}
