//! Shared domain types. Every crate in the workspace builds against these, so
//! changes here are contract changes — keep them additive where possible.
//!
//! All weather values are stored metric/Celsius internally; unit conversion
//! happens once, at render time (see `units`).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/// A `[lon, lat]` pair, GeoJSON order.
pub type LonLat = [f64; 2];
/// A closed ring of `[lon, lat]` points.
pub type Ring = Vec<LonLat>;

/// Loosely typed GeoJSON geometry — only the variants the alert/outlook feeds
/// actually produce. Anything else deserializes to `Other`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "coordinates")]
pub enum Geometry {
    Point(LonLat),
    Polygon(Vec<Ring>),
    MultiPolygon(Vec<Vec<Ring>>),
    LineString(Ring),
    #[serde(other)]
    Other,
}

/// `[west, south, east, north]` in degrees.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct BBox {
    pub west: f64,
    pub south: f64,
    pub east: f64,
    pub north: f64,
}

impl BBox {
    pub fn new(west: f64, south: f64, east: f64, north: f64) -> Self {
        Self {
            west,
            south,
            east,
            north,
        }
    }
    /// Square box of `buffer_deg` degrees around a point.
    pub fn around(lat: f64, lon: f64, buffer_deg: f64) -> Self {
        Self::new(
            lon - buffer_deg,
            lat - buffer_deg,
            lon + buffer_deg,
            lat + buffer_deg,
        )
    }
    /// Clamp to valid Web-Mercator-ish Earth coordinates (lon ±180, lat ±85).
    pub fn clamped(self) -> Self {
        Self::new(
            self.west.clamp(-180.0, 180.0),
            self.south.clamp(-85.0, 85.0),
            self.east.clamp(-180.0, 180.0),
            self.north.clamp(-85.0, 85.0),
        )
    }
    pub fn contains(&self, lat: f64, lon: f64) -> bool {
        lat >= self.south && lat <= self.north && lon >= self.west && lon <= self.east
    }
    pub fn as_csv(&self) -> String {
        format!("{},{},{},{}", self.west, self.south, self.east, self.north)
    }
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AlertSource {
    Nws,
    Eccc,
    LibreWxr,
    Bom,
    Spc,
    Demo,
}

/// CAP-style severity tiers, ordered most-severe first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Severity {
    Extreme,
    Severe,
    Moderate,
    Minor,
    Unknown,
}

impl Severity {
    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "extreme" => Severity::Extreme,
            "severe" => Severity::Severe,
            "moderate" => Severity::Moderate,
            "minor" => Severity::Minor,
            _ => Severity::Unknown,
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Severity::Extreme => "Extreme",
            Severity::Severe => "Severe",
            Severity::Moderate => "Moderate",
            Severity::Minor => "Minor",
            Severity::Unknown => "Unknown",
        }
    }
    /// Sort rank, 0 = most severe.
    pub fn rank(self) -> u8 {
        self as u8
    }
}

/// A normalized alert from any source. `class` is the hazard-class key
/// (formerly the CSS class, e.g. `alert-tornado-warning`) shared by the audit
/// log rows, the radar polygon layer, the TTS announcer and per-type settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Alert {
    /// Stable id: `source:...` — used for de-dupe across refreshes.
    pub id: String,
    pub source: AlertSource,
    pub event: String,
    pub display_event: String,
    pub class: String,
    pub headline: Option<String>,
    pub description: Option<String>,
    pub instruction: Option<String>,
    pub severity: Severity,
    pub area_desc: Option<String>,
    /// RFC 3339 timestamps.
    pub onset: Option<String>,
    pub sent: Option<String>,
    pub expires: Option<String>,
    pub issuing_office: Option<String>,
    pub url: Option<String>,
    pub geometry: Option<Geometry>,
    /// NWS zone-boundary API URLs — used to synthesize a polygon when
    /// `geometry` is `None`.
    #[serde(default)]
    pub affected_zones: Vec<String>,
    /// Raw VTEC string (NWS only).
    pub vtec: Option<String>,
}

impl Alert {
    /// Cross-source de-dupe key: event + area + onset, lowercased.
    pub fn dedupe_key(&self) -> String {
        format!(
            "{}|{}|{}",
            self.event,
            self.area_desc.as_deref().unwrap_or(""),
            self.onset.as_deref().unwrap_or("")
        )
        .to_lowercase()
    }
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CurrentConditions {
    pub temperature_c: f64,
    pub apparent_temperature_c: f64,
    /// WMO weather code (0-99) — every provider normalizes into this space.
    pub weather_code: u8,
    pub is_day: bool,
    pub relative_humidity_pct: f64,
    pub wind_speed_kmh: f64,
    pub wind_direction_deg: f64,
    pub precipitation_mm: f64,
    pub cloud_cover_pct: f64,
    pub uv_index: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HourlyPoint {
    /// ISO 8601 local time, no offset (as Open-Meteo returns it).
    pub time: String,
    pub temperature_c: f64,
    pub weather_code: u8,
    pub is_day: bool,
    pub precipitation_probability_pct: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DailyPoint {
    /// ISO date, e.g. `2026-08-11`.
    pub date: String,
    pub weather_code: u8,
    pub temp_max_c: f64,
    pub temp_min_c: f64,
    pub precipitation_probability_max_pct: f64,
    pub sunrise: String,
    pub sunset: String,
    pub uv_index_max: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Weather {
    pub current: CurrentConditions,
    pub hourly: Vec<HourlyPoint>,
    pub daily: Vec<DailyPoint>,
    pub timezone: String,
    pub provider: WeatherProviderId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum WeatherProviderId {
    #[default]
    OpenMeteo,
    AccuWeather,
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Location {
    pub lat: f64,
    pub lon: f64,
    pub label: String,
}

impl Location {
    pub fn new(lat: f64, lon: f64, label: impl Into<String>) -> Self {
        Self {
            lat,
            lon,
            label: label.into(),
        }
    }
    /// e.g. `32.83°N  109.71°W`
    pub fn coord_label(&self) -> String {
        format!(
            "{:.2}°{}  {:.2}°{}",
            self.lat.abs(),
            if self.lat < 0.0 { "S" } else { "N" },
            self.lon.abs(),
            if self.lon < 0.0 { "W" } else { "E" }
        )
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedLocation {
    pub id: String,
    pub label: String,
    pub lat: f64,
    pub lon: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accu_weather_location_key: Option<String>,
}

impl SavedLocation {
    pub fn to_location(&self) -> Location {
        Location::new(self.lat, self.lon, self.label.clone())
    }
}

// ---------------------------------------------------------------------------
// Settings / theme
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum UnitPref {
    #[default]
    F,
    C,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum TimeFormat {
    #[serde(rename = "12")]
    #[default]
    H12,
    #[serde(rename = "24")]
    H24,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ThemePref {
    #[default]
    System,
    Light,
    Dark,
}

/// A theme's color slots. Every field optional so a pasted partial theme
/// falls back to the base palette slot-by-slot. Colors are CSS-ish strings
/// (`#rrggbb`, `rgba(r, g, b, a)`), and `a0` is the accent as a bare
/// `"r, g, b"` triple — all parsed by `theme::parse_color`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ThemeColors {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub a0: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bg: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface3: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text2: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text3: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub danger: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub safe: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThemeDefinition {
    /// Stable id (`pink-fuchsia`, ...). Empty for a user-pasted custom theme.
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub colors: ThemeColors,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct AlertTypeOverride {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum RadioMode {
    #[default]
    Simulated,
    Live,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum LiveFeedMode {
    #[default]
    Auto,
    Manual,
}

/// Which alert severities the TTS announcer reads aloud.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum TtsSeverityFilter {
    ExtremeOnly,
    #[default]
    SevereAndUp,
    ModerateAndUp,
    All,
}

impl TtsSeverityFilter {
    pub fn allows(self, severity: Severity) -> bool {
        match self {
            TtsSeverityFilter::ExtremeOnly => severity == Severity::Extreme,
            TtsSeverityFilter::SevereAndUp => severity <= Severity::Severe,
            TtsSeverityFilter::ModerateAndUp => severity <= Severity::Moderate,
            TtsSeverityFilter::All => true,
        }
    }
}

/// Radar-panel layer and rendering preferences (`config.json` > `radar`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RadarSettings {
    /// LibreWXR color scheme id (see `WeatherMaps::color_schemes`).
    pub color_scheme: u8,
    /// Composite radar tile opacity 0.0..=1.0.
    pub opacity: f32,
    pub smooth: bool,
    pub snow: bool,
    /// Storm motion arrows.
    pub show_arrows: bool,
    /// Storm cell markers.
    pub show_cells: bool,
    /// Alert polygons.
    pub show_polygons: bool,
    /// Include nowcast frames in the loop.
    pub nowcast: bool,
    /// IR satellite layer.
    pub satellite: bool,
    pub legend: bool,
    /// Uppercase ICAO id of the single-site NEXRAD WMS (e.g. `KFSX`); `None` = composite radar.
    pub nexrad_site: Option<String>,
    pub nexrad_product: RadarProduct,
    /// SPC mesoscale discussion polygons.
    pub md_polygons: bool,
    pub wind_barbs: bool,
    /// WSR-88D site markers.
    pub show_stations: bool,
    pub owm_wind: bool,
    pub owm_temp: bool,
    pub owm_precip: bool,
    pub aqi_badge: bool,
    /// Auto-load alerts whose polygons fall inside the visible map area.
    pub viewport_alerts: bool,
}

impl Default for RadarSettings {
    fn default() -> Self {
        Self {
            color_scheme: 1,
            opacity: 0.75,
            smooth: true,
            snow: true,
            show_arrows: false,
            show_cells: false,
            show_polygons: true,
            nowcast: true,
            satellite: false,
            legend: true,
            nexrad_site: None,
            nexrad_product: RadarProduct::SrBref,
            md_polygons: true,
            wind_barbs: false,
            show_stations: true,
            owm_wind: false,
            owm_temp: false,
            owm_precip: false,
            aqi_badge: false,
            viewport_alerts: true,
        }
    }
}

/// Persisted user configuration (`config.json`). `#[serde(default)]` on the
/// struct means any missing key falls back to `Config::default()`, so older
/// files load cleanly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub provider: WeatherProviderId,
    pub accu_weather_api_key: Option<String>,
    pub willy_weather_api_key: Option<String>,
    pub open_weather_map_api_key: Option<String>,
    pub libre_wxr_host: String,
    pub units: UnitPref,
    pub time_format: TimeFormat,
    pub theme: ThemePref,
    pub auto_refresh_minutes: u32,
    pub dev_tools_enabled: bool,
    pub notifications_enabled: bool,
    pub spc_outlook_enabled: bool,
    pub top_glow_enabled: bool,
    /// `"default"` (condition-driven accent) | a builtin theme id | `"custom"`.
    pub theme_id: String,
    pub custom_theme: Option<ThemeDefinition>,
    pub alert_type_overrides: BTreeMap<String, AlertTypeOverride>,
    pub weather_radio_enabled: bool,
    pub weather_radio_mode: RadioMode,
    pub weather_radio_live_feed_mode: LiveFeedMode,
    pub weather_radio_live_stream_url: Option<String>,
    // --- new in the Rust rebuild ---
    /// Read newly arrived alerts aloud (native TTS), independent of the
    /// weather-radio simulation.
    pub tts_alerts_enabled: bool,
    pub tts_severity_filter: TtsSeverityFilter,
    /// Play the SAME two-tone attention signal before each spoken alert.
    pub tts_attention_tone: bool,
    /// Speech rate multiplier, 0.5–2.0.
    pub tts_rate: f32,
    /// Also announce alerts for every saved location, not just the active one.
    pub tts_all_saved_locations: bool,
    /// Draw distinct, emphasized "storm" polygons (tornado / severe tstorm /
    /// flash-flood warnings, PDS/emergency tiers) above zone-based polygons.
    pub storm_polygons_enabled: bool,
    pub radar: RadarSettings,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            provider: WeatherProviderId::OpenMeteo,
            accu_weather_api_key: None,
            willy_weather_api_key: None,
            open_weather_map_api_key: None,
            libre_wxr_host: "https://api.librewxr.net".to_string(),
            units: UnitPref::F,
            time_format: TimeFormat::H12,
            theme: ThemePref::System,
            auto_refresh_minutes: 10,
            dev_tools_enabled: false,
            notifications_enabled: true,
            spc_outlook_enabled: true,
            top_glow_enabled: true,
            theme_id: "default".to_string(),
            custom_theme: None,
            alert_type_overrides: BTreeMap::new(),
            weather_radio_enabled: false,
            weather_radio_mode: RadioMode::Simulated,
            weather_radio_live_feed_mode: LiveFeedMode::Auto,
            weather_radio_live_stream_url: None,
            tts_alerts_enabled: false,
            tts_severity_filter: TtsSeverityFilter::SevereAndUp,
            tts_attention_tone: true,
            tts_rate: 0.95,
            tts_all_saved_locations: false,
            storm_polygons_enabled: true,
            radar: RadarSettings::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct LocationsFile {
    pub saved_locations: Vec<SavedLocation>,
    pub active_location_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Windows / layout session
// ---------------------------------------------------------------------------

/// Every kind of window the app can open. Every non-main window carries its
/// own independent state; `Alert` windows are transient and never persisted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WindowRole {
    Main,
    Radar,
    Conditions,
    Alert,
    AuditLog,
    WeatherRadio,
    Settings,
}

/// The dockable panels of the main window (and what a pop-out window hosts).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PanelKind {
    Locations,
    Radar,
    AuditLog,
    Conditions,
    Forecast,
    Hourly,
    Radio,
}

impl PanelKind {
    pub const ALL: [PanelKind; 7] = [
        PanelKind::Locations,
        PanelKind::Radar,
        PanelKind::AuditLog,
        PanelKind::Conditions,
        PanelKind::Forecast,
        PanelKind::Hourly,
        PanelKind::Radio,
    ];
    pub fn id(self) -> &'static str {
        match self {
            PanelKind::Locations => "locations",
            PanelKind::Radar => "radar",
            PanelKind::AuditLog => "audit-log",
            PanelKind::Conditions => "conditions",
            PanelKind::Forecast => "forecast",
            PanelKind::Hourly => "hourly",
            PanelKind::Radio => "radio",
        }
    }
    pub fn title(self) -> &'static str {
        match self {
            PanelKind::Locations => "LOCATIONS",
            PanelKind::Radar => "RADAR",
            PanelKind::AuditLog => "AUDIT LOG",
            PanelKind::Conditions => "CONDITIONS",
            PanelKind::Forecast => "7-DAY",
            PanelKind::Hourly => "HOURLY",
            PanelKind::Radio => "WX RADIO",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        let s = s.trim().to_ascii_lowercase();
        PanelKind::ALL.iter().copied().find(|p| {
            p.id() == s
                || p.id().replace('-', "") == s
                || p.title().to_ascii_lowercase().replace(' ', "") == s.replace(' ', "")
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Column {
    Left,
    Center,
    Right,
}

impl Column {
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "left" | "l" => Some(Column::Left),
            "center" | "centre" | "c" | "mid" | "middle" => Some(Column::Center),
            "right" | "r" => Some(Column::Right),
            _ => None,
        }
    }
}

/// The main window's dockable layout: three columns, each an ordered stack of
/// panels. A panel absent from every column is hidden (or popped out).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Layout {
    pub left: Vec<PanelKind>,
    pub center: Vec<PanelKind>,
    pub right: Vec<PanelKind>,
    /// Column widths as fractions of the window width; center takes the rest.
    pub left_width_frac: f32,
    pub right_width_frac: f32,
    /// Panels the user explicitly hid (`:hide radar`).
    pub hidden: Vec<PanelKind>,
}

impl Default for Layout {
    fn default() -> Self {
        Self {
            left: vec![PanelKind::Locations],
            center: vec![PanelKind::Radar, PanelKind::AuditLog],
            right: vec![
                PanelKind::Conditions,
                PanelKind::Hourly,
                PanelKind::Forecast,
            ],
            left_width_frac: 0.19,
            right_width_frac: 0.24,
            hidden: vec![],
        }
    }
}

impl Layout {
    pub fn column_mut(&mut self, col: Column) -> &mut Vec<PanelKind> {
        match col {
            Column::Left => &mut self.left,
            Column::Center => &mut self.center,
            Column::Right => &mut self.right,
        }
    }
    pub fn column(&self, col: Column) -> &Vec<PanelKind> {
        match col {
            Column::Left => &self.left,
            Column::Center => &self.center,
            Column::Right => &self.right,
        }
    }
    pub fn find(&self, panel: PanelKind) -> Option<(Column, usize)> {
        for col in [Column::Left, Column::Center, Column::Right] {
            if let Some(i) = self.column(col).iter().position(|p| *p == panel) {
                return Some((col, i));
            }
        }
        None
    }
    /// Remove a panel from wherever it is (docked or hidden).
    pub fn remove(&mut self, panel: PanelKind) {
        for col in [Column::Left, Column::Center, Column::Right] {
            self.column_mut(col).retain(|p| *p != panel);
        }
        self.hidden.retain(|p| *p != panel);
    }
    /// Move (or re-show) a panel into `col` at `index` (clamped; `None` = end).
    pub fn place(&mut self, panel: PanelKind, col: Column, index: Option<usize>) {
        self.remove(panel);
        let v = self.column_mut(col);
        let i = index.unwrap_or(v.len()).min(v.len());
        v.insert(i, panel);
    }
    pub fn hide(&mut self, panel: PanelKind) {
        self.remove(panel);
        self.hidden.push(panel);
    }
    pub fn is_docked(&self, panel: PanelKind) -> bool {
        self.find(panel).is_some()
    }
    /// Swap two panels' positions wherever they are docked.
    pub fn swap(&mut self, a: PanelKind, b: PanelKind) {
        let (Some(pa), Some(pb)) = (self.find(a), self.find(b)) else {
            return;
        };
        self.column_mut(pa.0)[pa.1] = b;
        self.column_mut(pb.0)[pb.1] = a;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WindowBounds {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

/// One restorable pop-out window in `session.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionWindow {
    pub role: WindowRole,
    /// Unique per radar/conditions/audit-log instance. Absent for `Main`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    /// For a conditions/audit-log window: the radar instance id (or `"main"`)
    /// whose location it tracks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paired_instance_id: Option<String>,
    /// True for the one pop-out that undocked the main window's own panel.
    #[serde(default)]
    pub is_primary_popout: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<Location>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<WindowBounds>,
    /// Which panel a `Main`-role pop-out hosts (for popped-out dock panels).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub panel: Option<PanelKind>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct SessionFile {
    pub windows: Vec<SessionWindow>,
    pub layout: Layout,
    pub main_bounds: Option<WindowBounds>,
}

// ---------------------------------------------------------------------------
// Radar
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RadarFrame {
    /// Unix seconds.
    pub time: i64,
    /// Path fragment, e.g. `/v2/radar/1699999999`.
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ColorScheme {
    pub id: u8,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct WeatherMaps {
    pub host: String,
    pub generated: i64,
    pub radar_past: Vec<RadarFrame>,
    pub radar_nowcast: Vec<RadarFrame>,
    pub satellite_infrared: Vec<RadarFrame>,
    pub color_schemes: Vec<ColorScheme>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RadarStation {
    pub id: String,
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    pub elevation_m: Option<f64>,
    pub vcp: Option<u32>,
    pub operability_status: Option<String>,
    pub alarm_summary: Option<String>,
    /// RFC 3339.
    pub last_received_time: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum RadarProduct {
    /// Super-res base reflectivity.
    SrBref,
    /// Super-res base velocity.
    SrBvel,
    /// Digital hydrometeor classification.
    Bdhc,
    /// Digital storm-total accumulation.
    Bdsa,
    /// One-hour accumulation.
    Boha,
}

impl RadarProduct {
    pub const ALL: [RadarProduct; 5] = [
        RadarProduct::SrBref,
        RadarProduct::SrBvel,
        RadarProduct::Bdhc,
        RadarProduct::Bdsa,
        RadarProduct::Boha,
    ];
    pub fn id(self) -> &'static str {
        match self {
            RadarProduct::SrBref => "sr_bref",
            RadarProduct::SrBvel => "sr_bvel",
            RadarProduct::Bdhc => "bdhc",
            RadarProduct::Bdsa => "bdsa",
            RadarProduct::Boha => "boha",
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            RadarProduct::SrBref => "Reflectivity",
            RadarProduct::SrBvel => "Velocity",
            RadarProduct::Bdhc => "Hydrometeor Class.",
            RadarProduct::Bdsa => "Storm Total Precip",
            RadarProduct::Boha => "1-Hr Accumulation",
        }
    }
    pub fn description(self) -> &'static str {
        match self {
            RadarProduct::SrBref => "Super-resolution base reflectivity — precipitation intensity.",
            RadarProduct::SrBvel => {
                "Super-resolution base radial velocity — motion toward/away from the radar."
            }
            RadarProduct::Bdhc => {
                "Dual-pol digital hydrometeor classification — rain, hail, snow, and more."
            }
            RadarProduct::Bdsa => "Dual-pol digital storm total precipitation.",
            RadarProduct::Boha => "Surface rainfall accumulation, running one-hour total.",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "sr_bref" | "bref" | "ref" | "reflectivity" | "refl" => Some(RadarProduct::SrBref),
            "sr_bvel" | "bvel" | "vel" | "velocity" => Some(RadarProduct::SrBvel),
            "bdhc" | "hydro" | "hc" | "hydrometeor" => Some(RadarProduct::Bdhc),
            "bdsa" | "storm-total" | "stormtotal" | "sta" => Some(RadarProduct::Bdsa),
            "boha" | "1hr" | "oha" | "one-hour" => Some(RadarProduct::Boha),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MetarStation {
    pub id: String,
    pub name: String,
    pub lat: f64,
    pub lon: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MetarObservation {
    pub station_id: String,
    pub wind_direction_deg: Option<f64>,
    pub wind_speed_kt: Option<f64>,
    pub wind_gust_kt: Option<f64>,
    pub timestamp: Option<String>,
}

// ---------------------------------------------------------------------------
// SPC
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpcOutlookFeature {
    /// e.g. `SLGT`
    pub code: String,
    /// e.g. `Slight Risk`
    pub name: String,
    pub level: i32,
    /// SPC's official hex colors.
    pub stroke: String,
    pub fill: String,
    pub valid: String,
    pub expire: String,
    pub issue: String,
    pub geometry: Geometry,
}

// ---------------------------------------------------------------------------
// Weather radio
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NwrFeed {
    pub callsign: String,
    pub city: String,
    pub state: String,
    pub lat: f64,
    pub lon: f64,
    pub coverage: String,
    pub stream_url: String,
    pub provider: String,
}

// ---------------------------------------------------------------------------
// Air quality (OpenWeatherMap 1–5 scale)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AirQuality {
    pub aqi: u8,
    pub pm2_5: f64,
    pub pm10: f64,
    pub o3: f64,
    pub no2: f64,
}

impl AirQuality {
    pub fn label(&self) -> &'static str {
        match self.aqi {
            1 => "Good",
            2 => "Fair",
            3 => "Moderate",
            4 => "Poor",
            5 => "Very Poor",
            _ => "Unknown",
        }
    }
}

#[cfg(test)]
mod radar_settings_tests {
    use super::*;

    #[test]
    fn viewport_alerts_defaults_on_and_missing_key_is_true() {
        assert!(RadarSettings::default().viewport_alerts);
        let r: RadarSettings = serde_json::from_str(r#"{"opacity":0.5}"#).unwrap();
        assert!(r.viewport_alerts);
    }

    #[test]
    fn config_without_radar_key_uses_defaults() {
        let c: Config = serde_json::from_str(r#"{"units":"C"}"#).unwrap();
        assert_eq!(c.radar, RadarSettings::default());
        assert_eq!(c.radar.color_scheme, 1);
        assert!(c.radar.show_polygons);
    }

    #[test]
    fn radar_settings_roundtrip_camel_case() {
        let mut r = RadarSettings {
            color_scheme: 4,
            nexrad_site: Some("KFSX".into()),
            ..RadarSettings::default()
        };
        r.nexrad_product = RadarProduct::SrBvel;
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["colorScheme"], 4);
        assert_eq!(v["nexradSite"], "KFSX");
        let back: RadarSettings = serde_json::from_value(v).unwrap();
        assert_eq!(back, r);
    }

    #[test]
    fn partial_radar_object_fills_defaults() {
        let c: Config = serde_json::from_str(r#"{"radar":{"opacity":0.5}}"#).unwrap();
        assert_eq!(c.radar.opacity, 0.5);
        assert!(c.radar.smooth);
    }
}
