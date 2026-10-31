// Google's v3 weather icon set (via github.com/bignutty/google-weather-icons,
// icons/weather/v3), bundled under public/icons/weather/v3/{dark,light}/ so
// icons work offline and never depend on a CDN. "dark" is the variant drawn
// for dark backgrounds (light-grey clouds), "light" for light backgrounds.
//
// `weatherCode` is the Open-Meteo/WMO code space every provider adapter
// normalizes into (see types/weather.ts).

export type WeatherIconName =
  | "blowing_snow"
  | "clear_day"
  | "clear_night"
  | "clear_with_cloudy"
  | "cloudy"
  | "drizzle"
  | "flurries"
  | "haze_fog"
  | "heavy_rain"
  | "heavy_snow"
  | "hurricane"
  | "icy"
  | "mixed_rain_hail_sleet"
  | "mostly_clear_night"
  | "mostly_cloudy_day"
  | "mostly_cloudy_night"
  | "not_available"
  | "partly_cloudy_day"
  | "partly_cloudy_night"
  | "rain_showers"
  | "scattered_rain_showers_day"
  | "scattered_rain_showers_night"
  | "scattered_snow_showers_day"
  | "scattered_snow_showers_night"
  | "sleet_hail"
  | "strong_thunderstorms"
  | "thunderstorms_day"
  | "thunderstorms_night"
  | "tornado"
  | "very_cold"
  | "very_hot"
  | "windy"
  | "wintry_mix";

const ICON_BASE = "/icons/weather/v3";

const dayNight = (day: WeatherIconName, night: WeatherIconName) => (isDay: boolean) => (isDay ? day : night);
const always = (name: WeatherIconName) => () => name;

const WMO_ICON: Record<number, (isDay: boolean) => WeatherIconName> = {
  0: dayNight("clear_day", "clear_night"),
  1: dayNight("clear_with_cloudy", "mostly_clear_night"),
  2: dayNight("partly_cloudy_day", "partly_cloudy_night"),
  3: always("cloudy"),
  45: always("haze_fog"),
  48: always("haze_fog"),
  51: always("drizzle"),
  53: always("drizzle"),
  55: always("drizzle"),
  56: always("wintry_mix"),
  57: always("sleet_hail"),
  61: always("rain_showers"),
  63: always("rain_showers"),
  65: always("heavy_rain"),
  66: always("wintry_mix"),
  67: always("sleet_hail"),
  71: always("flurries"),
  73: always("heavy_snow"),
  75: always("heavy_snow"),
  77: always("flurries"),
  80: dayNight("scattered_rain_showers_day", "scattered_rain_showers_night"),
  81: always("rain_showers"),
  82: always("heavy_rain"),
  85: dayNight("scattered_snow_showers_day", "scattered_snow_showers_night"),
  86: always("heavy_snow"),
  95: dayNight("thunderstorms_day", "thunderstorms_night"),
  96: always("strong_thunderstorms"),
  99: always("strong_thunderstorms"),
};

export function wmoWeatherIcon(code: number | undefined, isDay = true): WeatherIconName {
  return (code !== undefined && WMO_ICON[code]?.(isDay)) || "not_available";
}

export function weatherIconUrl(name: WeatherIconName, theme: "light" | "dark"): string {
  return `${ICON_BASE}/${theme}/${name}.svg`;
}

export function wmoWeatherIconUrl(code: number | undefined, isDay: boolean, theme: "light" | "dark"): string {
  return weatherIconUrl(wmoWeatherIcon(code, isDay), theme);
}
