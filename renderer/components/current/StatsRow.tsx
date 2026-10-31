"use client";

import { fmtWind, windDirLabel, windSpeedUnit } from "@/lib/units";
import type { CurrentConditions } from "@/types/weather";
import type { UnitPref } from "@/types/settings";

export function StatsRow({ current, unit }: { current: CurrentConditions | undefined; unit: UnitPref }) {
  const stats = [
    { label: "Humidity", value: current?.relativeHumidityPct, suffix: "%", icon: "ph-drop" },
    { label: "Wind", value: fmtWind(current?.windSpeedKmh as number, unit), suffix: windSpeedUnit(unit), icon: "ph-wind" },
    { label: "Wind Dir", value: windDirLabel(current?.windDirectionDeg as number), suffix: "", icon: "ph-compass" },
    { label: "Precip", value: current?.precipitationMm.toFixed(1), suffix: "mm", icon: "ph-umbrella" },
  ];

  return (
    <div className="grid h-full content-center gap-x-6 gap-y-3 px-1 grid-cols-[repeat(auto-fit,minmax(84px,1fr))]">
      {stats.map((s) => (
        <div key={s.label}>
          <div className="font-mono flex flex-row items-center gap-1 uppercase text-xs text-nowrap text-muted-foreground"><i className={`ph ${s.icon}`} aria-hidden="true" /> {s.label}</div>
          <div className="text-lg">
            {s.value}
            {s.suffix && <span className="stat-unit">{s.suffix}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
