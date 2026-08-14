"use client";

import { useClock } from "@/hooks/useClock";
import { fmtClockTime } from "@/lib/units";
import type { TimeFormatPref, UnitPref } from "@/types/settings";
import { Logo } from "./Logo";
import { WindowControlButtons } from "./WindowControlButtons";

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
  /** Only shown when Settings → Interface is set to "Advanced" — gates both
   * the radar and audit-log pop-out affordances below. */
  showWindowActions?: boolean;
  radarPoppedOut?: boolean;
  onPopOutRadar?: () => void;
  onNewRadarWindow?: () => void;
  auditLogPoppedOut?: boolean;
  onPopOutAuditLog?: () => void;
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
  showWindowActions,
  radarPoppedOut,
  onPopOutRadar,
  onNewRadarWindow,
  auditLogPoppedOut,
  onPopOutAuditLog,
}: TopBarProps) {
  const clock = useClock(timezone, timeFormat);

  return (
    <div
      className="topbar drag-region flex flex-nowrap items-center gap-3"
      style={{ padding: "0 0 8px", borderBottom: "1px solid var(--border)" }}
    >
      {/* Fixed muted neutral rather than the weather-condition accent — a
          watermark-style mark shouldn't dim to near-invisible whenever the
          current condition happens to resolve to a dark accent hue. */}
      <Logo style={{ height: 20, width: "auto", display: "block", color: "var(--text2)", flexShrink: 0 }} />

      <div className="flex min-w-0 items-baseline gap-2 overflow-hidden">
        <span className="truncate text-base font-light" style={{ letterSpacing: "-0.01em" }}>
          {locationLabel}
        </span>
        <span className="font-mono text-[0.7rem] whitespace-nowrap" style={{ color: "var(--text3)" }}>
          {locationSub}
        </span>
      </div>

      <div
        className="no-drag flex flex-shrink-0 flex-nowrap items-center justify-end gap-3"
        style={{ marginLeft: "auto" }}
      >
        <span className="font-mono text-[0.7rem] whitespace-nowrap" style={{ color: "var(--text3)" }}>
          Last Refresh <span style={{ color: "var(--accent2)" }}>{lastRefresh ? fmtClockTime(lastRefresh, timeFormat) : "—"}</span>
          <span className="mx-2" style={{ opacity: 0.4 }}>
            ·
          </span>
          {clock}
        </span>
        {showWindowActions && (
          <div className="unit-toggle">
            {!radarPoppedOut && (
              <button
                className="unit-btn"
                onClick={onPopOutRadar}
                title="Undock the radar into its own window"
                aria-label="Pop out radar"
              >
                <i className="ph ph-arrow-square-out" aria-hidden="true" />
              </button>
            )}
            <button
              className="unit-btn"
              onClick={onNewRadarWindow}
              title="Open another, independent radar window"
              aria-label="New radar window"
            >
              <i className="ph ph-plus-square" aria-hidden="true" />
            </button>
          </div>
        )}
        {showWindowActions && !auditLogPoppedOut && (
          <div className="unit-toggle">
            <button
              className="unit-btn"
              onClick={onPopOutAuditLog}
              title="Undock the audit log into its own window"
              aria-label="Pop out audit log"
            >
              <i className="ph ph-arrow-square-out" aria-hidden="true" />
            </button>
          </div>
        )}
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
        <WindowControlButtons />
      </div>
    </div>
  );
}
