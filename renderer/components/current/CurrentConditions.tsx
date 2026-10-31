"use client";

import { WeatherIcon } from "@/components/icons/WeatherIcon";
import { wmoLabel } from "@/lib/icons/wmo";
import { fmtTemp, unitSuffix } from "@/lib/units";
import type { CurrentConditions as CurrentConditionsData, DailyPoint } from "@/types/weather";
import type { UnitPref } from "@/types/settings";

export function CurrentConditions({
  current,
  today,
  unit,
}: {
  current: CurrentConditionsData | undefined;
  today: DailyPoint | undefined;
  unit: UnitPref;
}) {
  return (
    <div className="flex h-full flex-row items-center justify-between gap-4 px-1">
      <div>
        <div className="temp-big">
          {fmtTemp(current?.temperatureC as number, unit)}
          <span className="unit">{unitSuffix(unit)}</span>
        </div>
        <div className="condition-text">{wmoLabel(current?.weatherCode as number)}</div>
        <div className="feels-like">
          FEELS LIKE {fmtTemp(current?.apparentTemperatureC as number, unit)}
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
        <WeatherIcon
          className="wx-icon-lg"
          size={96}
          code={current?.weatherCode as number}
          isDay={current?.isDay as boolean}
        />
      </div>
    </div>
  );
}
