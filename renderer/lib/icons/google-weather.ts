// Google Weather icon set, used for compact contexts (saved-location list
// mini-icons). Ported from the original app's `gwIconName()`.

const GW_BASE = "https://cdn.jsdelivr.net/gh/mrdarrengriffin/google-weather-icons@main/sets/set-6/";

const GW_FILE: Record<number, (isDay: boolean) => string> = {
  0: (d) => (d ? "sunny.svg" : "clear_night.svg"),
  1: (d) => (d ? "mostly_sunny.svg" : "mostly_clear_night.svg"),
  2: (d) => (d ? "partly_cloudy.svg" : "partly_cloudy_night.svg"),
  3: () => "cloudy.svg",
  45: () => "cloudy.svg",
  48: () => "cloudy.svg",
  51: () => "drizzle.svg",
  53: () => "drizzle.svg",
  55: () => "drizzle.svg",
  56: () => "wintry_mix.svg",
  57: () => "sleet_hail.svg",
  61: () => "drizzle.svg",
  63: () => "heavy_rain.svg",
  65: () => "heavy_rain.svg",
  66: () => "wintry_mix.svg",
  67: () => "sleet_hail.svg",
  71: () => "flurries.svg",
  73: () => "heavy_snow.svg",
  75: () => "heavy_snow.svg",
  77: () => "flurries.svg",
  80: (d) => (d ? "partly_cloudy.svg" : "partly_cloudy_night.svg"),
  81: () => "heavy_rain.svg",
  82: () => "heavy_rain.svg",
  85: () => "flurries.svg",
  86: () => "heavy_snow.svg",
  95: () => "strong_thunderstorms.svg",
  96: () => "strong_thunderstorms.svg",
  99: () => "strong_thunderstorms.svg",
};

export function googleWeatherIconUrl(code: number, isDay: boolean, theme: "light" | "dark"): string {
  const file = GW_FILE[code]?.(isDay) ?? "cloudy.svg";
  return `${GW_BASE}${theme}/${file}`;
}
