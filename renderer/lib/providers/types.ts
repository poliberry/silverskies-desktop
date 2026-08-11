import type { NormalizedWeather } from "@/types/weather";
import type { SavedLocation } from "@/types/settings";

export interface WeatherProviderContext {
  lat: number;
  lon: number;
  /** Present when fetching for a saved location — lets the AccuWeather
   * adapter reuse/cache a resolved location key instead of re-querying the
   * geoposition-search endpoint (which counts against the daily quota) on
   * every refresh. */
  savedLocation?: SavedLocation;
  accuWeatherApiKey?: string | null;
  /** Called by the AccuWeather adapter after resolving a location key for a
   * saved location, so the caller can persist it via IPC. No-op for ad-hoc
   * (unsaved) locations. */
  onResolvedLocationKey?: (key: string) => void;
}

export interface WeatherProvider {
  id: "open-meteo" | "accuweather";
  fetchWeather(ctx: WeatherProviderContext): Promise<NormalizedWeather>;
}

export class ProviderConfigError extends Error {}
