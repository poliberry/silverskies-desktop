"use client";

import { wmoIconUrl, wmoLabel } from "@/lib/icons/wmo";
import { fmtTemp, unitSuffix } from "@/lib/units";
import type { CurrentConditions as CurrentConditionsData, DailyPoint } from "@/types/weather";
import type { UnitPref } from "@/types/settings";

export function CurrentConditions({
  current,
  today,
  unit,
  theme,
}: {
  current: CurrentConditionsData;
  today: DailyPoint | undefined;
  unit: UnitPref;
  theme: "light" | "dark";
}) {
  return (
    <div className="current-grid" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
      <div>
        <div className="condition-label">Current Conditions</div>
        <div className="temp-big">
          {fmtTemp(current.temperatureC, unit)}
          <span className="unit">{unitSuffix(unit)}</span>
        </div>
        <div className="condition-text">{wmoLabel(current.weatherCode)}</div>
        <div className="feels-like">
          FEELS LIKE {fmtTemp(current.apparentTemperatureC, unit)}
          {unitSuffix(unit)}
          {today && (
            <>
              {" "}
              · HIGH {fmtTemp(today.tempMaxC, unit)}
              {unitSuffix(unit)}
            </>
          )}
        </div>
      </div>
      <div className="icon-glow-wrap">
        <div className="icon-glow-ellipse" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="wx-icon-lg"
          src={wmoIconUrl(current.weatherCode, current.isDay, theme)}
          alt={wmoLabel(current.weatherCode)}
        />
      </div>
    </div>
  );
}
