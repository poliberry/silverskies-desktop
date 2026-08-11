"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { CurrentConditions } from "@/components/current/CurrentConditions";
import { StatsRow } from "@/components/current/StatsRow";
import { HourlyRow } from "@/components/current/HourlyRow";
import { ForecastList } from "@/components/current/ForecastList";
import { ConditionsDetail } from "@/components/current/ConditionsDetail";
import { SunCard } from "@/components/current/SunCard";
import type { NormalizedWeather } from "@/types/weather";
import type { TimeFormatPref, UnitPref } from "@/types/settings";

export interface RightSidebarProps {
  weather: NormalizedWeather | undefined;
  isLoading: boolean;
  error: string | null;
  unit: UnitPref;
  timeFormat: TimeFormatPref;
  theme: "light" | "dark";
}

export function RightSidebar({ weather, isLoading, error, unit, timeFormat, theme }: RightSidebarProps) {
  return (
    <aside className="glass-card flex h-full min-h-0 flex-col overflow-hidden">
      <ScrollArea className="thin-scroll min-h-0 flex-1">
        <div className="flex flex-col gap-5 p-4">
          {isLoading && !weather && (
            <div className="loading-overlay" style={{ textAlign: "center", padding: "48px 0" }}>
              <div className="loading-spinner" />
              <div className="loading-text">Fetching weather…</div>
            </div>
          )}
          {error && <div className="error-box">⚠ {error}</div>}

          {weather && (
            <>
              <CurrentConditions current={weather.current} today={weather.daily[0]} unit={unit} theme={theme} />
              <StatsRow current={weather.current} unit={unit} />

              <div>
                <div className="section-header">
                  <div className="section-title">Hourly</div>
                  <div className="section-line" />
                </div>
                <HourlyRow hourly={weather.hourly} unit={unit} timeFormat={timeFormat} />
              </div>

              <div>
                <div className="section-header">
                  <div className="section-title">7-Day Forecast</div>
                  <div className="section-line" />
                </div>
                <ForecastList daily={weather.daily} unit={unit} />
              </div>

              <div>
                <div className="section-header">
                  <div className="section-title">Conditions Detail</div>
                  <div className="section-line" />
                </div>
                <ConditionsDetail current={weather.current} today={weather.daily[0]} unit={unit} />
              </div>

              {weather.daily[0] && (
                <div>
                  <div className="section-header">
                    <div className="section-title">Sun Position</div>
                    <div className="section-line" />
                  </div>
                  <SunCard sunrise={weather.daily[0].sunrise} sunset={weather.daily[0].sunset} />
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
