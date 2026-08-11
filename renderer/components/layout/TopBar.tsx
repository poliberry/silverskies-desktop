"use client";

import { useClock } from "@/hooks/useClock";
import { fmtClockTime } from "@/lib/units";
import type { TimeFormatPref, UnitPref } from "@/types/settings";
import { Logo } from "./Logo";

export interface TopBarProps {
  locationLabel: string;
  locationSub: string;
  lastRefresh: Date | null;
  isRefreshing: boolean;
  onRefresh: () => void;
  unit: UnitPref;
  onSetUnit: (u: UnitPref) => void;
  timezone: string | undefined;
  timeFormat: TimeFormatPref;
}

export function TopBar({
  locationLabel,
  locationSub,
  lastRefresh,
  isRefreshing,
  onRefresh,
  unit,
  onSetUnit,
  timezone,
  timeFormat,
}: TopBarProps) {
  const clock = useClock(timezone, timeFormat);

  return (
    <div
      className="grid items-center gap-4 pb-2"
      style={{ gridTemplateColumns: "1fr auto 1fr", borderBottom: "1px solid var(--border)" }}
    >
      <div className="flex min-w-0 items-baseline gap-2 overflow-hidden">
        <span className="truncate text-base font-light" style={{ letterSpacing: "-0.01em" }}>
          {locationLabel}
        </span>
        <span className="font-mono text-[0.7rem] whitespace-nowrap" style={{ color: "var(--text3)" }}>
          {locationSub}
        </span>
      </div>

      {/* Fixed muted neutral rather than the weather-condition accent — a
          watermark-style mark shouldn't dim to near-invisible whenever the
          current condition happens to resolve to a dark accent hue. */}
      <Logo style={{ height: 32, width: "auto", display: "block", color: "var(--text2)" }} />

      <div className="flex flex-shrink-0 items-center justify-end gap-3">
        <span className="font-mono text-[0.7rem] whitespace-nowrap" style={{ color: "var(--text3)" }}>
          Last Refresh <span style={{ color: "var(--accent2)" }}>{lastRefresh ? fmtClockTime(lastRefresh, timeFormat) : "—"}</span>
          <span className="mx-2" style={{ opacity: 0.4 }}>
            ·
          </span>
          {clock}
        </span>
        <button className={`refresh-btn ${isRefreshing ? "spinning" : ""}`} onClick={onRefresh}>
          <span className="ri">↻</span>
        </button>
        <div className="unit-toggle">
          <button className={`unit-btn ${unit === "F" ? "active" : ""}`} onClick={() => onSetUnit("F")}>
            °F
          </button>
          <button className={`unit-btn ${unit === "C" ? "active" : ""}`} onClick={() => onSetUnit("C")}>
            °C
          </button>
        </div>
      </div>
    </div>
  );
}
