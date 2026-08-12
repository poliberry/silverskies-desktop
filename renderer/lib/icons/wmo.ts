// Ported verbatim from the original app's Meteocons + Phosphor icon tables.
// `weatherCode` is the Open-Meteo/WMO code space that every provider adapter
// normalizes into (see types/weather.ts).

const ICON_BASE = "https://meteocons.com/icons/line/";
const ICON_BASE_FILL = "https://meteocons.com/icons/fill/";

const WMO_METEOCONS_NAME: Record<number, (isDay: boolean) => string> = {
  0: (d) => (d ? "clear-day" : "clear-night"),
  1: (d) => (d ? "mostly-clear-day" : "mostly-clear-night"),
  2: (d) => (d ? "partly-cloudy-day" : "partly-cloudy-night"),
  3: () => "overcast",
  45: () => "fog",
  48: () => "fog",
  51: () => "drizzle",
  53: () => "drizzle",
  55: () => "drizzle",
  61: (d) => (d ? "partly-cloudy-day-rain" : "partly-cloudy-night-rain"),
  63: () => "rain",
  65: () => "rain",
  71: (d) => (d ? "partly-cloudy-day-snow" : "partly-cloudy-night-snow"),
  73: () => "snow",
  75: () => "snow",
  77: () => "snow",
  80: (d) => (d ? "partly-cloudy-day-rain" : "partly-cloudy-night-rain"),
  81: () => "rain",
  82: () => "rain",
  85: (d) => (d ? "partly-cloudy-day-snow" : "partly-cloudy-night-snow"),
  86: () => "snow",
  95: (d) => (d ? "thunderstorms-day" : "thunderstorms-night"),
  96: (d) => (d ? "thunderstorms-day-rain" : "thunderstorms-night-rain"),
  99: (d) => (d ? "thunderstorms-day-rain" : "thunderstorms-night-rain"),
};

export function wmoIconName(code: number, isDay = true): string {
  return WMO_METEOCONS_NAME[code]?.(isDay) ?? "not-available";
}

/** Meteocons — the large "current conditions" icon. Uses the filled set in
 * light mode (reads better on a white surface) and the line set in dark. */
export function wmoIconUrl(code: number, isDay: boolean, theme: "light" | "dark"): string {
  const base = theme === "light" ? ICON_BASE_FILL : ICON_BASE;
  return `${base}${wmoIconName(code, isDay)}.svg`;
}

const WMO_PHOSPHOR_NAME: Record<number, (isDay: boolean) => string> = {
  0: (d) => (d ? "sun" : "moon-stars"),
  1: (d) => (d ? "sun" : "moon-stars"),
  2: (d) => (d ? "cloud-sun" : "cloud-moon"),
  3: () => "cloud",
  45: () => "cloud-fog",
  48: () => "cloud-fog",
  51: () => "cloud-rain",
  53: () => "cloud-rain",
  55: () => "cloud-rain",
  61: () => "cloud-rain",
  63: () => "cloud-rain",
  65: () => "cloud-rain",
  71: () => "cloud-snow",
  73: () => "cloud-snow",
  75: () => "cloud-snow",
  77: () => "cloud-snow",
  80: () => "cloud-rain",
  81: () => "cloud-rain",
  82: () => "cloud-rain",
  85: () => "cloud-snow",
  86: () => "cloud-snow",
  95: () => "cloud-lightning",
  96: () => "cloud-lightning",
  99: () => "cloud-lightning",
};

/** Small, repeated icons (hourly strip, 7-day list) stay as static Phosphor
 * glyphs rather than animated Meteocons/Google SVGs — many-on-screen at
 * once is exactly where animated icons become an accessibility problem. */
export function wmoPhosphorName(code: number, isDay = true): string {
  return WMO_PHOSPHOR_NAME[code]?.(isDay) ?? "question";
}

const WMO_LABEL: Record<number, string> = {
  0: "Clear Sky",
  1: "Mainly Clear",
  2: "Partly Cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Icy Fog",
  51: "Light Drizzle",
  53: "Drizzle",
  55: "Heavy Drizzle",
  61: "Light Rain",
  63: "Rain",
  65: "Heavy Rain",
  71: "Light Snow",
  73: "Snow",
  75: "Heavy Snow",
  77: "Snow Grains",
  80: "Light Showers",
  81: "Showers",
  82: "Heavy Showers",
  85: "Snow Showers",
  86: "Heavy Snow Showers",
  95: "Thunderstorm",
  96: "Thunderstorm + Hail",
  99: "Severe Thunderstorm",
};

export function wmoLabel(code: number): string {
  return WMO_LABEL[code] ?? "Unknown";
}

/** Thunderstorm, heavy rain, heavy snow, wintry mix/sleet/freezing rain —
 * the WMO codes worth a heads-up on their own, even before an official
 * alert exists. Shared by the notification watcher and the audit log's
 * today-outlook line so both use the exact same bar. */
export const SEVERE_WMO_CODES = new Set([95, 96, 99, 65, 82, 75, 86, 56, 57, 66, 67]);
