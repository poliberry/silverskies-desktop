import type { WeatherProviderId } from "@/types/settings";
import { accuWeatherProvider } from "./accuweather";
import { openMeteoProvider } from "./open-meteo";
import type { WeatherProvider } from "./types";

export const providers: Record<WeatherProviderId, WeatherProvider> = {
  "open-meteo": openMeteoProvider,
  accuweather: accuWeatherProvider,
};

export * from "./types";
