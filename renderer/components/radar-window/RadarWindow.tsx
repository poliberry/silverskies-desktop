"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RadarMap } from "@/components/radar/RadarMap";
import { RadarWindowToolbar } from "./RadarWindowToolbar";
import { useRadarSettings } from "@/hooks/useRadarSettings";
import { useSettings } from "@/hooks/useSettings";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { geocode, reverseGeocode, DEFAULT_LOCATION } from "@/lib/geocode";
import { ipGeolocate } from "@/lib/ip-geolocate";
import { fetchWeatherMaps } from "@/lib/alerts/librewxr";
import { ipc } from "@/lib/ipc-client";
import type { WindowLocation } from "@/types/windows";

export interface RadarWindowProps {
  instanceId: string;
  initialLocation: WindowLocation | null;
}

/**
 * A fully independent radar instance in its own Electron window — its own
 * location (set via the alt bar's search, not tied to the main window's
 * active location), its own play/seek/live state, its own radar settings
 * (see useRadarSettings). Nothing here is synced with the main window or
 * any other radar window, by design — "New Radar Window" always opens one
 * of these from scratch.
 */
export function RadarWindow({ instanceId, initialLocation }: RadarWindowProps) {
  const [location, setLocation] = useState<WindowLocation | null>(initialLocation);
  const [isLocating, setIsLocating] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const settings = useRadarSettings();
  const { config } = useSettings();
  const theme = useResolvedTheme();

  const libreWxrHost = config?.libreWxrHost ?? "https://api.librewxr.net";
  const spcOutlookEnabled = config?.spcOutlookEnabled ?? true;
  const overlaysAvailable = Boolean(config?.openWeatherMapApiKey);

  // Shares React Query's cache with LeafletRadarMap's own identical query
  // below (same queryKey) — fetched once here just to get the color-scheme
  // names for the alt bar's "type" buttons, which live outside the map.
  const { data: weatherMaps } = useQuery({
    queryKey: ["librewxr-weather-maps", libreWxrHost],
    queryFn: () => fetchWeatherMaps(libreWxrHost),
    refetchInterval: 2 * 60_000,
    refetchIntervalInBackground: true,
  });

  // No seed location at all (opened before the main window ever resolved
  // one, or launched standalone for testing) — fall back the same way the
  // main window does on first launch: IP-based geolocation, then a fixed
  // default, rather than leaving the window blank.
  useEffect(() => {
    if (location) return;
    let cancelled = false;
    void (async () => {
      const ip = await ipGeolocate();
      if (!cancelled) setLocation(ip ?? DEFAULT_LOCATION);
    })();
    return () => {
      cancelled = true;
    };
  }, [location]);

  function updateLocation(next: WindowLocation) {
    setLocation(next);
    ipc.windows.sendInstanceLocation(instanceId, next);
  }

  async function handleSearch(query: string) {
    setSearchError(null);
    try {
      updateLocation(await geocode(query));
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Location not found.");
    }
  }

  function handleGps() {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        void reverseGeocode(lat, lon).then((label) => {
          setIsLocating(false);
          updateLocation({ lat, lon, label });
        });
      },
      () => {
        void ipGeolocate().then((ip) => {
          setIsLocating(false);
          if (ip) updateLocation(ip);
        });
      },
      { timeout: 10_000, maximumAge: 60_000 },
    );
  }

  return (
    <div className="flex h-screen flex-col gap-3 p-3" style={{ background: "var(--bg)" }}>
      <RadarWindowToolbar
        instanceId={instanceId}
        location={location}
        onSearch={handleSearch}
        onGps={handleGps}
        isLocating={isLocating}
        searchError={searchError}
        settings={settings}
        overlaysAvailable={overlaysAvailable}
        colorSchemes={weatherMaps?.radar.colorSchemes ?? []}
      />
      <div className="min-h-0 flex-1">
        {location && (
          <RadarMap
            lat={location.lat}
            lon={location.lon}
            label={location.label}
            libreWxrHost={libreWxrHost}
            theme={theme}
            spcOutlookEnabled={spcOutlookEnabled}
            settings={settings}
            renderSettingsInline={false}
          />
        )}
      </div>
    </div>
  );
}
