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
  /** The animated gradient sweep across the top of the main window. Purely
   * decorative, so it's the one visual toggle that lives in General rather
   * than tied to any particular data feed. */
  topGlowEnabled: boolean;
  /** "classic" is today's single-window layout; "advanced" surfaces the
   * radar pop-out/multi-instance affordances. */
  uiMode: UiModePref;
  /** Per alert-type (keyed by the `cssClass` taxonomy from lib/alerts/classify.ts)
   * visibility/color overrides for the radar map's alert-polygon layer —
   * see Settings → Alerts. Absent entry = visible, default CSS color. */
  alertTypeOverrides: Record<string, { visible?: boolean; color?: string }>;
  /** "default" (weather-condition-driven accent, see lib/theme.ts) | a
   * builtin theme id from lib/themes/builtinThemes.ts | "custom" (uses
   * customTheme below) — see Settings → Themes. */
  themeId: string;
  /** The user's last loaded/pasted custom theme JSON, kept even while a
   * builtin theme is selected so switching back to "custom" doesn't lose it. */
  customTheme: ThemeDefinition | null;
  /** NWS weather radio easter feature — see lib/weather-radio. */
  weatherRadioEnabled: boolean;
  /** "simulated" synthesizes the SAME attention tone + reads the alert aloud
   * via speech synthesis; "live" plays a user-supplied audio stream while
   * attempting to decode real SAME tones from it. */
  weatherRadioMode: "simulated" | "live";
  /** "auto" resolves the nearest confirmed-live public NWR relay stream to
   * the active location (see lib/weather-radio/nwr-directory.ts); "manual"
   * uses weatherRadioLiveStreamUrl instead. */
  weatherRadioLiveFeedMode: "auto" | "manual";
  weatherRadioLiveStreamUrl: string | null;
}

export interface ThemeColors {
  a0?: string;
  bg?: string;
  surface?: string;
  surface3?: string;
  border?: string;
  text?: string;
  text2?: string;
  text3?: string;
  danger?: string;
  safe?: string;
}

export interface ThemeDefinition {
  name: string;
  colors: ThemeColors;
}
