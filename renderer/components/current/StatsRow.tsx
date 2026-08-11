"use client";

import { fmtWind, windDirLabel, windSpeedUnit } from "@/lib/units";
import type { CurrentConditions } from "@/types/weather";
import type { UnitPref } from "@/types/settings";

export function StatsRow({ current, unit }: { current: CurrentConditions; unit: UnitPref }) {
  const stats = [
    { label: "Humidity", value: current.relativeHumidityPct, suffix: "%", icon: "ph-drop" },
    { label: "Wind", value: fmtWind(current.windSpeedKmh, unit), suffix: windSpeedUnit(unit), icon: "ph-wind" },
    { label: "Wind Dir", value: windDirLabel(current.windDirectionDeg), suffix: "", icon: "ph-compass" },
    { label: "Precip", value: current.precipitationMm.toFixed(1), suffix: "mm", icon: "ph-umbrella" },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {stats.map((s) => (
        <div key={s.label} className="stat-card">
          <div className="stat-label">{s.label}</div>
          <div className="stat-value">
            {s.value}
            {s.suffix && <span className="stat-unit">{s.suffix}</span>}
          </div>
          <div className="stat-icon">
            <i className={`ph ${s.icon}`} aria-hidden="true" />
          </div>
        </div>
      ))}
    </div>
  );
}
