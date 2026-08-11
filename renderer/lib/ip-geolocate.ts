import type { GeocodeResult } from "./geocode";

/**
 * IP-based location fallback for when precise GPS fails — which, in
 * Electron on Windows, is common: Chromium's *network* location provider
 * needs a Google Geolocation API key that Electron doesn't ship with, so
 * `navigator.geolocation` frequently fails with "Failed to query location
 * from network service" even though Windows Location Services works fine
 * for everything else. This is city-level accuracy, not GPS-precise, but
 * good enough to avoid nagging the user with that error on every launch.
 */
export async function ipGeolocate(): Promise<GeocodeResult | null> {
  try {
    const r = await fetch("https://ipapi.co/json/");
    if (!r.ok) return null;
    const d = await r.json();
    if (typeof d.latitude !== "number" || typeof d.longitude !== "number") return null;
    const label = [d.city, d.region_code || d.region].filter(Boolean).join(", ") || d.country_name || "Unknown";
    return { lat: d.latitude, lon: d.longitude, label };
  } catch {
    return null;
  }
}
