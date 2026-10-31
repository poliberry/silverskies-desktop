"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertLog } from "@/components/alerts/AlertLog";
import { RadarMap } from "@/components/radar/RadarMap";
import { RadarSettingsDropdowns } from "@/components/radar/RadarSettingsDropdowns";
import { CurrentConditions } from "@/components/current/CurrentConditions";
import { StatsRow } from "@/components/current/StatsRow";
import { HourlyRow } from "@/components/current/HourlyRow";
import { ForecastList } from "@/components/current/ForecastList";
import { ConditionsDetail } from "@/components/current/ConditionsDetail";
import { SunCard } from "@/components/current/SunCard";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchWeatherMaps, type BBox } from "@/lib/alerts/librewxr";
import type { BentoTileId } from "@/lib/bento-layout";
import type { RadarSettings } from "@/hooks/useRadarSettings";
import type { NormalizedWeather } from "@/types/weather";
import type { NormalizedAlert } from "@/types/alerts";
import type { TodayOutlook } from "@/lib/forecast-outlook";
import type { SpcOutlookFeature } from "@/lib/alerts/spc-outlook";
import type { TimeFormatPref, UnitPref } from "@/types/settings";
import type { WindowLocation } from "@/types/windows";

export interface RadarTileData {
  libreWxrHost: string;
  spcOutlookEnabled: boolean;
  settings: RadarSettings;
  preloadLocations?: { lat: number; lon: number }[];
  onBoundsChange: (bounds: BBox) => void;
  /** False while the host doesn't yet know whether it should mount the map
   * at all (Shell, until it has asked main which tiles are popped out) —
   * shows a skeleton instead of mounting a map that may immediately unmount. */
  ready?: boolean;
}

export interface AlertsTileData {
  alerts: NormalizedAlert[];
  isLoading: boolean;
  demoAlerts?: NormalizedAlert[];
  todayOutlook: TodayOutlook | null;
  spcOutlook: SpcOutlookFeature | null;
  onPopOut?: () => void;
  headerLeading?: ReactNode;
  headerClassName?: string;
}

export interface TileBodyProps {
  id: BentoTileId;
  location: WindowLocation | null;
  weather: NormalizedWeather | undefined;
  unit: UnitPref;
  timeFormat: TimeFormatPref;
  theme: "light" | "dark";
  /** Only needed for the radar tile. */
  radar?: RadarTileData;
  /** Only needed for the audit-log tile. */
  alerts?: AlertsTileData;
}

export function TileLoading() {
  return <Skeleton className="h-full w-full rounded-lg bg-muted/40" />;
}

/** The content of one bento tile — shared by the main window's grid (Shell)
 * and a popped-out tile's own window (TileWindow), so a tile looks and
 * behaves identically wherever it lives. Chrome (header, frame) is the
 * host's job; this only renders what goes inside. */
export function TileBody({ id, location, weather, unit, timeFormat, theme, radar, alerts }: TileBodyProps) {
  switch (id) {
    case "current":
      return weather ? (
        <CurrentConditions current={weather.current} today={weather.daily[0]} unit={unit} />
      ) : (
        <TileLoading />
      );
    case "stats":
      return weather ? <StatsRow current={weather.current} unit={unit} /> : <TileLoading />;
    case "hourly":
      return weather ? <HourlyRow hourly={weather.hourly} unit={unit} timeFormat={timeFormat} /> : <TileLoading />;
    case "forecast":
      return weather ? <ForecastList daily={weather.daily} unit={unit} /> : <TileLoading />;
    case "details":
      return weather ? (
        <ConditionsDetail current={weather.current} today={weather.daily[0]} unit={unit} />
      ) : (
        <TileLoading />
      );
    case "sun":
      return weather?.daily[0] ? (
        <SunCard sunrise={weather.daily[0].sunrise} sunset={weather.daily[0].sunset} />
      ) : (
        <TileLoading />
      );
    case "radar":
      return location && radar && radar.ready !== false ? (
        <RadarMap
          lat={location.lat}
          lon={location.lon}
          label={location.label}
          libreWxrHost={radar.libreWxrHost}
          theme={theme}
          preloadLocations={radar.preloadLocations}
          spcOutlookEnabled={radar.spcOutlookEnabled}
          settings={radar.settings}
          // Radar settings live in the tile's header (RadarTileSettings),
          // leaving only a slim collapsible playback strip under the map.
          renderSettingsInline={false}
          onBoundsChange={radar.onBoundsChange}
        />
      ) : (
        <div className="h-full p-3">
          <TileLoading />
        </div>
      );
    case "alerts":
      return alerts ? (
        <AlertLog
          alerts={alerts.alerts}
          isLoading={alerts.isLoading}
          demoAlerts={alerts.demoAlerts}
          todayOutlook={alerts.todayOutlook}
          spcOutlook={alerts.spcOutlook}
          onPopOutAuditLog={alerts.onPopOut}
          headerLeading={alerts.headerLeading}
          headerClassName={alerts.headerClassName}
        />
      ) : (
        <TileLoading />
      );
  }
}

/** The radar type/layers dropdowns, for whichever header hosts the radar
 * tile (the grid tile's header, or a popped-out radar tile's title bar). */
export function RadarTileSettings({
  libreWxrHost,
  settings,
  overlaysAvailable,
}: {
  libreWxrHost: string;
  settings: RadarSettings;
  overlaysAvailable: boolean;
}) {
  // Same queryKey as LeafletRadarMap's own — shares its cache; fetched here
  // only for the color-scheme names.
  const { data: weatherMaps } = useQuery({
    queryKey: ["librewxr-weather-maps", libreWxrHost],
    queryFn: () => fetchWeatherMaps(libreWxrHost),
    refetchInterval: 2 * 60_000,
    refetchIntervalInBackground: true,
  });
  return (
    <div className="no-tile-drag">
      <RadarSettingsDropdowns
        colorSchemes={weatherMaps?.radar.colorSchemes ?? []}
        settings={settings}
        overlaysAvailable={overlaysAvailable}
      />
    </div>
  );
}
