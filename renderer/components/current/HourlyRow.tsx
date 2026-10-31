"use client";

import { WeatherIcon } from "@/components/icons/WeatherIcon";
import { selectUpcomingHours } from "@/lib/hourly";
import { fmtHourLabel, fmtTemp } from "@/lib/units";
import type { HourlyPoint } from "@/types/weather";
import type { TimeFormatPref, UnitPref } from "@/types/settings";

export function HourlyRow({
  hourly,
  unit,
  timeFormat,
}: {
  hourly: HourlyPoint[] | undefined;
  unit: UnitPref;
  timeFormat: TimeFormatPref;
}) {
  const cards = selectUpcomingHours(hourly as HourlyPoint[]);

  return (
    // Edge fade via mask rather than gradient overlays, so it blends into
    // whatever tile/theme background sits behind it.
    <div className="flex h-full items-center overflow-x-auto thin-scroll [mask-image:linear-gradient(to_right,transparent,black_16px,black_calc(100%-24px),transparent)]">
      <div className="flex flex-row items-center gap-6 px-3">
        {cards.map((h, i) => (
          <div
            key={h.time}
            className="shrink-0 space-y-2 flex flex-col items-center"
          >
            <div className="text-xs w-fit text-nowrap font-mono text-muted-foreground">
              {i === 0 ? "NOW" : fmtHourLabel(h.time, timeFormat)}
            </div>

            <div className="relative">
              <WeatherIcon code={h.weatherCode} isDay={h.isDay} size={32} />

              {h.precipitationProbabilityPct > 0 && (
                <div className="text-[8px] rounded-full bg-transparent backdrop-blur-xl absolute bottom-0 -right-1 p-1">
                  {h.precipitationProbabilityPct}%
                </div>
              )}
            </div>

            <div className="hour-temp">
              {fmtTemp(h.temperatureC, unit)}°{unit}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
