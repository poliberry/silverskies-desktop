import { useCallback, useEffect, useState } from "react";
import { DEFAULT_LOCATION, geocode, reverseGeocode } from "@/lib/geocode";
import { ipGeolocate } from "@/lib/ip-geolocate";
import type { SavedLocation } from "@/types/settings";
import { useSavedLocations } from "./useSavedLocations";

/** Chromium's own GeolocationPositionError.message ("Failed to query
 * location from network service...") is an internal-sounding string, not
 * something to show a user directly — this only gets surfaced at all once
 * the IP-based fallback below has also failed. */
function friendlyGeoErrorMessage(err: GeolocationPositionError): string {
  if (err.code === err.PERMISSION_DENIED) return "Location access is turned off for this app.";
  return "Couldn't determine your location automatically — try searching for a city instead.";
}

export interface ActiveLocationState {
  lat: number;
  lon: number;
  label: string;
  savedLocation?: SavedLocation;
  isGps?: boolean;
}

/**
 * Resolves "what location is the dashboard currently showing" from three
 * possible sources — a saved location, a live GPS fix, or an ad-hoc search
 * result — and reconciles it with the one bit of that selection that's
 * persisted (`activeLocationId` in locations.json).
 *
 * `mode` is set synchronously by whichever action the user takes (click a
 * saved location / hit the GPS button / search) so the visible location
 * flips immediately, without waiting on the IPC round-trip that persists
 * "which saved location (if any) is active" in the background.
 */
export function useActiveLocation() {
  const { activeSavedLocation, isLoading: locationsLoading, setActiveLocation } = useSavedLocations();

  const [mode, setMode] = useState<"saved" | "adhoc" | null>(null);
  const [adhoc, setAdhoc] = useState<ActiveLocationState | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  /** GPS failed (or isn't available) — try city-level IP geolocation before
   * giving up entirely, since that's the common case in Electron on
   * Windows (see lib/ip-geolocate.ts) rather than an actual denial. */
  const fallBackToIp = useCallback(
    async (rawError: string | null, opts: { silentFallback?: boolean }) => {
      const ipResult = await ipGeolocate();
      if (ipResult) {
        setAdhoc({ ...ipResult, isGps: false });
        setGeoError(null);
        setIsLocating(false);
        void setActiveLocation(null);
        return;
      }
      setIsLocating(false);
      setGeoError(rawError);
      if (opts.silentFallback) setAdhoc({ ...DEFAULT_LOCATION, isGps: false });
    },
    [setActiveLocation],
  );

  const requestGps = useCallback((opts: { silentFallback?: boolean } = {}) => {
    setMode("adhoc");
    setGeoError(null);

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      void fallBackToIp("Geolocation isn't supported by this browser.", opts);
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const label = await reverseGeocode(lat, lon);
        setAdhoc({ lat, lon, label, isGps: true });
        setIsLocating(false);
        void setActiveLocation(null);
      },
      (err) => {
        void fallBackToIp(friendlyGeoErrorMessage(err), opts);
      },
      { timeout: 10_000, maximumAge: 60_000 },
    );
  }, [fallBackToIp, setActiveLocation]);

  // First load: prefer a persisted saved-active location; otherwise try GPS
  // once, falling back to the default location if that fails too.
  useEffect(() => {
    if (locationsLoading || mode !== null) return;
    if (activeSavedLocation) {
      setMode("saved");
    } else {
      requestGps({ silentFallback: true });
    }
  }, [locationsLoading, activeSavedLocation, mode, requestGps]);

  const selectSaved = useCallback(
    (id: string) => {
      setMode("saved");
      setSearchError(null);
      void setActiveLocation(id);
    },
    [setActiveLocation],
  );

  const searchAndSelect = useCallback(
    async (query: string) => {
      setSearchError(null);
      try {
        const result = await geocode(query);
        setMode("adhoc");
        setAdhoc({ ...result, isGps: false });
        void setActiveLocation(null);
      } catch (e) {
        setSearchError(e instanceof Error ? e.message : "Location not found.");
      }
    },
    [setActiveLocation],
  );

  const active: ActiveLocationState | null =
    mode === "saved" && activeSavedLocation
      ? {
          lat: activeSavedLocation.lat,
          lon: activeSavedLocation.lon,
          label: activeSavedLocation.label,
          savedLocation: activeSavedLocation,
        }
      : adhoc;

  return {
    active,
    isLocating,
    geoError,
    searchError,
    requestGps,
    searchAndSelect,
    selectSaved,
  };
}
