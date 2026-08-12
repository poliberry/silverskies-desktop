import { useEffect, useRef } from "react";
import { openMeteoProvider } from "@/lib/providers/open-meteo";
import { fetchMergedAlerts } from "@/lib/alerts/merge";
import { detectExpectedSevere, detectNewAlerts, detectNotableForecast } from "@/lib/notifications/rules";
import { hasNotified, markNotified } from "@/lib/notifications/dedupe-store";
import { ipc } from "@/lib/ipc-client";
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
  savedLocationsRef.current = savedLocations;
  const libreWxrHostRef = useRef(config?.libreWxrHost);
  libreWxrHostRef.current = config?.libreWxrHost;
  const willyWeatherApiKeyRef = useRef(config?.willyWeatherApiKey);
  willyWeatherApiKeyRef.current = config?.willyWeatherApiKey;

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

      return [
        ...detectNewAlerts(loc.id, loc.label, alerts),
        ...detectNotableForecast(loc.id, loc.label, weather.daily),
        ...detectExpectedSevere(loc.id, loc.label, weather.hourly),
      ];
    }

    async function runCheck() {
      for (const loc of savedLocationsRef.current) {
        if (cancelled) return;
        try {
          const candidates = await checkLocation(loc);
          for (const c of candidates) {
            if (hasNotified(c.key)) continue;
            markNotified(c.key);
            void ipc.app.notify(c.title, c.body);
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
