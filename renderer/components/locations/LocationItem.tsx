"use client";

import type { SavedLocation } from "@/types/settings";

export interface LocationItemProps {
  location: SavedLocation;
  isActive: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

export function LocationItem({ location, isActive, onSelect, onRemove }: LocationItemProps) {
  return (
    <div
      className="glass-card group flex items-center gap-2 px-3 py-2.5 cursor-pointer"
      style={isActive ? { borderColor: "var(--border-active)", background: "var(--accent-glow2)" } : undefined}
      onClick={onSelect}
      role="button"
      tabIndex={0}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium" style={{ color: isActive ? "var(--accent2)" : "var(--text)" }}>
          {location.label}
        </div>
        <div className="font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
          {Math.abs(location.lat).toFixed(2)}°{location.lat < 0 ? "S" : "N"}{" "}
          {Math.abs(location.lon).toFixed(2)}°{location.lon < 0 ? "W" : "E"}
        </div>
      </div>
      <button
        className="opacity-0 transition-opacity group-hover:opacity-100"
        style={{ color: "var(--text3)" }}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label={`Remove ${location.label}`}
        title="Remove"
      >
        <i className="ph ph-x" aria-hidden="true" />
      </button>
    </div>
  );
}
