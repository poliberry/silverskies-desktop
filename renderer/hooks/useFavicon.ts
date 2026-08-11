import { useEffect } from "react";
import { googleWeatherIconUrl } from "@/lib/icons/google-weather";

/** Ported from the original app: the favicon itself is a small live weather
 * icon (Google's "Pixel Weather" set) that tracks current conditions. */
export function useFavicon(
  weatherCode: number | undefined,
  isDay: boolean | undefined,
  resolvedTheme: "light" | "dark",
) {
  useEffect(() => {
    if (weatherCode === undefined || isDay === undefined) return;
    const link = document.getElementById("favicon") as HTMLLinkElement | null;
    if (link) link.href = googleWeatherIconUrl(weatherCode, isDay, resolvedTheme);
  }, [weatherCode, isDay, resolvedTheme]);
}
