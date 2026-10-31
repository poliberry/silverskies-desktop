"use client";

import { useEffect, useState } from "react";
import { TileBody, RadarTileSettings } from "@/components/bento/TileBody";
import { BentoTileAction } from "@/components/bento/BentoTile";
import { WindowControlButtons } from "@/components/layout/WindowControlButtons";
import { useSettings } from "@/hooks/useSettings";
import { useWeather } from "@/hooks/useWeather";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { useAppliedTheme } from "@/hooks/useAppliedTheme";
import { useConditionAccent } from "@/hooks/useConditionAccent";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useRadarSettings } from "@/hooks/useRadarSettings";
import { useAlertsForBounds } from "@/hooks/useAlertsForBounds";
import { useSpcOutlook } from "@/hooks/useSpcOutlook";
import { ipc } from "@/lib/ipc-client";
import { BENTO_TILE_BY_ID, type BentoTileId } from "@/lib/bento-layout";
import { findOutlookAtPoint } from "@/lib/alerts/spc-outlook";
import { buildTodayOutlook } from "@/lib/forecast-outlook";
import { cn } from "@/lib/utils";
import type { BBox } from "@/lib/alerts/librewxr";
import type { UnitPref } from "@/types/settings";
import type { WindowLocation } from "@/types/windows";

export interface TileWindowProps {
  tileId: BentoTileId;
  initialLocation: WindowLocation | null;
}

/**
 * One bento tile popped out of the main window into its own window. Always
 * paired to the main window (the "main" sentinel — see windows:openTile in
 * electron/main.ts), so it follows the main window's location, and derives
 * its own data independently rather than receiving it over IPC — the same
 * pattern every other pop-out window already uses. Closing it (or "Dock")
 * puts the tile back into the main window's grid.
 */
export function TileWindow({ tileId, initialLocation }: TileWindowProps) {
  const meta = BENTO_TILE_BY_ID[tileId];
  const [location, setLocation] = useState<WindowLocation | null>(initialLocation);
  useEffect(() => ipc.windows.onInstanceLocation(setLocation), []);

  const { config } = useSettings();
  const theme = useResolvedTheme();
  useAppliedTheme();
  const weatherQuery = useWeather(location);
  const weather = weatherQuery.data;
  useConditionAccent(weather?.current.weatherCode, weather?.current.isDay, theme, (config?.themeId ?? "default") === "default");
  useDocumentTitle(location ? `${location.label} - ${meta.title} - Silver Skies` : `${meta.title} - Silver Skies`);

  const unit: UnitPref = config?.units ?? "F";
  const timeFormat = config?.timeFormat ?? "12";
  const libreWxrHost = config?.libreWxrHost ?? "https://api.librewxr.net";
  const spcOutlookEnabled = config?.spcOutlookEnabled ?? true;

  // Radar tile: reports its viewport under the "main" sentinel, exactly like
  // the docked radar does, so the main window's audit log (docked or popped
  // out) keeps following whatever this map is showing.
  const radarSettings = useRadarSettings();

  // Audit-log tile: follows the main radar's viewport (docked or popped out).
  const isAlerts = tileId === "alerts";
  const [bounds, setBounds] = useState<BBox | null>(null);
  useEffect(() => (isAlerts ? ipc.windows.onInstanceBounds(setBounds) : undefined), [isAlerts]);
  useEffect(() => {
    if (!isAlerts) return;
    let cancelled = false;
    void ipc.windows.getInstanceBounds("main").then((cached) => {
      if (!cancelled && cached) setBounds((current) => current ?? cached);
    });
    return () => {
      cancelled = true;
    };
  }, [isAlerts]);
  const alertsQuery = useAlertsForBounds(isAlerts ? bounds : null);
  const spcOutlookQuery = useSpcOutlook(isAlerts && spcOutlookEnabled);

  const isMac = /Mac/i.test(navigator.userAgent);

  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
      style={{ background: "linear-gradient(to bottom right, rgba(var(--a0), 1), var(--background))" }}
    >
      <section className="bento-tile bento-tile-window">
        <header
          className="bento-tile-header drag-region"
          // Leaves room for macOS's traffic lights (trafficLightPosition in
          // electron/main.ts); other platforms draw WindowControlButtons.
          style={isMac ? { paddingLeft: 76 } : undefined}
        >
          <i className={`ph ph-${meta.icon} bento-tile-icon`} aria-hidden="true" />
          <h1 className="bento-tile-title">{tileId === "current" && location ? location.label : meta.title}</h1>
          {location && tileId !== "current" && (
            <span className="truncate font-mono text-[0.65rem]" style={{ color: "var(--text3)", opacity: 0.8 }}>
              · {location.label}
            </span>
          )}
          <div className="flex-1" />
          <div className="bento-tile-actions no-drag">
            {tileId === "radar" && (
              <RadarTileSettings
                libreWxrHost={libreWxrHost}
                settings={radarSettings}
                overlaysAvailable={Boolean(config?.openWeatherMapApiKey)}
              />
            )}
            <BentoTileAction icon="arrow-square-in" label="Dock back into the main window" onClick={() => void ipc.windowControls.close()} />
            {!isMac && <WindowControlButtons iconSize={11} />}
          </div>
        </header>
        <div
          className={cn(
            "bento-tile-body",
            meta.flush && "bento-tile-body-flush",
            meta.headerless && "pt-1",
            meta.bodyClassName,
          )}
        >
          <TileBody
            id={tileId}
            location={location}
            weather={weather}
            unit={unit}
            timeFormat={timeFormat}
            theme={theme}
            radar={{
              libreWxrHost,
              spcOutlookEnabled,
              settings: radarSettings,
              onBoundsChange: (b) => ipc.windows.sendInstanceBounds("main", b),
            }}
            alerts={{
              alerts: alertsQuery.data ?? [],
              isLoading: alertsQuery.isLoading,
              todayOutlook: weather ? buildTodayOutlook(weather.current, weather.daily[0], unit) : null,
              spcOutlook:
                spcOutlookEnabled && location && spcOutlookQuery.data
                  ? findOutlookAtPoint(spcOutlookQuery.data, location.lat, location.lon)
                  : null,
            }}
          />
        </div>
      </section>
    </div>
  );
}
