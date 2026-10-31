"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ipc } from "@/lib/ipc-client";
import { LeftSidebar } from "./LeftSidebar";
import { ShellToolbar } from "./ShellToolbar";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { useActiveLocation } from "@/hooks/useActiveLocation";
import { useSavedLocations } from "@/hooks/useSavedLocations";
import { useSettings } from "@/hooks/useSettings";
import { useWeather } from "@/hooks/useWeather";
import { useAlerts } from "@/hooks/useAlerts";
import { useAlertsForBounds } from "@/hooks/useAlertsForBounds";
import { useSpcOutlook } from "@/hooks/useSpcOutlook";
import { useRadarSettings } from "@/hooks/useRadarSettings";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { useAppliedTheme } from "@/hooks/useAppliedTheme";
import { useConditionAccent } from "@/hooks/useConditionAccent";
import { useSeverePulse } from "@/hooks/useSeverePulse";
import { useFavicon } from "@/hooks/useFavicon";
import { useTaskbarBadge } from "@/hooks/useTaskbarBadge";
import { useAsteroid } from "@/hooks/useAsteroid";
import { useActiveLocationAlertNotifications, useLocationWatcher } from "@/hooks/useLocationWatcher";
import { useLogoClickCounter } from "@/hooks/useLogoClickCounter";
import { useWeatherRadio } from "@/hooks/useWeatherRadio";
import { useBentoLayout } from "@/hooks/useBentoLayout";
import { usePoppedOutTiles } from "@/hooks/usePoppedOutTiles";
import { AsteroidCountdown } from "@/components/easter-eggs/AsteroidCountdown";
import { AsteroidShooterGame } from "@/components/easter-eggs/AsteroidShooterGame";
import { activeSeverePulseColor } from "@/lib/alerts/merge";
import { findOutlookAtPoint } from "@/lib/alerts/spc-outlook";
import { buildTodayOutlook } from "@/lib/forecast-outlook";
import { ProviderConfigError } from "@/lib/providers";
import { BENTO_TILES, type BentoTileId } from "@/lib/bento-layout";
import type { BBox } from "@/lib/alerts/librewxr";
import type { NormalizedAlert } from "@/types/alerts";
import type { UnitPref } from "@/types/settings";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoGrip, BentoTile, BentoTileAction } from "@/components/bento/BentoTile";
import { RadarTileSettings, TileBody } from "@/components/bento/TileBody";
import { SidebarInset, SidebarProvider } from "../ui/sidebar";
import { Omnibox } from "../locations/Omnibox";
import { cn } from "@/lib/utils";

export function Shell() {
  const { config, updateConfig } = useSettings();
  const { savedLocations, addLocation, removeLocation } = useSavedLocations();
  const {
    active,
    isLocating,
    geoError,
    searchError,
    requestGps,
    searchAndSelect,
    selectSaved,
    selectPlace,
  } = useActiveLocation();

  const weatherQuery = useWeather(active);
  // Point-based, for the active/searched location — drives the severe-pulse
  // glow, favicon, and taskbar badge below, all of which are meant to track
  // "the location I'm looking at," not wherever the radar map happens to be
  // panned to at the moment. The audit log itself uses a separate,
  // bbox-based query (see radarBounds/boundsAlertsQuery below) so panning
  // the radar around doesn't also make the whole window pulse for whatever
  // happens to be on screen.
  const alertsQuery = useAlerts(active?.lat ?? null, active?.lon ?? null);
  // The docked radar's own current viewport (or its active shift-drag
  // selection), reported by RadarMap's onBoundsChange below — or, when the
  // radar is popped out instead, relayed here over IPC under the "main"
  // sentinel from that pop-out's own RadarWindow (see RadarWindow.tsx's
  // boundsInstanceId). Feeds the audit log so it always reflects whatever's
  // actually visible on "the radar," docked or not.
  const [radarBounds, setRadarBounds] = useState<BBox | null>(null);
  useEffect(() => ipc.windows.onInstanceBounds(setRadarBounds), []);
  // Covers the case where the primary radar was already popped out (and had
  // already reported its own bbox) before Shell (re)mounted — a reload, or a
  // pop-out restored from session.json on relaunch — so onInstanceBounds'
  // live-only relay alone would leave this at null until the next pan/zoom.
  // When the radar is docked instead, RadarMap's own onBoundsChange below
  // reports its bbox directly on mount, so this is a harmless no-op there.
  useEffect(() => {
    let cancelled = false;
    void ipc.windows.getInstanceBounds("main").then((cached) => {
      if (cancelled || !cached) return;
      setRadarBounds((current) => current ?? cached);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const boundsAlertsQuery = useAlertsForBounds(radarBounds);
  const spcOutlookEnabled = config?.spcOutlookEnabled ?? true;
  const spcOutlookQuery = useSpcOutlook(spcOutlookEnabled);
  const radarSettings = useRadarSettings();
  // Which bento tiles are currently open in their own window — see
  // usePoppedOutTiles and windows:openTile in electron/main.ts.
  const tilePopouts = usePoppedOutTiles();
  const [demoAlerts, setDemoAlerts] = useState<NormalizedAlert[]>([]);

  // 2% chance, rolled once per mount — see the root div's background below.
  const [cowBackgroundActive] = useState(() => Math.random() < 0.02);

  // Logo-click asteroid *shooter* easter egg — distinct from the
  // useAsteroid "Asteroid Impact Warning" demo-alert countdown below, which
  // is an unrelated existing easter egg that just happens to share the name.
  const [showAsteroidGame, setShowAsteroidGame] = useState(false);
  const handleLogoClick = useLogoClickCounter(() => setShowAsteroidGame(true));

  // NWS weather radio — watches the active location's alerts plus whatever
  // the radar's currently showing on screen (deduped by id) for new arrivals
  // to announce; see useWeatherRadio for the simulated tone+speech pipeline
  // itself (live mode's audio comes from a real stream instead, played from
  // the standalone Weather Radio pop-up window — see onOpenRadio below).
  const radioAlertIds = new Set<string>();
  const radioAlerts = [
    ...(alertsQuery.data ?? []),
    ...(boundsAlertsQuery.data ?? []),
  ].filter((a) => {
    if (radioAlertIds.has(a.id)) return false;
    radioAlertIds.add(a.id);
    return true;
  });
  useWeatherRadio({
    enabled: config?.weatherRadioEnabled ?? false,
    mode: config?.weatherRadioMode ?? "simulated",
    alerts: radioAlerts,
  });

  // The asteroid easter egg forces a specific pulse color directly rather
  // than deriving one from alert classification (it isn't a real hazard
  // class) — this takes priority over whatever the real/demo alerts imply.
  const [forcedPulse, setForcedPulse] = useState<string | null>(null);

  const resolvedTheme = useResolvedTheme();
  useAppliedTheme();
  useConditionAccent(
    weatherQuery.data?.current.weatherCode,
    weatherQuery.data?.current.isDay,
    resolvedTheme,
    (config?.themeId ?? "default") === "default",
  );
  useFavicon(
    weatherQuery.data?.current.weatherCode,
    weatherQuery.data?.current.isDay,
    resolvedTheme,
  );
  useTaskbarBadge(
    weatherQuery.data?.current.weatherCode,
    weatherQuery.data?.current.isDay,
  );

  // Checks every *saved* location on a timer (not just the active one) for
  // new alerts/notable forecasts and pushes toast notifications — see
  // useLocationWatcher.ts for why it deliberately doesn't also drive the
  // pulse below, which stays scoped to whatever's on screen.
  useLocationWatcher();
  // …and the location on screen, which may not be a saved one. Demo alerts
  // aren't included — they're for previewing styling, not for alarms.
  useActiveLocationAlertNotifications(alertsQuery.data, active?.label);

  const allAlertsForPulse = [...demoAlerts, ...(alertsQuery.data ?? [])];
  useSeverePulse(
    forcedPulse ?? activeSeverePulseColor(allAlertsForPulse),
    resolvedTheme,
  );

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
    ? buildTodayOutlook(
        weatherQuery.data.current,
        weatherQuery.data.daily[0],
        unit,
      )
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
    const updated = await addLocation({
      label,
      lat: active.lat,
      lon: active.lon,
    });
    const saved = updated.savedLocations.find(
      (l) => l.lat === active.lat && l.lon === active.lon && l.label === label,
    );
    if (saved) selectSaved(saved.id);
  }

  function handleNewRadarWindow() {
    void ipc.windows.openRadar({
      location: active
        ? { lat: active.lat, lon: active.lon, label: active.label }
        : null,
    });
  }

  // Keeps a popped-out "main" audit-log window (if any) live-updated as the
  // main window's own active location changes — a no-op relay on main's
  // side when no such window is open, exactly like a radar instance's own
  // sendInstanceLocation calls are harmless when it has no paired windows.
  useEffect(() => {
    if (active)
      ipc.windows.sendInstanceLocation("main", {
        lat: active.lat,
        lon: active.lon,
        label: active.label,
      });
    // Depends on the primitive fields, not `active` itself — avoids
    // re-sending on every render if the hook it comes from hands back a new
    // object reference for an unchanged location.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.lat, active?.lon, active?.label]);

  // Feeds both the docked audit log (local state) and any "main"-paired
  // audit-log pop-out (via the same IPC channel a popped-out primary radar
  // already uses for its own bounds) — without the relay, popping out only
  // the audit log while the radar stays docked would leave that window
  // stuck on whatever bounds it opened with (or none at all), since nothing
  // else ever tells it the docked radar panned or drew a selection. Also
  // keeps main's latestBoundsByInstance cache current for "main" so a
  // *later*-opened audit-log window can catch up immediately instead of
  // waiting for the next pan/zoom (see windows:getInstanceBounds).
  function handleRadarBoundsChange(bounds: BBox) {
    setRadarBounds(bounds);
    ipc.windows.sendInstanceBounds("main", bounds);
  }

  const bento = useBentoLayout();
  const overlaysAvailable = Boolean(config?.openWeatherMapApiKey);
  const activeWindowLocation = active ? { lat: active.lat, lon: active.lon, label: active.label } : null;

  function handleRefresh() {
    void weatherQuery.refetch();
    void alertsQuery.refetch();
    // react-query's refetch() runs the queryFn even when `enabled` is false
    // — useAlertsForBounds' queryFn indexes straight into the bbox tuple, so
    // calling this before the radar has ever reported bounds would throw on
    // a null bbox instead of just no-op'ing like the `enabled` guard implies.
    if (radarBounds) void boundsAlertsQuery.refetch();
  }

  // ── Bento canvas ──────────────────────────────────────────────────────
  // Every tile renders as soon as the canvas does — with a skeleton body
  // until its data arrives — so the arrangement never jumps around on load.
  // A tile is only *removed* from the grid (and the rest reflow into its
  // space) when it's hidden from the Tiles menu or popped out into its own
  // window; closing that window puts it back.
  const weather = weatherQuery.data;
  const tiles: Partial<Record<BentoTileId, ReactNode>> = {};
  for (const meta of BENTO_TILES) {
    const id = meta.id;
    if (bento.hidden.includes(id) || tilePopouts.poppedOut.has(id)) continue;
    const popOut = (e: React.MouseEvent<HTMLElement>) => tilePopouts.popOut(id, activeWindowLocation, e.currentTarget);
    const popOutAction = <BentoTileAction icon="arrow-square-out" label={`Pop out ${meta.title}`} onClick={popOut} />;
    tiles[id] = (
      <BentoTile
        title={id === "current" ? (active?.label ?? meta.title) : meta.title}
        icon={meta.icon}
        flush={meta.flush}
        headerless={meta.headerless}
        bodyClassName={meta.bodyClassName}
        actions={
          id === "radar" ? (
            <>
              <RadarTileSettings libreWxrHost={libreWxrHost} settings={radarSettings} overlaysAvailable={overlaysAvailable} />
              <BentoTileAction icon="plus-square" label="New independent radar window" onClick={handleNewRadarWindow} />
              {popOutAction}
            </>
          ) : (
            popOutAction
          )
        }
      >
        <TileBody
          id={id}
          location={activeWindowLocation}
          weather={weather}
          unit={unit}
          timeFormat={timeFormat}
          theme={resolvedTheme}
          radar={{
            libreWxrHost,
            spcOutlookEnabled,
            settings: radarSettings,
            preloadLocations: savedLocations,
            onBoundsChange: handleRadarBoundsChange,
            // Until main has said whether a radar tile window already exists
            // (surviving a reload, or restored on relaunch), don't mount a
            // map that may immediately unmount again.
            ready: tilePopouts.known,
          }}
          alerts={{
            alerts: boundsAlertsQuery.data ?? [],
            isLoading: boundsAlertsQuery.isLoading,
            demoAlerts,
            todayOutlook,
            spcOutlook,
            onPopOut: () => {
              const el = document.querySelector(".bento-tile-header-inline");
              tilePopouts.popOut("alerts", activeWindowLocation, el);
            },
            headerLeading: <BentoGrip />,
            headerClassName: "bento-drag-handle bento-tile-header-inline",
          }}
        />
      </BentoTile>
    );
  }

  return (
    <div
      className="relative flex h-screen flex-col overflow-hidden"
      style={
        cowBackgroundActive
          ? {
              backgroundImage: "url(/easter-eggs/cow-background.jpg)",
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : { background: "var(--bg)" }
      }
    >
      {showAsteroidGame && (
        <AsteroidShooterGame onClose={() => setShowAsteroidGame(false)} />
      )}
      <div className="fixed top-0 left-0 w-full h-6 drag-region" />
      <SidebarProvider>
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
          onLogoClick={handleLogoClick}
          settingsSlot={
            <SettingsDialog
              demoAlerts={demoAlerts}
              onDemoAlertsChange={setDemoAlerts}
              onTriggerAsteroid={asteroid.trigger}
              asteroidActive={asteroid.isActive}
              activeLocation={active}
            />
          }
        />
        <SidebarInset
          className={cn("overflow-y-auto transition-background duration-200 thin-scroll")}
          style={{
            background:
              "linear-gradient(to bottom right, rgba(var(--a0), 1), var(--background))",
          }}
        >
          <div className="sticky top-0 left-0 w-full backdrop-blur-lg p-2 z-50">
            <ShellToolbar
              searchSlot={
                <Omnibox
                  near={active ? { lat: active.lat, lon: active.lon } : null}
                  savedLocations={savedLocations}
                  isLocating={isLocating}
                  error={geoError || searchError}
                  onSelectPlace={selectPlace}
                  onSelectSaved={selectSaved}
                  onGps={() => requestGps()}
                />
              }
              lastRefresh={weather ? new Date(weatherQuery.dataUpdatedAt) : null}
              isRefreshing={weatherQuery.isFetching}
              onRefresh={handleRefresh}
              unit={unit}
              onSetUnit={(u) => updateConfig({ units: u })}
              timezone={weather?.timezone}
              timeFormat={timeFormat}
              onOpenRadio={() => void ipc.windows.openWeatherRadio({ instanceId: "main", location: active })}
              radioEnabled={config?.weatherRadioEnabled}
              hiddenTiles={bento.hidden}
              onSetTileHidden={bento.setHidden}
              poppedOutTiles={tilePopouts.poppedOut}
              onDockTile={tilePopouts.dock}
              layoutLocked={bento.locked}
              onSetLayoutLocked={bento.setLocked}
              onResetLayout={bento.resetLayout}
              onNewRadarWindow={handleNewRadarWindow}
            />
          </div>
          {weatherError && <div className="error-box mx-2">⚠ {weatherError}</div>}
          <div className="px-2 pb-4">
            <BentoGrid
              layout={bento.layout}
              tiles={tiles}
              editable={!bento.locked}
              onLayoutChange={bento.onLayoutChange}
            />
            {Object.keys(tiles).length === 0 && (
              <div className="bento-empty">
                <i className="ph ph-squares-four" aria-hidden="true" />
                <p>Every tile is hidden or open in its own window.</p>
                <button type="button" className="unit-btn" style={{ borderRadius: "var(--radius)" }} onClick={bento.resetLayout}>
                  Reset layout
                </button>
              </div>
            )}
          </div>
        </SidebarInset>
      </SidebarProvider>

      <AsteroidCountdown
        isActive={asteroid.isActive}
        secondsLeft={asteroid.secondsLeft}
      />
    </div>
  );
}
