// AccuWeather's numeric WeatherIcon codes (1-44) mapped into the
// Open-Meteo/WMO code space so icon/label/theme lookups (lib/icons/wmo.ts,
// lib/theme.ts) work unchanged regardless of provider.
export const ACCUWEATHER_ICON_TO_WMO: Record<number, number> = {
  1: 0, // Sunny
  2: 1, // Mostly Sunny
  3: 2, // Partly Sunny
  4: 2, // Intermittent Clouds
  5: 2, // Hazy Sunshine
  6: 3, // Mostly Cloudy
  7: 3, // Cloudy
  8: 3, // Dreary (Overcast)
  11: 45, // Fog
  12: 61, // Showers
  13: 61, // Mostly Cloudy w/ Showers
  14: 80, // Partly Sunny w/ Showers
  15: 95, // T-Storms
  16: 95, // Mostly Cloudy w/ T-Storms
  17: 95, // Partly Sunny w/ T-Storms
  18: 63, // Rain
  19: 71, // Flurries
  20: 71, // Mostly Cloudy w/ Flurries
  21: 71, // Partly Sunny w/ Flurries
  22: 73, // Snow
  23: 73, // Mostly Cloudy w/ Snow
  24: 67, // Ice
  25: 67, // Sleet
  26: 56, // Freezing Rain
  29: 66, // Rain and Snow
  30: 0, // Hot
  31: 0, // Cold
  32: 3, // Windy
  33: 0, // Clear (night)
  34: 1, // Mostly Clear (night)
  35: 2, // Partly Cloudy (night)
  36: 2, // Intermittent Clouds (night)
  37: 2, // Hazy Moonlight
  38: 3, // Mostly Cloudy (night)
  39: 80, // Partly Cloudy w/ Showers (night)
  40: 61, // Mostly Cloudy w/ Showers (night)
  41: 95, // Partly Cloudy w/ T-Storms (night)
  42: 95, // Mostly Cloudy w/ T-Storms (night)
  43: 71, // Mostly Cloudy w/ Flurries (night)
  44: 73, // Mostly Cloudy w/ Snow (night)
};

export function accuWeatherIconToWmo(icon: number): number {
  return ACCUWEATHER_ICON_TO_WMO[icon] ?? 3;
}
