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

/** "classic" is today's single-window layout. "advanced" surfaces the
 * radar-window pop-out/multi-instance affordances in Shell and enables
 * session-restore of pop-out windows on launch (see electron/main.ts). */
export type UiModePref = "classic" | "advanced";

export interface ConfigFile {
  provider: WeatherProviderId;
  accuWeatherApiKey: string | null;
  /** WillyWeather API key — powers Australian BOM warnings/alerts (WillyWeather
   * re-publishes BOM's own warning feed under a documented, keyed public API). */
  willyWeatherApiKey: string | null;
  /** Powers the wind/temperature/precipitation tile overlays and the AQI
   * badge on the radar map(s) — see renderer/lib/overlays/openweathermap.ts. */
  openWeatherMapApiKey: string | null;
  libreWxrHost: string;
  units: UnitPref;
  timeFormat: TimeFormatPref;
  theme: ThemePref;
  autoRefreshMinutes: number;
  devToolsEnabled: boolean;
  /** Desktop toast notifications for new alerts, notable forecasts, and
   * heads-up severe-weather warnings across saved locations. */
  notificationsEnabled: boolean;
  /** SPC Day 1 Categorical Convective Outlook — radar outline overlay plus
   * an alerts-panel banner when the active location falls inside a risk
   * category. */
  spcOutlookEnabled: boolean;
  uiMode: UiModePref;
  /** Per alert-type (keyed by the `cssClass` taxonomy from
   * renderer/lib/alerts/classify.ts) visibility/color overrides for the
   * radar map's alert-polygon layer — see Settings → Alerts. Absent entry =
   * visible, default CSS color. */
  alertTypeOverrides: Record<string, { visible?: boolean; color?: string }>;
  /** "default" (weather-condition-driven accent) | a builtin theme id | "custom"
   * (uses customTheme below) — see Settings → Themes. */
  themeId: string;
  /** The user's last loaded/pasted custom theme JSON. */
  customTheme: ThemeDefinition | null;
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

/** A window's "kind" — every non-main window is one of these, carrying its
 * own independent radar/conditions state (see electron/main.ts's window
 * registry). "alert" windows are transient (token handoff only) and are
 * never persisted to SessionFile. */
export type WindowRole = "main" | "radar" | "conditions" | "alert";

export interface WindowLocation {
  lat: number;
  lon: number;
  label: string;
}

export interface WindowBoundsRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SessionWindowEntry {
  role: WindowRole;
  /** Unique per radar/conditions instance. Absent for "main" (there's only
   * ever one) — "alert" windows are never persisted at all. */
  instanceId?: string;
  /** For a "conditions" window, the radar instanceId whose location it tracks. */
  pairedInstanceId?: string;
  /** True for the one radar window (if any) that undocked the *main*
   * window's own radar — restored as the tracked "primary popout" on
   * relaunch so Shell knows to stay undocked instead of resetting to
   * docked on the next launch/refresh. */
  isPrimaryPopout?: boolean;
  location?: WindowLocation | null;
  bounds?: WindowBoundsRect;
}

export interface SessionFile {
  windows: SessionWindowEntry[];
}

export const DEFAULT_SESSION: SessionFile = { windows: [] };

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
  openWeatherMapApiKey: null,
  libreWxrHost: "https://api.librewxr.net",
  units: "F",
  timeFormat: "12",
  theme: "system",
  autoRefreshMinutes: 30,
  devToolsEnabled: false,
  notificationsEnabled: true,
  spcOutlookEnabled: true,
  uiMode: "classic",
  alertTypeOverrides: {},
  themeId: "default",
  customTheme: null,
};
