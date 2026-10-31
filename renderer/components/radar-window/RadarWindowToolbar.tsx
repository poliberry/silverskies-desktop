"use client";

import { useState } from "react";
import { RadarSettingsDropdowns } from "@/components/radar/RadarSettingsDropdowns";
import { WindowControlButtons } from "@/components/layout/WindowControlButtons";
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

// Icon-only actions — no visible label, just a title/aria-label tooltip —
// to keep the bar as thin as possible.
const iconBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 18,
  height: 18,
  padding: 0,
  background: "none",
  border: "none",
  color: "var(--text3)",
  cursor: "pointer",
};

/**
 * The pop-out radar window's "alt bar" — a flat, ~18px-tall single-line
 * strip: location search, every radar *setting* (type/arrows/cells/
 * polygons/overlays, as compact dropdowns — see RadarSettingsDropdowns),
 * and icon actions that spawn further windows. Deliberately chrome-less
 * (no card background/border/padding) — this is scoped to the pop-out
 * window only, the main docked window's controls are unaffected.
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
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || isSearching) return;
    setIsSearching(true);
    try {
      await onSearch(query.trim());
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <div className="drag-region flex flex-nowrap items-center gap-2 overflow-x-auto" style={{ padding: "3px 8px" }}>
      <form className="no-drag flex flex-shrink-0 items-center gap-1" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Search city…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          title={searchError ?? undefined}
          aria-invalid={Boolean(searchError)}
          style={{
            height: 18,
            width: 150,
            padding: "0 4px",
            border: "none",
            background: "none",
            color: "var(--text)",
            fontSize: "0.7rem",
            fontFamily: "var(--mono)",
            outline: "none",
          }}
        />
        <button
          type="button"
          onClick={onGps}
          title="Use my GPS location"
          aria-label="Use my GPS location"
          style={iconBtnStyle}
          className={isLocating ? "locating" : undefined}
        >
          <i className="ph ph-navigation-arrow" aria-hidden="true" style={{ fontSize: "0.85rem" }} />
        </button>
      </form>

      <div className="no-drag">
        <RadarSettingsDropdowns colorSchemes={colorSchemes} settings={settings} overlaysAvailable={overlaysAvailable} />
      </div>

      <div className="no-drag flex flex-shrink-0 items-center gap-1" style={{ marginLeft: "auto" }}>
        <button
          type="button"
          onClick={() => void ipc.windows.openRadar()}
          title="Open another, completely independent radar instance"
          aria-label="New radar window"
          style={iconBtnStyle}
        >
          <i className="ph ph-plus-square" aria-hidden="true" style={{ fontSize: "0.9rem" }} />
        </button>
        <button
          type="button"
          disabled={!location}
          onClick={() => location && void ipc.windows.openConditions({ instanceId, location })}
          title="Open a current-conditions window tracking this radar's location"
          aria-label="Open conditions window"
          style={{ ...iconBtnStyle, opacity: location ? 1 : 0.4, cursor: location ? "pointer" : "not-allowed" }}
        >
          <i className="ph ph-cloud-sun" aria-hidden="true" style={{ fontSize: "0.9rem" }} />
        </button>
        <button
          type="button"
          disabled={!location}
          onClick={() => location && void ipc.windows.openAuditLog({ instanceId, location })}
          title="Open an audit-log window tracking this radar's location"
          aria-label="Open audit log window"
          style={{ ...iconBtnStyle, opacity: location ? 1 : 0.4, cursor: location ? "pointer" : "not-allowed" }}
        >
          <i className="ph ph-list-magnifying-glass" aria-hidden="true" style={{ fontSize: "0.9rem" }} />
        </button>
        <button
          type="button"
          disabled={!location}
          onClick={() => location && void ipc.windows.openWeatherRadio({ instanceId, location })}
          title="Open a weather radio window tracking this radar's location"
          aria-label="Open weather radio window"
          style={{ ...iconBtnStyle, opacity: location ? 1 : 0.4, cursor: location ? "pointer" : "not-allowed" }}
        >
          <i className="ph ph-radio" aria-hidden="true" style={{ fontSize: "0.9rem" }} />
        </button>
      </div>

      <WindowControlButtons iconSize={11} />
    </div>
  );
}
