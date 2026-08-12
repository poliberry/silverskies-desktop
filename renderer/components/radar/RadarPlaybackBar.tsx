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
 * (RadarSettingsControls) without duplicating this row.
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
}: RadarPlaybackBarProps) {
  const current = frames[selectedIndex];
  const isForecast = selectedIndex >= nowcastStartIndex;

  return (
    <div className="flex items-center gap-3">
      <button className="refresh-btn" onClick={onTogglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
        <span className="ri">{isPlaying ? "⏸" : "▶"}</span>
      </button>
      <input
        type="range"
        className="flex-1"
        min={0}
        max={Math.max(frames.length - 1, 0)}
        value={selectedIndex}
        onChange={(e) => onSelectIndex(Number(e.target.value))}
      />
      <div className="font-mono text-xs whitespace-nowrap" style={{ color: isForecast ? "var(--accent2)" : "var(--text2)" }}>
        {frameLabel(current, isForecast)}
        {isForecast && <span className="text-[0.65rem] opacity-70"> FCST</span>}
      </div>
      <button
        className={`unit-btn ${isLive ? "active" : ""}`}
        onClick={onJumpToLive}
        title="Jump to the latest radar frame and keep following new ones as they arrive"
      >
        Live
      </button>
    </div>
  );
}
