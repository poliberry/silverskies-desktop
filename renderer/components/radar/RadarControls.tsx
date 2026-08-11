"use client";

import type { LibreWxrColorScheme, LibreWxrFrame } from "@/lib/alerts/librewxr";

export interface RadarControlsProps {
  frames: LibreWxrFrame[];
  nowcastStartIndex: number;
  selectedIndex: number;
  onSelectIndex: (i: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  colorSchemes: LibreWxrColorScheme[];
  colorScheme: number;
  onColorSchemeChange: (id: number) => void;
  showArrows: boolean;
  onToggleArrows: () => void;
  showCells: boolean;
  onToggleCells: () => void;
  isLive: boolean;
  onJumpToLive: () => void;
}

function frameLabel(frame: LibreWxrFrame | undefined, isForecast: boolean): string {
  if (!frame) return "—";
  const d = new Date(frame.time * 1000);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return isForecast ? `+${time}` : time;
}

export function RadarControls({
  frames,
  nowcastStartIndex,
  selectedIndex,
  onSelectIndex,
  isPlaying,
  onTogglePlay,
  colorSchemes,
  colorScheme,
  onColorSchemeChange,
  showArrows,
  onToggleArrows,
  showCells,
  onToggleCells,
  isLive,
  onJumpToLive,
}: RadarControlsProps) {
  const current = frames[selectedIndex];
  const isForecast = selectedIndex >= nowcastStartIndex;

  return (
    <div className="glass-card flex flex-col gap-2 p-3">
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

      <div className="flex flex-wrap items-center gap-2">
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
        </div>
      </div>
    </div>
  );
}
