// Mirrors electron/types.ts — kept as a separate copy since renderer/ and
// electron/ are independent TypeScript projects/packages. Field names must
// stay in sync with the IPC contract in electron/preload.ts.

export type WeatherProviderId = "open-meteo" | "accuweather";
export type UnitPref = "F" | "C";
export type TimeFormatPref = "12" | "24";
export type ThemePref = "system" | "light" | "dark";

export interface SavedLocation {
  id: string;
  label: string;
  lat: number;
  lon: number;
  accuWeatherLocationKey?: string;
}

export interface LocationsFile {
  savedLocations: SavedLocation[];
  activeLocationId: string | null;
}

export type UiModePref = "classic" | "advanced";

export interface ConfigFile {
  provider: WeatherProviderId;
  accuWeatherApiKey: string | null;
  /** WillyWeather API key — powers Australian BOM warnings/alerts (WillyWeather
   * re-publishes BOM's own warning feed under a documented, keyed public API). */
  willyWeatherApiKey: string | null;
  /** Powers the wind/temperature/precipitation tile overlays and the AQI
   * badge on the radar map(s) — see lib/overlays/openweathermap.ts. */
  openWeatherMapApiKey: string | null;
  libreWxrHost: string;
  units: UnitPref;
  timeFormat: TimeFormatPref;
  theme: ThemePref;
  autoRefreshMinutes: number;
  devToolsEnabled: boolean;
  notificationsEnabled: boolean;
  /** SPC Day 1 Categorical Convective Outlook — radar outline overlay plus
   * an alerts-panel banner when the active location falls inside a risk
   * category. */
  spcOutlookEnabled: boolean;
  /** "classic" is today's single-window layout; "advanced" surfaces the
   * radar pop-out/multi-instance affordances. */
  uiMode: UiModePref;
}
