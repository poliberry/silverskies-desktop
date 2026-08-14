"use client";

import { useEffect, useRef, useState } from "react";
import { ipc } from "@/lib/ipc-client";
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
import { useLocationWatcher } from "@/hooks/useLocationWatcher";
import { useLogoClickCounter } from "@/hooks/useLogoClickCounter";
import { useWeatherRadio } from "@/hooks/useWeatherRadio";
import { AsteroidCountdown } from "@/components/easter-eggs/AsteroidCountdown";
import { AsteroidShooterGame } from "@/components/easter-eggs/AsteroidShooterGame";
import { Sheet, SheetTrigger, SheetContent } from "@/components/ui/sheet";
import { WeatherRadioSheetContent } from "@/components/weather-radio/WeatherRadioSheetContent";
import { activeSeverePulseColor } from "@/lib/alerts/merge";
import { findOutlookAtPoint } from "@/lib/alerts/spc-outlook";
import { buildTodayOutlook } from "@/lib/forecast-outlook";
import { ProviderConfigError } from "@/lib/providers";
import type { NormalizedAlert } from "@/types/alerts";
import type { UnitPref } from "@/types/settings";
import type { BBox } from "@/lib/alerts/librewxr";

export function Shell() {
  const { config, updateConfig } = useSettings();
  const { savedLocations, addLocation, removeLocation } = useSavedLocations();
  const { active, isLocating, geoError, searchError, requestGps, searchAndSelect, selectSaved } =
    useActiveLocation();

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
  // The main window's own docked radar instance — a pop-out radar window
  // owns a completely separate one (see RadarWindow.tsx), never synced with
  // this one, by design.
  const radarSettings = useRadarSettings();
  const isAdvancedUi = (config?.uiMode ?? "classic") === "advanced";
  // True once the main window's own radar has been undocked into its own
  // window (see TopBar's "Pop Out" button) — the middle column then gives
  // the audit log the full column instead of sharing it with the map.
  // Starts `null` ("not yet known") rather than `false` — the actual
  // pop-out window can already exist when Shell mounts (surviving a
  // main-window reload, or recreated from session.json on relaunch), and
  // asking main for the real state is an async IPC round trip. Defaulting
  // to `false` would flash the docked radar (mounting LeafletRadarMap,
  // firing its own network requests) for a moment before flipping to
  // undocked once that reply arrives; treating `null` as "render neither"
  // avoids that transient duplicate-radar window entirely.
  const [radarPoppedOut, setRadarPoppedOut] = useState<boolean | null>(null);
  // Guards handlePopOutRadar against firing twice — a ref rather than just
  // checking `radarPoppedOut` in the handler, because two clicks fired
  // before React has re-rendered (and handed the button a fresh closure
  // reflecting the first click's setRadarPoppedOut(true)) both see the same
  // *stale* `radarPoppedOut` from the render they were attached in. A ref
  // updates synchronously, independent of the render cycle, so the second
  // click reliably sees it even when the state check alone wouldn't.
  const popoutRequestInFlightRef = useRef(false);
  useEffect(
    () =>
      ipc.windows.onPrimaryRadarClosed(() => {
        setRadarPoppedOut(false);
        popoutRequestInFlightRef.current = false;
      }),
    [],
  );
  useEffect(() => {
    // Classic mode's reset effect below always forces this to `false` and
    // hides the only in-app control that could redock it — so an
    // in-flight/late response here must never override that while classic,
    // or a primary pop-out that happens to still be open (surviving a mode
    // switch, restored from session.json, etc.) would leave the docked
    // radar hidden with no way to bring it back short of toggling the
    // Interface setting back to Advanced. Re-checks whenever `isAdvancedUi`
    // flips to true, rather than only once on mount, so switching into
    // Advanced always reflects whatever's actually already open.
    if (!isAdvancedUi) return;
    let cancelled = false;
    void ipc.windows.isPrimaryRadarOpen().then((open) => {
      if (!cancelled) setRadarPoppedOut(open);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdvancedUi]);

  // Same "pop the main window's own docked panel out" pattern as radar
  // above, independently tracked — the audit log paired to the "main"
  // sentinel instanceId (see handlePopOutAuditLog) rather than a real radar
  // instance.
  const [auditLogPoppedOut, setAuditLogPoppedOut] = useState<boolean | null>(null);
  const popoutAuditLogRequestInFlightRef = useRef(false);
  useEffect(
    () =>
      ipc.windows.onPrimaryAuditLogClosed(() => {
        setAuditLogPoppedOut(false);
        popoutAuditLogRequestInFlightRef.current = false;
      }),
    [],
  );
  useEffect(() => {
    // Same reasoning as the radar mount-check above: only apply this while
    // still in Advanced, and re-run whenever `isAdvancedUi` flips to true,
    // so a restored primary audit-log window can't silently overwrite the
    // classic-mode reset and leave the docked audit log permanently hidden
    // with no visible way to bring it back.
    if (!isAdvancedUi) return;
    let cancelled = false;
    void ipc.windows.isPrimaryAuditLogOpen().then((open) => {
      if (!cancelled) setAuditLogPoppedOut(open);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdvancedUi]);

  // Classic mode has no in-app way to redock (the Pop Out buttons only
  // render in advanced mode) — without this, switching Settings → Interface
  // from Advanced to Classic while undocked left the main window with no
  // visible radar/audit-log at all, and no way to get one back short of
  // manually closing the separate window(s). Any orphaned pop-out(s) are
  // left open and fully functional on their own; only Shell's own docked/
  // undocked layout is forced back to docked.
  useEffect(() => {
    if (!isAdvancedUi) {
      setRadarPoppedOut(false);
      popoutRequestInFlightRef.current = false;
      setAuditLogPoppedOut(false);
      popoutAuditLogRequestInFlightRef.current = false;
    }
  }, [isAdvancedUi]);
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
  // the toolbar's own Sheet panel below).
  const radioAlertIds = new Set<string>();
  const radioAlerts = [...(alertsQuery.data ?? []), ...(boundsAlertsQuery.data ?? [])].filter((a) => {
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

  function handlePopOutRadar() {
    // Without this guard, double-clicking (or any two clicks landing before
    // React re-renders) both read the same stale, pre-update closure and
    // fire ipc.windows.openRadar twice — since neither call passes an
    // instanceId, main treats each as a *separate* primary radar, only
    // ever tracks the last one, and the first becomes an orphaned duplicate
    // that redocking never closes.
    if (radarPoppedOut || popoutRequestInFlightRef.current) return;
    popoutRequestInFlightRef.current = true;
    setRadarPoppedOut(true);
    void ipc.windows.openRadar({
      location: active ? { lat: active.lat, lon: active.lon, label: active.label } : null,
      isPrimaryPopout: true,
    });
  }

  function handleNewRadarWindow() {
    void ipc.windows.openRadar({
      location: active ? { lat: active.lat, lon: active.lon, label: active.label } : null,
    });
  }

  // Keeps a popped-out "main" audit-log window (if any) live-updated as the
  // main window's own active location changes — a no-op relay on main's
  // side when no such window is open, exactly like a radar instance's own
  // sendInstanceLocation calls are harmless when it has no paired windows.
  useEffect(() => {
    if (active) ipc.windows.sendInstanceLocation("main", { lat: active.lat, lon: active.lon, label: active.label });
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

  function handlePopOutAuditLog() {
    if (auditLogPoppedOut || popoutAuditLogRequestInFlightRef.current) return;
    popoutAuditLogRequestInFlightRef.current = true;
    setAuditLogPoppedOut(true);
    void ipc.windows.openAuditLog({
      instanceId: "main",
      location: active ? { lat: active.lat, lon: active.lon, label: active.label } : null,
      isPrimaryPopout: true,
    });
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
      {/* A 1-in-50 easter egg — a scrim over the cow photo (rather than
          touching every panel's own background/opacity) keeps every existing
          glass-card/panel reading exactly the same as normal on top of it. */}
      {cowBackgroundActive && (
        <div
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, background: "var(--bg)", opacity: 0.6, zIndex: 0 }}
        />
      )}
      {showAsteroidGame && <AsteroidShooterGame onClose={() => setShowAsteroidGame(false)} />}
      {/* Only the main window gets the animated gradient sweep — pop-out
          radar/conditions/alert windows render their own root component
          instead of Shell, so they never pick this up. Settings → General →
          "Top Glow Sweep" hides it via CSS instead of conditionally
          rendering it — useSeverePulse imperatively sets this element's
          "pulsing" class/--tg color from its own effect, which only reruns
          when the pulse color/theme change, not when this setting does; if
          the div were unmounted while disabled, re-enabling it mid-alert
          would remount a fresh element with neither, silently dropping the
          pulse until the color happened to change again. */}
      <div id="top-glow" className={config?.topGlowEnabled ?? true ? undefined : "top-glow-disabled"} />
      <div style={{ padding: "12px 12px 0" }}>
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
            // react-query's refetch() runs the queryFn even when `enabled`
            // is false — useAlertsForBounds' queryFn indexes straight into
            // the bbox tuple, so calling this before the radar has ever
            // reported bounds would throw on a null bbox instead of just
            // no-op'ing like the `enabled` guard implies.
            if (radarBounds) void boundsAlertsQuery.refetch();
          }}
          unit={unit}
          onSetUnit={(u) => updateConfig({ units: u })}
          timezone={weatherQuery.data?.timezone}
          timeFormat={timeFormat}
          showWindowActions={isAdvancedUi}
          radarPoppedOut={radarPoppedOut === true}
          onPopOutRadar={handlePopOutRadar}
          onNewRadarWindow={handleNewRadarWindow}
          onLogoClick={handleLogoClick}
          radioSlot={
            <Sheet>
              <SheetTrigger
                render={
                  <button
                    className={`unit-btn ${config?.weatherRadioEnabled ? "active" : ""}`}
                    title="Weather Radio"
                    aria-label="Weather Radio"
                  >
                    <i className="ph ph-radio" aria-hidden="true" />
                  </button>
                }
              />
              <SheetContent>
                <WeatherRadioSheetContent />
              </SheetContent>
            </Sheet>
          }
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

        <div className="flex min-h-0 min-w-0 flex-col gap-4">
          {/* Strictly `=== false`, not `!radarPoppedOut`/`!auditLogPoppedOut`
              — while either is still `null` (state not yet confirmed with
              main), rendering nothing here is what avoids briefly mounting a
              duplicate docked panel that then immediately unmounts once the
              real state arrives. */}
          {radarPoppedOut === false && (
            <div className="min-h-0" style={{ flex: auditLogPoppedOut === false ? "2 1 0%" : "1 1 100%" }}>
              {active && (
                <RadarMap
                  lat={active.lat}
                  lon={active.lon}
                  label={active.label}
                  libreWxrHost={libreWxrHost}
                  theme={resolvedTheme}
                  preloadLocations={savedLocations}
                  spcOutlookEnabled={spcOutlookEnabled}
                  settings={radarSettings}
                  onBoundsChange={handleRadarBoundsChange}
                />
              )}
            </div>
          )}
          {/* Popping either one out frees the whole column for whichever
              panel is still docked, instead of splitting it 2:1. */}
          {auditLogPoppedOut === false && (
            <div className="glass-card min-h-0 min-w-0 p-3" style={{ flex: radarPoppedOut === false ? "1 1 0%" : "1 1 100%" }}>
              <AlertLog
                alerts={boundsAlertsQuery.data ?? []}
                isLoading={boundsAlertsQuery.isLoading}
                demoAlerts={demoAlerts}
                todayOutlook={todayOutlook}
                spcOutlook={spcOutlook}
                onPopOutAuditLog={isAdvancedUi ? handlePopOutAuditLog : undefined}
              />
            </div>
          )}
          {radarPoppedOut === true && auditLogPoppedOut === true && (
            <div className="glass-card flex min-h-0 flex-1 items-center justify-center p-6 text-center">
              <p className="geo-notice">Radar and Audit Log are both open in their own windows.</p>
            </div>
          )}
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
