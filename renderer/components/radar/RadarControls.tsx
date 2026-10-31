"use client";

import { RadarPlaybackBar, type RadarPlaybackBarProps } from "./RadarPlaybackBar";
import { RadarSettingsDropdowns } from "./RadarSettingsDropdowns";
import type { RadarSettings } from "@/hooks/useRadarSettings";
import type { LibreWxrColorScheme } from "@/lib/alerts/librewxr";

export interface RadarControlsProps extends RadarPlaybackBarProps {
  colorSchemes: LibreWxrColorScheme[];
  settings: RadarSettings;
  overlaysAvailable: boolean;
}

/**
 * The docked main-window radar's combined control bar — playback on top,
 * radar settings (as compact dropdowns — see RadarSettingsDropdowns) below,
 * in one card. Pop-out radar windows instead render RadarPlaybackBar under
 * the map and RadarSettingsDropdowns up in the alt bar (RadarWindowToolbar),
 * so those two stay separate components; this is just the original
 * single-bar composition for LeafletRadarMap's default (non-pop-out) usage.
 */
export function RadarControls({ colorSchemes, settings, overlaysAvailable, ...playback }: RadarControlsProps) {
  return (
    <div className="glass-card flex flex-col gap-2 p-3">
      <RadarPlaybackBar {...playback} />
      <RadarSettingsDropdowns colorSchemes={colorSchemes} settings={settings} overlaysAvailable={overlaysAvailable} />
    </div>
  );
}
