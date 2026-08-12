export interface SavedLocation {
  id: string;
  label: string;
  lat: number;
  lon: number;
  /** Cached AccuWeather location key so switching providers doesn't burn a
   * geoposition-search call against the free-tier daily quota every time. */
  accuWeatherLocationKey?: string;
}

export interface LocationsFile {
  savedLocations: SavedLocation[];
  activeLocationId: string | null;
}

export type WeatherProviderId = "open-meteo" | "accuweather";
export type UnitPref = "F" | "C";
export type TimeFormatPref = "12" | "24";
export type ThemePref = "system" | "light" | "dark";

export interface ConfigFile {
  provider: WeatherProviderId;
  accuWeatherApiKey: string | null;
  /** WillyWeather API key — powers Australian BOM warnings/alerts (WillyWeather
   * re-publishes BOM's own warning feed under a documented, keyed public API). */
  willyWeatherApiKey: string | null;
  libreWxrHost: string;
  units: UnitPref;
  timeFormat: TimeFormatPref;
  theme: ThemePref;
  autoRefreshMinutes: number;
  devToolsEnabled: boolean;
  /** Desktop toast notifications for new alerts, notable forecasts, and
   * heads-up severe-weather warnings across saved locations. */
  notificationsEnabled: boolean;
}

export const DEFAULT_LOCATIONS: LocationsFile = {
  savedLocations: [],
  activeLocationId: null,
};

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
}

export type UpdaterStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "not-available" }
  | { state: "downloading"; percent: number }
  | { state: "downloaded"; version: string }
  | { state: "error"; message: string }
  // Unpackaged/dev builds have no update feed — surfaced distinctly from a
  // real check failure so the About tab can explain rather than alarm.
  | { state: "unsupported" };

export const DEFAULT_CONFIG: ConfigFile = {
  provider: "open-meteo",
  accuWeatherApiKey: null,
  willyWeatherApiKey: null,
  libreWxrHost: "https://api.librewxr.net",
  units: "F",
  timeFormat: "12",
  theme: "system",
  autoRefreshMinutes: 30,
  devToolsEnabled: false,
  notificationsEnabled: true,
};
