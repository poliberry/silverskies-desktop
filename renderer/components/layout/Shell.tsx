"use client";

import { useState } from "react";
import { TopBar } from "./TopBar";
import { LeftSidebar } from "./LeftSidebar";
import { RightSidebar } from "./RightSidebar";
import { AlertLog } from "@/components/alerts/AlertLog";
import { RadarMap } from "@/components/radar/RadarMap";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { useActiveLocation } from "@/hooks/useActiveLocation";
import { useSavedLocations } from "@/hooks/useSavedLocations";
import { useSettings } from "@/hooks/useSettings";
import { useWeather } from "@/hooks/useWeather";
import { useAlerts } from "@/hooks/useAlerts";
import { useSpcOutlook } from "@/hooks/useSpcOutlook";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { useConditionAccent } from "@/hooks/useConditionAccent";
import { useSeverePulse } from "@/hooks/useSeverePulse";
import { useFavicon } from "@/hooks/useFavicon";
import { useTaskbarBadge } from "@/hooks/useTaskbarBadge";
import { useAsteroid } from "@/hooks/useAsteroid";
import { useLocationWatcher } from "@/hooks/useLocationWatcher";
import { AsteroidCountdown } from "@/components/easter-eggs/AsteroidCountdown";
import { activeSeverePulseColor } from "@/lib/alerts/merge";
import { findOutlookAtPoint } from "@/lib/alerts/spc-outlook";
import { buildTodayOutlook } from "@/lib/forecast-outlook";
import { ProviderConfigError } from "@/lib/providers";
import type { NormalizedAlert } from "@/types/alerts";
import type { UnitPref } from "@/types/settings";

export function Shell() {
  const { config, updateConfig } = useSettings();
  const { savedLocations, addLocation, removeLocation } = useSavedLocations();
  const { active, isLocating, geoError, searchError, requestGps, searchAndSelect, selectSaved } =
    useActiveLocation();

  const weatherQuery = useWeather(active);
  const alertsQuery = useAlerts(active?.lat ?? null, active?.lon ?? null);
  const spcOutlookEnabled = config?.spcOutlookEnabled ?? true;
  const spcOutlookQuery = useSpcOutlook(spcOutlookEnabled);
  const [demoAlerts, setDemoAlerts] = useState<NormalizedAlert[]>([]);
  // The asteroid easter egg forces a specific pulse color directly rather
  // than deriving one from alert classification (it isn't a real hazard
  // class) — this takes priority over whatever the real/demo alerts imply.
  const [forcedPulse, setForcedPulse] = useState<string | null>(null);

  const resolvedTheme = useResolvedTheme();
  useConditionAccent(weatherQuery.data?.current.weatherCode, weatherQuery.data?.current.isDay, resolvedTheme);
  useFavicon(weatherQuery.data?.current.weatherCode, weatherQuery.data?.current.isDay, resolvedTheme);
  useTaskbarBadge(weatherQuery.data?.current.weatherCode, weatherQuery.data?.current.isDay);

  // Checks every *saved* location on a timer (not just the active one) for
  // new alerts/notable forecasts and pushes toast notifications — see
  // useLocationWatcher.ts for why it deliberately doesn't also drive the
  // pulse below, which stays scoped to whatever's on screen.
  useLocationWatcher();

  const allAlertsForPulse = [...demoAlerts, ...(alertsQuery.data ?? [])];
  useSeverePulse(forcedPulse ?? activeSeverePulseColor(allAlertsForPulse), resolvedTheme);

  // Owned here (rather than inside the Settings dialog it's triggered from)
  // so the countdown overlay is a shell-level fixed element, not nested
  // inside a transformed dialog — `position:fixed` inside an ancestor with
  // an active `transform` (Base UI's dialog entrance animation) resolves
  // against *that* ancestor's box instead of the viewport, and the whole
  // point of this easter egg is a full-window takeover regardless of
  // whether Settings happens to still be open.
  const asteroid = useAsteroid({
    onDemoAlertsChange: setDemoAlerts,
    onForcePulse: setForcedPulse,
    onRefreshWeather: () => void weatherQuery.refetch(),
  });

  const unit: UnitPref = config?.units ?? "F";
  const timeFormat = config?.timeFormat ?? "12";
  const libreWxrHost = config?.libreWxrHost ?? "https://api.librewxr.net";

  const todayOutlook = weatherQuery.data
    ? buildTodayOutlook(weatherQuery.data.current, weatherQuery.data.daily[0], unit)
    : null;
  const spcOutlook =
    spcOutlookEnabled && active && spcOutlookQuery.data
      ? findOutlookAtPoint(spcOutlookQuery.data, active.lat, active.lon)
      : null;

  const weatherError =
    weatherQuery.error instanceof ProviderConfigError
      ? weatherQuery.error.message
      : weatherQuery.error instanceof Error
        ? `Couldn't load weather: ${weatherQuery.error.message}`
        : null;

  async function handleSaveCurrent(label: string) {
    if (!active) return;
    const updated = await addLocation({ label, lat: active.lat, lon: active.lon });
    const saved = updated.savedLocations.find(
      (l) => l.lat === active.lat && l.lon === active.lon && l.label === label,
    );
    if (saved) selectSaved(saved.id);
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden" style={{ background: "var(--bg)" }}>
      {/* #top-glow (app/layout.tsx) is a fixed strip right at the window's
          top edge with a soft blur that reaches past its own 4px height —
          this top padding just gives it room to fade out before reaching
          the TopBar's text, without covering the glow itself (it needs to
          stay visible, just not wash over the row below it). */}
      <div className="px-4 pt-6 pb-2">
        <TopBar
          locationLabel={active?.label ?? "—"}
          locationSub={
            active
              ? `${Math.abs(active.lat).toFixed(2)}°${active.lat < 0 ? "S" : "N"}  ${Math.abs(active.lon).toFixed(2)}°${active.lon < 0 ? "W" : "E"}`
              : "Locating…"
          }
          lastRefresh={weatherQuery.data ? new Date(weatherQuery.dataUpdatedAt) : null}
          isRefreshing={weatherQuery.isFetching}
          onRefresh={() => {
            void weatherQuery.refetch();
            void alertsQuery.refetch();
          }}
          unit={unit}
          onSetUnit={(u) => updateConfig({ units: u })}
          timezone={weatherQuery.data?.timezone}
          timeFormat={timeFormat}
        />
      </div>

      <div className="grid flex-1 min-h-0 gap-3 px-4 pb-4" style={{ gridTemplateColumns: "280px 1fr 340px" }}>
        <LeftSidebar
          active={active}
          savedLocations={savedLocations}
          isLocating={isLocating}
          geoError={geoError}
          searchError={searchError}
          onSearch={searchAndSelect}
          onGps={() => requestGps()}
          onSelectSaved={selectSaved}
          onRemoveSaved={(id) => void removeLocation(id)}
          onSaveCurrent={handleSaveCurrent}
          settingsSlot={
            <SettingsDialog
              demoAlerts={demoAlerts}
              onDemoAlertsChange={setDemoAlerts}
              onTriggerAsteroid={asteroid.trigger}
              asteroidActive={asteroid.isActive}
            />
          }
        />

        <div className="flex min-h-0 flex-col gap-4">
          <div className="min-h-0" style={{ flex: "2 1 0%" }}>
            {active && (
              <RadarMap
                lat={active.lat}
                lon={active.lon}
                label={active.label}
                libreWxrHost={libreWxrHost}
                theme={resolvedTheme}
                preloadLocations={savedLocations}
                spcOutlookEnabled={spcOutlookEnabled}
              />
            )}
          </div>
          <div className="glass-card min-h-0 p-3" style={{ flex: "1 1 0%" }}>
            <AlertLog
              alerts={alertsQuery.data ?? []}
              isLoading={alertsQuery.isLoading}
              demoAlerts={demoAlerts}
              todayOutlook={todayOutlook}
              spcOutlook={spcOutlook}
            />
          </div>
        </div>

        <RightSidebar
          weather={weatherQuery.data}
          isLoading={weatherQuery.isLoading}
          error={weatherError}
          unit={unit}
          timeFormat={timeFormat}
          theme={resolvedTheme}
        />
      </div>

      <AsteroidCountdown isActive={asteroid.isActive} secondsLeft={asteroid.secondsLeft} />
    </div>
  );
}
