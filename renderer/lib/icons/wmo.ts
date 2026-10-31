// WMO weather-code helpers: human-readable labels plus the severe-code set.
// Condition *icons* live in the bundled Google v3 set — see
// components/icons/WeatherIcon.tsx and lib/icons/weather-icons.ts.
// `weatherCode` is the Open-Meteo/WMO code space that every provider adapter
// normalizes into (see types/weather.ts).

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
  56: "Light Freezing Drizzle",
  57: "Freezing Drizzle",
  61: "Light Rain",
  63: "Rain",
  65: "Heavy Rain",
  66: "Light Freezing Rain",
  67: "Freezing Rain",
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
