"use client";

import type { RadarStation } from "@/types/radar-stations";
import type { NormalizedWeather } from "@/types/weather";
import type { UnitPref } from "@/types/settings";
import { hasSails, isStationLive, vcpLabel } from "@/lib/radar-stations";
import { RADAR_PRODUCTS, stationLegendUrl } from "@/lib/radar-station-products";
import { fmtWind, windDirLabel, windSpeedUnit } from "@/lib/units";
import { WindCompass } from "./WindCompass";

export interface StationInfoPanelProps {
  station: RadarStation;
  productId: string;
  onProductChange: (id: string) => void;
  onClose: () => void;
  wind: NormalizedWeather | undefined;
  windLoading: boolean;
  unit: UnitPref;
}

/**
 * Floats over the actual radar map (docked or pop-out — LeafletRadarMap is
 * shared between both) once a station marker is clicked, instead of a
 * separate dialog: scan/VCP/FastScan metadata, the product picker, and the
 * station's current wind, while the map itself swaps its radar layer for
 * that station's real single-site WMS product (see LeafletRadarMap.tsx).
 */
export function StationInfoPanel({ station, productId, onProductChange, onClose, wind, windLoading, unit }: StationInfoPanelProps) {
  const live = isStationLive(station.lastReceivedTime);
  const scanTime = station.lastReceivedTime
    ? new Date(station.lastReceivedTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

  return (
    <div className="glass-card flex max-w-[380px] flex-col gap-2.5 p-3 font-mono text-xs" style={{ color: "var(--text2)" }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-semibold" style={{ color: "var(--text)" }}>
            {station.id}
          </span>
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: "var(--text3)" }}>
            {station.name}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close station radar"
          style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", flexShrink: 0 }}
        >
          <i className="ph ph-x" aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <span>
          Scan: {scanTime}{" "}
          {live ? <span style={{ color: "var(--danger)" }}>Live</span> : <span style={{ color: "var(--text3)" }}>Delayed</span>}
        </span>
        <span>
          VCP: {station.vcp ?? "—"} ({vcpLabel(station.vcp)})
        </span>
        {hasSails(station.vcp) && (
          <span
            className="rounded-full px-2 py-0.5"
            style={{ background: "var(--accent-glow)", color: "var(--accent2)" }}
            title="This VCP includes supplemental low-level scans (SAILS/MESO-SAILS) for faster updates between full volume scans."
          >
            FastScan
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {RADAR_PRODUCTS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`radar-product-btn ${p.id === productId ? "active" : ""}`}
            style={{ width: 68, flexShrink: 0 }}
            onClick={() => onProductChange(p.id)}
            title={p.description}
          >
            <img src={stationLegendUrl(station.id, p)} alt="" className="radar-product-legend" />
            <span>{p.label}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <WindCompass directionDeg={wind?.current.windDirectionDeg ?? 0} loading={windLoading} />
        <span>
          {wind
            ? `${fmtWind(wind.current.windSpeedKmh, unit)} ${windSpeedUnit(unit)} ${windDirLabel(wind.current.windDirectionDeg)}`
            : "Wind —"}
        </span>
      </div>
    </div>
  );
}
