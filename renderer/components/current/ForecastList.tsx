"use client";

import { wmoPhosphorName } from "@/lib/icons/wmo";
import { fmtDayLabel, fmtTemp } from "@/lib/units";
import type { DailyPoint } from "@/types/weather";
import type { UnitPref } from "@/types/settings";

export function ForecastList({ daily, unit }: { daily: DailyPoint[]; unit: UnitPref }) {
  const highs = daily.map((d) => d.tempMaxC);
  const minH = Math.min(...highs);
  const maxH = Math.max(...highs);

  return (
    <div className="flex flex-col gap-1.5">
      {daily.map((d, i) => {
        const pct = maxH === minH ? 50 : Math.round(((d.tempMaxC - minH) / (maxH - minH)) * 100);
        const pop = d.precipitationProbabilityMaxPct || 0;
        return (
          <div key={d.date} className={`forecast-row ${i === 0 ? "today" : ""}`}>
            <div className="forecast-day">{fmtDayLabel(d.date, i)}</div>
            <div className="forecast-icon">
              <i className={`ph ph-${wmoPhosphorName(d.weatherCode, true)} forecast-icon-glyph`} aria-hidden="true" />
            </div>
            <div>
              <div className="temp-bar-bg">
                <div className="temp-bar-fill" style={{ width: `${pct}%` }} />
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
