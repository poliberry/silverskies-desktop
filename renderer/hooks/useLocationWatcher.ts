import { useEffect, useRef } from "react";
import { openMeteoProvider } from "@/lib/providers/open-meteo";
import { fetchMergedAlerts } from "@/lib/alerts/merge";
import {
  alertNotificationKey,
  detectExpectedSevere,
  detectNotableForecast,
} from "@/lib/notifications/rules";
import { hasNotified, markNotified } from "@/lib/notifications/dedupe-store";
import { notifyAlert, notifyToast } from "@/lib/notifications/dispatch";
import type { NormalizedAlert } from "@/types/alerts";
import { useSavedLocations } from "./useSavedLocations";
import { useSettings } from "./useSettings";

// Open-Meteo has no meaningful rate limit, and alerts (NWS/ECCC/LibreWXR)
// are free/unlimited either way — a shorter interval just means saved
// locations you're not currently looking at get noticed sooner.
const CHECK_INTERVAL_MS = 10 * 60_000;

/**
 * Background watcher: periodically checks every *saved* location (not just
 * whichever one is currently on screen) for new severe-weather alerts,
 * notable next-day forecasts, and heads-up severe conditions in the next
 * 12 hours — surfacing each as a desktop toast notification the first time
 * it's seen.
 *
 * Deliberately does NOT feed into the shell's severe-pulse effect — that's
 * scoped to whatever's actually on screen (see Shell.tsx), same as the
 * original app. An older version of this watcher also contributed to that
 * pulse, which meant switching to a clean saved location could still show
 * the *previous* location's pulse (correctly, from this watcher's own
 * schedule, but confusingly — nothing on screen indicated it wasn't about
 * the location you were now looking at). Toast notifications are the
 * mechanism for "something's happening at a saved location I'm not
 * viewing"; the ambient pulse stays about "something's happening here."
 *
 * Weather data for this check always comes from Open-Meteo, regardless of
 * the provider selected in Settings — AccuWeather's free tier is capped at
 * 50 calls/day, and this watcher fans out across every saved location on a
 * timer independent of whatever's on screen; burning that quota on a
 * background heuristic would starve the actual displayed forecast.
 */
export function useLocationWatcher() {
  const { config } = useSettings();
  const { savedLocations } = useSavedLocations();

  const savedLocationsRef = useRef(savedLocations);
  const libreWxrHostRef = useRef(config?.libreWxrHost);
  const willyWeatherApiKeyRef = useRef(config?.willyWeatherApiKey);
  // Read at dispatch time so changing a sound mid-interval takes effect on
  // the very next notification without restarting the timer.
  const configRef = useRef(config);
  // Synced after render rather than during it (React disallows ref writes
  // mid-render); the interval below only ever reads them later anyway.
  useEffect(() => {
    savedLocationsRef.current = savedLocations;
    libreWxrHostRef.current = config?.libreWxrHost;
    willyWeatherApiKeyRef.current = config?.willyWeatherApiKey;
    configRef.current = config;
  });

  useEffect(() => {
    if (!config?.notificationsEnabled) return;

    let cancelled = false;

    async function checkLocation(loc: (typeof savedLocationsRef.current)[number]) {
      const libreWxrHost = libreWxrHostRef.current ?? "https://api.librewxr.net";
      const willyWeatherApiKey = willyWeatherApiKeyRef.current ?? null;
      const [weather, alerts] = await Promise.all([
        openMeteoProvider.fetchWeather({ lat: loc.lat, lon: loc.lon }),
        fetchMergedAlerts(loc.lat, loc.lon, libreWxrHost, willyWeatherApiKey),
      ]);

      return {
        alerts,
        forecast: [
          ...detectNotableForecast(loc.id, loc.label, weather.daily),
          ...detectExpectedSevere(loc.id, loc.label, weather.hourly),
        ],
      };
    }

    async function runCheck() {
      for (const loc of savedLocationsRef.current) {
        if (cancelled) return;
        try {
          const { alerts, forecast } = await checkLocation(loc);
          if (cancelled) return;
          notifyNewAlerts(alerts, loc.label, configRef.current);
          for (const c of forecast) {
            if (hasNotified(c.key)) continue;
            markNotified(c.key);
            notifyToast(c.title, c.body, configRef.current);
          }
        } catch {
          // One location failing (offline, bad coordinates, etc.) shouldn't
          // block the rest of the saved list from being checked.
        }
      }
    }

    void runCheck();
    const id = setInterval(runCheck, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- savedLocations/libreWxrHost read via refs so edits mid-interval don't restart the timer
  }, [config?.notificationsEnabled]);
}

function notifyNewAlerts(
  alerts: NormalizedAlert[],
  locationLabel: string,
  config: Parameters<typeof notifyAlert>[2],
) {
  for (const alert of alerts) {
    const key = alertNotificationKey(alert);
    if (hasNotified(key)) continue;
    markNotified(key);
    notifyAlert(alert, locationLabel, config);
  }
}

/**
 * The location actually on screen isn't necessarily a saved one (a search,
 * a GPS fix), so the saved-locations watcher above would never notify for
 * it. Shell already polls alerts for the active location — this just feeds
 * that same data through the notification pipeline as it arrives. Shares
 * dedupe keys with the watcher, so an alert seen by both notifies once.
 */
export function useActiveLocationAlertNotifications(alerts: NormalizedAlert[] | undefined, locationLabel: string | undefined) {
  const { config } = useSettings();
  const enabled = config?.notificationsEnabled ?? false;
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  });
  const idsKey = (alerts ?? []).map((a) => a.id).join("|");

  useEffect(() => {
    if (!enabled || !alerts || !locationLabel) return;
    notifyNewAlerts(alerts, locationLabel, configRef.current);
    // Re-run only when the set of alert ids changes, not on every refetch
    // that hands back a new array with the same alerts in it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, idsKey, locationLabel]);
}
