import { useEffect } from "react";
import { wmoWeatherIconUrl } from "@/lib/icons/weather-icons";

/** Ported from the original app: the favicon itself is a small live weather
 * icon (the bundled Google v3 set) that tracks current conditions. */
export function useFavicon(
  weatherCode: number | undefined,
  isDay: boolean | undefined,
  resolvedTheme: "light" | "dark",
) {
  useEffect(() => {
    if (weatherCode === undefined || isDay === undefined) return;
    const link = document.getElementById("favicon") as HTMLLinkElement | null;
    if (link) link.href = wmoWeatherIconUrl(weatherCode, isDay, resolvedTheme);
  }, [weatherCode, isDay, resolvedTheme]);
}
