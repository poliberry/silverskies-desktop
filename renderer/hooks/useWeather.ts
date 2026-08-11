import { useQuery } from "@tanstack/react-query";
import { providers } from "@/lib/providers";
import type { SavedLocation } from "@/types/settings";
import { useSavedLocations } from "./useSavedLocations";
import { useSettings } from "./useSettings";

export interface ActiveLocation {
  lat: number;
  lon: number;
  label: string;
  savedLocation?: SavedLocation;
}

/** Fetches normalized weather for the active location from whichever
 * provider is selected in Settings, auto-refetching on the configured
 * interval (0/false disables it). */
export function useWeather(location: ActiveLocation | null) {
  const { config } = useSettings();
  const { updateLocation } = useSavedLocations();

  const provider = config?.provider ?? "open-meteo";
  const refetchInterval =
    config && config.autoRefreshMinutes > 0 ? config.autoRefreshMinutes * 60_000 : false;

  return useQuery({
    queryKey: ["weather", provider, location?.lat, location?.lon, location?.savedLocation?.id],
    queryFn: async () => {
      if (!location) throw new Error("No location selected");
      return providers[provider].fetchWeather({
        lat: location.lat,
        lon: location.lon,
        savedLocation: location.savedLocation,
        accuWeatherApiKey: config?.accuWeatherApiKey,
        onResolvedLocationKey: (key) => {
          if (location.savedLocation) {
            void updateLocation({
              id: location.savedLocation.id,
              patch: { accuWeatherLocationKey: key },
            });
          }
        },
      });
    },
    enabled: Boolean(location) && Boolean(config),
    refetchInterval,
    retry: 1,
  });
}
