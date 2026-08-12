"use client";

import { wmoPhosphorName } from "@/lib/icons/wmo";
import { fmtDayLabel, fmtTemp } from "@/lib/units";
import type { DailyPoint } from "@/types/weather";
import type { UnitPref } from "@/types/settings";

export function ForecastList({ daily, unit }: { daily: DailyPoint[]; unit: UnitPref }) {
  // The bar for each day should show where *that day's* low–high range sits
  // within the week's overall range — not just each day's high as a width
  // from the track's left edge (the previous behavior), which made a mild
  // day and a scorching day with the same high look identical.
  const lows = daily.map((d) => d.tempMinC);
  const highs = daily.map((d) => d.tempMaxC);
  const weekMin = Math.min(...lows);
  const weekMax = Math.max(...highs);
  const weekRange = weekMax - weekMin;

  return (
    <div className="flex flex-col gap-1.5">
      {daily.map((d, i) => {
        const leftPct = weekRange === 0 ? 0 : ((d.tempMinC - weekMin) / weekRange) * 100;
        const widthPct = weekRange === 0 ? 100 : ((d.tempMaxC - d.tempMinC) / weekRange) * 100;
        const pop = d.precipitationProbabilityMaxPct || 0;
        return (
          <div key={d.date} className={`forecast-row ${i === 0 ? "today" : ""}`}>
            <div className="forecast-day">{fmtDayLabel(d.date, i)}</div>
            <div className="forecast-icon">
              <i className={`ph ph-${wmoPhosphorName(d.weatherCode, true)} forecast-icon-glyph`} aria-hidden="true" />
            </div>
            <div>
              <div className="temp-bar-bg">
                <div className="temp-bar-fill" style={{ left: `${leftPct}%`, width: `${widthPct}%` }} />
              </div>
              <div className="temp-bar-labels">
                <span>
                  {fmtTemp(d.tempMinC, unit)}°{unit}
                </span>
                <span />
              </div>
            </div>
            <div className="forecast-high">
              {fmtTemp(d.tempMaxC, unit)}°{unit}
            </div>
            <div className="forecast-pop">{pop > 0 ? `${pop}%` : "—"}</div>
          </div>
        );
      })}
    </div>
  );
}
