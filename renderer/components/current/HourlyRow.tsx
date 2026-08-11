"use client";

import { selectUpcomingHours } from "@/lib/hourly";
import { wmoPhosphorName } from "@/lib/icons/wmo";
import { fmtHourLabel, fmtTemp } from "@/lib/units";
import type { HourlyPoint } from "@/types/weather";
import type { TimeFormatPref, UnitPref } from "@/types/settings";

export function HourlyRow({
  hourly,
  unit,
  timeFormat,
}: {
  hourly: HourlyPoint[];
  unit: UnitPref;
  timeFormat: TimeFormatPref;
}) {
  const cards = selectUpcomingHours(hourly);

  return (
    <div className="hourly-scroll thin-scroll" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6 }}>
      {cards.map((h, i) => (
        <div key={h.time} className={`hour-card ${i === 0 ? "now" : ""}`}>
          <div className="hour-time">{i === 0 ? "NOW" : fmtHourLabel(h.time, timeFormat)}</div>
          <div className="hour-icon">
            <i className={`ph ph-${wmoPhosphorName(h.weatherCode, h.isDay)} hour-icon-glyph`} aria-hidden="true" />
          </div>
          <div className="hour-temp">
            {fmtTemp(h.temperatureC, unit)}°
          </div>
          {h.precipitationProbabilityPct > 0 && <div className="hour-pop">{h.precipitationProbabilityPct}%</div>}
        </div>
      ))}
    </div>
  );
}
