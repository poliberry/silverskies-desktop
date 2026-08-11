// Normalized shape every weather provider adapter produces. All values are
// stored in metric/Celsius internally — unit conversion for display happens
// once, at render time (see lib/units.ts), regardless of provider.

export interface CurrentConditions {
  temperatureC: number;
  apparentTemperatureC: number;
  /** Open-Meteo WMO weather code (0-99). AccuWeather icon codes are mapped
   * into this same space so icon/label/theme lookups stay provider-agnostic. */
  weatherCode: number;
  isDay: boolean;
  relativeHumidityPct: number;
  windSpeedKmh: number;
  windDirectionDeg: number;
  precipitationMm: number;
  cloudCoverPct: number;
  uvIndex: number;
}

export interface HourlyPoint {
  /** ISO 8601, in the location's local timezone (no trailing Z). */
  time: string;
  temperatureC: number;
  weatherCode: number;
  isDay: boolean;
  precipitationProbabilityPct: number;
}

export interface DailyPoint {
  /** ISO date, e.g. 2026-08-11. */
  date: string;
  weatherCode: number;
  tempMaxC: number;
  tempMinC: number;
  precipitationProbabilityMaxPct: number;
  sunrise: string;
  sunset: string;
  uvIndexMax: number;
}

export interface NormalizedWeather {
  current: CurrentConditions;
  hourly: HourlyPoint[];
  daily: DailyPoint[];
  timezone: string;
  provider: "open-meteo" | "accuweather";
}
