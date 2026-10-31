import { useQuery } from "@tanstack/react-query";
import { fetchMergedAlerts } from "@/lib/alerts/merge";
import { useSettings } from "./useSettings";

/** Merged NWS + ECCC + (gap-filling) LibreWXR alert feed for the active
 * location — powers the audit log. Alerts change on their own schedule, so
 * this refetches every 5 minutes regardless of the weather auto-refresh
 * setting. */
export function useAlerts(lat: number | null, lon: number | null) {
  const { config } = useSettings();
  const libreWxrHost = config?.libreWxrHost ?? "https://api.librewxr.net";
  const willyWeatherApiKey = config?.willyWeatherApiKey ?? null;

  return useQuery({
    queryKey: ["alerts", lat, lon, libreWxrHost, willyWeatherApiKey],
    queryFn: () => fetchMergedAlerts(lat as number, lon as number, libreWxrHost, willyWeatherApiKey),
    enabled: lat !== null && lon !== null,
    refetchInterval: 5 * 60_000,
  });
}
