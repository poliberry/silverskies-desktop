import type { DailyPoint, HourlyPoint, NormalizedWeather } from "@/types/weather";
import { accuWeatherIconToWmo } from "./accuweather-icons";
import { ProviderConfigError, type WeatherProvider, type WeatherProviderContext } from "./types";

const BASE = "https://dataservice.accuweather.com";

async function accuFetch(path: string, apiKey: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams({ apikey: apiKey, ...params });
  const r = await fetch(`${BASE}${path}?${qs}`);
  if (r.status === 401 || r.status === 403) {
    throw new ProviderConfigError("AccuWeather rejected the API key — check it in Settings.");
  }
  if (r.status === 503) {
    throw new ProviderConfigError("AccuWeather daily call limit reached for this key.");
  }
  if (!r.ok) throw new Error(`AccuWeather error ${r.status}`);
  return r.json();
}

async function resolveLocationKey(ctx: WeatherProviderContext, apiKey: string): Promise<string> {
  const cached = ctx.savedLocation?.accuWeatherLocationKey;
  if (cached) return cached;

  const results = await accuFetch("/locations/v1/cities/geoposition/search", apiKey, {
    q: `${ctx.lat},${ctx.lon}`,
  });
  const key = results?.Key;
  if (!key) throw new Error("AccuWeather couldn't resolve a location for these coordinates.");
  ctx.onResolvedLocationKey?.(key);
  return key;
}

export const accuWeatherProvider: WeatherProvider = {
  id: "accuweather",
  async fetchWeather(ctx: WeatherProviderContext): Promise<NormalizedWeather> {
    const apiKey = ctx.accuWeatherApiKey?.trim();
    if (!apiKey) {
      throw new ProviderConfigError("Add an AccuWeather API key in Settings to use this provider.");
    }

    const locationKey = await resolveLocationKey(ctx, apiKey);

    const [current, hourly12, daily5] = await Promise.all([
      accuFetch(`/currentconditions/v1/${locationKey}`, apiKey, { details: "true" }),
      accuFetch(`/forecasts/v1/hourly/12hour/${locationKey}`, apiKey, {
        metric: "true",
        details: "true",
      }),
      accuFetch(`/forecasts/v1/daily/5day/${locationKey}`, apiKey, {
        metric: "true",
        details: "true",
      }),
    ]);

    const cur = current[0];
    const isDay = Boolean(cur.IsDayTime);

    const hourly: HourlyPoint[] = (hourly12 as any[]).map((h) => ({
      time: h.DateTime,
      temperatureC: h.Temperature.Value,
      weatherCode: accuWeatherIconToWmo(h.WeatherIcon),
      isDay: Boolean(h.IsDaylight),
      precipitationProbabilityPct: h.PrecipitationProbability ?? 0,
    }));

    const daily: DailyPoint[] = (daily5.DailyForecasts as any[]).map((d) => {
      const uvEntry = (d.AirAndPollen as any[] | undefined)?.find((p) => p.Name === "UVIndex");
      return {
        date: d.Date,
        weatherCode: accuWeatherIconToWmo(d.Day.Icon),
        tempMaxC: d.Temperature.Maximum.Value,
        tempMinC: d.Temperature.Minimum.Value,
        precipitationProbabilityMaxPct: Math.max(
          d.Day.PrecipitationProbability ?? 0,
          d.Night.PrecipitationProbability ?? 0,
        ),
        sunrise: d.Sun?.Rise ?? d.Date,
        sunset: d.Sun?.Set ?? d.Date,
        uvIndexMax: uvEntry?.Value ?? 0,
      };
    });

    return {
      provider: "accuweather",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      current: {
        temperatureC: cur.Temperature.Metric.Value,
        apparentTemperatureC: cur.RealFeelTemperature?.Metric.Value ?? cur.Temperature.Metric.Value,
        weatherCode: accuWeatherIconToWmo(cur.WeatherIcon),
        isDay,
        relativeHumidityPct: cur.RelativeHumidity,
        windSpeedKmh: cur.Wind?.Speed.Metric.Value ?? 0,
        windDirectionDeg: cur.Wind?.Direction?.Degrees ?? 0,
        precipitationMm: cur.Precip1hr?.Metric.Value ?? 0,
        cloudCoverPct: cur.CloudCover ?? 0,
        uvIndex: cur.UVIndex ?? daily[0]?.uvIndexMax ?? 0,
      },
      hourly,
      daily,
    };
  },
};
