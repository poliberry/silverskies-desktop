"use client";

import { RadarPlaybackBar, type RadarPlaybackBarProps } from "./RadarPlaybackBar";
import { RadarSettingsControls, type RadarSettingsControlsProps } from "./RadarSettingsControls";

export type RadarControlsProps = RadarPlaybackBarProps & RadarSettingsControlsProps;

/**
 * The docked main-window radar's combined control bar — playback on top,
 * radar settings below, in one card. Pop-out radar windows instead render
 * RadarPlaybackBar under the map and RadarSettingsControls up in the alt
 * bar (RadarWindowToolbar), so those two are kept as separate components;
 * this is just the original single-bar composition preserved as-is for
 * LeafletRadarMap's default (non-pop-out) usage.
 */
export function RadarControls(props: RadarControlsProps) {
  return (
    <div className="glass-card flex flex-col gap-2 p-3">
      <RadarPlaybackBar
        frames={props.frames}
        nowcastStartIndex={props.nowcastStartIndex}
        selectedIndex={props.selectedIndex}
        onSelectIndex={props.onSelectIndex}
        isPlaying={props.isPlaying}
        onTogglePlay={props.onTogglePlay}
        isLive={props.isLive}
        onJumpToLive={props.onJumpToLive}
      />
      <RadarSettingsControls
        colorSchemes={props.colorSchemes}
        colorScheme={props.colorScheme}
        onColorSchemeChange={props.onColorSchemeChange}
        showArrows={props.showArrows}
        onToggleArrows={props.onToggleArrows}
        showCells={props.showCells}
        onToggleCells={props.onToggleCells}
        showPolygons={props.showPolygons}
        onTogglePolygons={props.onTogglePolygons}
        showWindOverlay={props.showWindOverlay}
        onToggleWindOverlay={props.onToggleWindOverlay}
        showTempOverlay={props.showTempOverlay}
        onToggleTempOverlay={props.onToggleTempOverlay}
        showPrecipOverlay={props.showPrecipOverlay}
        onTogglePrecipOverlay={props.onTogglePrecipOverlay}
        showAqiOverlay={props.showAqiOverlay}
        onToggleAqiOverlay={props.onToggleAqiOverlay}
        overlaysAvailable={props.overlaysAvailable}
      />
    </div>
  );
}
