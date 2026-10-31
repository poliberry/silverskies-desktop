import type { DailyPoint, HourlyPoint, NormalizedWeather } from "@/types/weather";
import type { WeatherProvider, WeatherProviderContext } from "./types";

// Ported from the original app's fetchWeatherData() — same params, same
// fields, Celsius/km/h/mm throughout (Open-Meteo's metric defaults).
async function fetchOpenMeteo(lat: number, lon: number) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "weather_code",
      "wind_speed_10m",
      "wind_direction_10m",
      "precipitation",
      "cloud_cover",
      "uv_index",
      "is_day",
    ].join(","),
    hourly: ["temperature_2m", "weather_code", "precipitation_probability", "is_day"].join(","),
    daily: [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "sunrise",
      "sunset",
      "uv_index_max",
    ].join(","),
    timezone: "auto",
    forecast_days: "7",
  });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!r.ok) throw new Error(`Open-Meteo error ${r.status}`);
  return r.json();
}

export const openMeteoProvider: WeatherProvider = {
  id: "open-meteo",
  async fetchWeather({ lat, lon }: WeatherProviderContext): Promise<NormalizedWeather> {
    const d = await fetchOpenMeteo(lat, lon);
    const c = d.current;

    const hourly: HourlyPoint[] = d.hourly.time.map((time: string, i: number) => ({
      time,
      temperatureC: d.hourly.temperature_2m[i],
      weatherCode: d.hourly.weather_code[i],
      isDay: d.hourly.is_day[i] === 1,
      precipitationProbabilityPct: d.hourly.precipitation_probability?.[i] ?? 0,
    }));

    const daily: DailyPoint[] = d.daily.time.map((date: string, i: number) => ({
      date,
      weatherCode: d.daily.weather_code[i],
      tempMaxC: d.daily.temperature_2m_max[i],
      tempMinC: d.daily.temperature_2m_min[i],
      precipitationProbabilityMaxPct: d.daily.precipitation_probability_max?.[i] ?? 0,
      sunrise: d.daily.sunrise[i],
      sunset: d.daily.sunset[i],
      uvIndexMax: d.daily.uv_index_max?.[i] ?? 0,
    }));

    return {
      provider: "open-meteo",
      timezone: d.timezone,
      current: {
        temperatureC: c.temperature_2m,
        apparentTemperatureC: c.apparent_temperature,
        weatherCode: c.weather_code,
        isDay: c.is_day === 1,
        relativeHumidityPct: c.relative_humidity_2m,
        windSpeedKmh: c.wind_speed_10m,
        windDirectionDeg: c.wind_direction_10m,
        precipitationMm: c.precipitation,
        cloudCoverPct: c.cloud_cover,
        uvIndex: c.uv_index,
      },
      hourly,
      daily,
    };
  },
};
