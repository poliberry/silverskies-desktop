"use client";

import type { LibreWxrFrame } from "@/lib/alerts/librewxr";

export interface RadarPlaybackBarProps {
  frames: LibreWxrFrame[];
  nowcastStartIndex: number;
  selectedIndex: number;
  onSelectIndex: (i: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  isLive: boolean;
  onJumpToLive: () => void;
  /** True while a station's own single-site radar image is showing instead
   * of the composite radar — playback only ever drives the composite frame
   * timeline, so Play/scrub/Live here wouldn't change what's actually on
   * screen. Dims the bar and blocks interaction rather than hiding it
   * outright, so it's clear playback still exists, just not for this view. */
  disabled?: boolean;
}

function frameLabel(frame: LibreWxrFrame | undefined, isForecast: boolean): string {
  if (!frame) return "—";
  const d = new Date(frame.time * 1000);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return isForecast ? `+${time}` : time;
}

/**
 * Play/pause, scrubber, and the Live button — the one control group every
 * radar instance keeps under its own map, whether that's the docked map in
 * the main window or a pop-out RadarWindow. Split out of the old
 * RadarControls so a pop-out window's alt bar can host the *other* half
 * (RadarSettingsDropdowns) without duplicating this row.
 */
export function RadarPlaybackBar({
  frames,
  nowcastStartIndex,
  selectedIndex,
  onSelectIndex,
  isPlaying,
  onTogglePlay,
  isLive,
  onJumpToLive,
  disabled = false,
}: RadarPlaybackBarProps) {
  const current = frames[selectedIndex];
  const isForecast = selectedIndex >= nowcastStartIndex;
  const disabledTitle = "Showing a station's own radar — playback is for the composite radar timeline.";

  return (
    <div
      className="flex items-center gap-3"
      style={disabled ? { opacity: 0.45 } : undefined}
      title={disabled ? disabledTitle : undefined}
    >
      <button className="refresh-btn" onClick={onTogglePlay} disabled={disabled} aria-label={isPlaying ? "Pause" : "Play"}>
        <span className="ri">{isPlaying ? "⏸" : "▶"}</span>
      </button>
      <input
        type="range"
        className="flex-1"
        min={0}
        max={Math.max(frames.length - 1, 0)}
        value={selectedIndex}
        onChange={(e) => onSelectIndex(Number(e.target.value))}
        disabled={disabled}
      />
      <div className="font-mono text-xs whitespace-nowrap" style={{ color: isForecast ? "var(--accent2)" : "var(--text2)" }}>
        {frameLabel(current, isForecast)}
        {isForecast && <span className="text-[0.65rem] opacity-70"> FCST</span>}
      </div>
      <button
        className={`unit-btn ${isLive ? "active" : ""}`}
        onClick={onJumpToLive}
        disabled={disabled}
        title={disabled ? disabledTitle : "Jump to the latest radar frame and keep following new ones as they arrive"}
      >
        Live
      </button>
    </div>
  );
}
