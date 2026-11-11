//! Executes parsed `:` commands against the application state.

use std::time::{Duration, Instant};

use chrono::Utc;
use ss_audio::alert_announcement;
use ss_core::alerts::demo::{build_asteroid_alert, build_demo_alert, DEMO_GROUPS};
use ss_core::command::{AlertsCmd, Command, RadarCmd, RadioCmd};
use ss_core::theme::builtin_themes;
use ss_core::{
    Alert, Column, Config, Layout, LiveFeedMode, Location, PanelKind, RadioMode, SavedLocation,
    Severity, ThemePref, TimeFormat, TtsSeverityFilter, UnitPref, WindowRole,
};

use crate::app::App;
use crate::audio::should_announce;
use crate::state::{AsteroidState, LogLevel, PanelRequests, Shared, WindowTarget};
use crate::tasks::Tasks;
use crate::windows::req_mut;

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

/// Resolve a user-typed target to an index into the saved list: exact id, a
/// 1-based list number, an id prefix (4+ chars), then label (exact, then
/// case-insensitive substring).
pub fn match_target(locs: &[SavedLocation], target: &str) -> Option<usize> {
    let t = target.trim();
    if t.is_empty() {
        return None;
    }
    if let Some(i) = locs.iter().position(|l| l.id == t) {
        return Some(i);
    }
    if t.chars().all(|c| c.is_ascii_digit()) {
        if let Ok(n) = t.parse::<usize>() {
            if (1..=locs.len()).contains(&n) {
                return Some(n - 1);
            }
        }
    }
    if t.len() >= 4 {
        if let Some(i) = locs.iter().position(|l| l.id.starts_with(t)) {
            return Some(i);
        }
    }
    let lower = t.to_lowercase();
    locs.iter()
        .position(|l| l.label.to_lowercase() == lower)
        .or_else(|| {
            locs.iter()
                .position(|l| l.label.to_lowercase().contains(&lower))
        })
}

#[derive(Debug, Clone, PartialEq)]
pub enum SetOp {
    AutoRefreshMinutes(u32),
    LibrewxrHost(String),
    Notifications(bool),
    SpcOutlook(bool),
    TopGlow(bool),
    DevTools(bool),
    StormPolygons(bool),
    TtsAlerts(bool),
    TtsFilter(TtsSeverityFilter),
    TtsRate(f32),
    RadarOpacity(u8),
    RadarScheme(u8),
}

fn parse_bool(v: &str) -> Result<bool, String> {
    match v.trim().to_ascii_lowercase().as_str() {
        "on" | "true" | "yes" | "1" | "y" => Ok(true),
        "off" | "false" | "no" | "0" | "n" => Ok(false),
        other => Err(format!("expected on/off, got {other:?}")),
    }
}

/// Parse `:set <key> <value>` into a typed operation.
pub fn parse_set(key: &str, value: &str) -> Result<SetOp, String> {
    let norm: String = key
        .chars()
        .filter(|c| *c != '-' && *c != '_')
        .collect::<String>()
        .to_ascii_lowercase();
    let value = value.trim();
    match norm.as_str() {
        "autorefreshminutes" | "autorefresh" => value
            .parse::<u32>()
            .ok()
            .filter(|m| *m <= 1440)
            .map(SetOp::AutoRefreshMinutes)
            .ok_or_else(|| format!("autoRefreshMinutes: expected 0-1440, got {value:?}")),
        "librewxrhost" => {
            if value.starts_with("http://") || value.starts_with("https://") {
                Ok(SetOp::LibrewxrHost(value.trim_end_matches('/').to_string()))
            } else {
                Err("librewxrHost: expected an http(s) URL".to_string())
            }
        }
        "notifications" => parse_bool(value).map(SetOp::Notifications),
        "spcoutlook" => parse_bool(value).map(SetOp::SpcOutlook),
        "topglow" => parse_bool(value).map(SetOp::TopGlow),
        "devtools" => parse_bool(value).map(SetOp::DevTools),
        "stormpolygons" => parse_bool(value).map(SetOp::StormPolygons),
        "ttsalerts" => parse_bool(value).map(SetOp::TtsAlerts),
        "ttsfilter" => match value.to_ascii_lowercase().replace('_', "-").as_str() {
            "extreme" | "extreme-only" => Ok(SetOp::TtsFilter(TtsSeverityFilter::ExtremeOnly)),
            "severe" | "severe-and-up" => Ok(SetOp::TtsFilter(TtsSeverityFilter::SevereAndUp)),
            "moderate" | "moderate-and-up" => {
                Ok(SetOp::TtsFilter(TtsSeverityFilter::ModerateAndUp))
            }
            "all" => Ok(SetOp::TtsFilter(TtsSeverityFilter::All)),
            _ => Err("ttsFilter: expected extreme, severe, moderate or all".to_string()),
        },
        "ttsrate" => value
            .parse::<f32>()
            .ok()
            .filter(|r| (0.5..=2.0).contains(r))
            .map(SetOp::TtsRate)
            .ok_or_else(|| format!("ttsRate: expected 0.5-2.0, got {value:?}")),
        "radaropacity" => value
            .parse::<u8>()
            .ok()
            .filter(|p| *p <= 100)
            .map(SetOp::RadarOpacity)
            .ok_or_else(|| format!("radarOpacity: expected 0-100, got {value:?}")),
        "radarscheme" => value
            .parse::<u8>()
            .map(SetOp::RadarScheme)
            .map_err(|_| format!("radarScheme: expected a scheme number, got {value:?}")),
        _ => Err(format!("unknown setting: {key}")),
    }
}

pub fn apply_set(cfg: &mut Config, op: SetOp) {
    match op {
        SetOp::AutoRefreshMinutes(m) => cfg.auto_refresh_minutes = m,
        SetOp::LibrewxrHost(h) => cfg.libre_wxr_host = h,
        SetOp::Notifications(b) => cfg.notifications_enabled = b,
        SetOp::SpcOutlook(b) => cfg.spc_outlook_enabled = b,
        SetOp::TopGlow(b) => cfg.top_glow_enabled = b,
        SetOp::DevTools(b) => cfg.dev_tools_enabled = b,
        SetOp::StormPolygons(b) => cfg.storm_polygons_enabled = b,
        SetOp::TtsAlerts(b) => cfg.tts_alerts_enabled = b,
        SetOp::TtsFilter(f) => cfg.tts_severity_filter = f,
        SetOp::TtsRate(r) => cfg.tts_rate = r,
        SetOp::RadarOpacity(p) => cfg.radar.opacity = f32::from(p) / 100.0,
        SetOp::RadarScheme(s) => cfg.radar.color_scheme = s,
    }
}

/// Resolve `:demo <x>`: an exact event name in any group (case-insensitive),
/// else a group name (its first item).
pub fn resolve_demo(s: &str) -> Option<(&'static str, Severity)> {
    let q = s.trim().to_ascii_lowercase();
    if q.is_empty() {
        return None;
    }
    DEMO_GROUPS
        .iter()
        .flat_map(|g| g.items.iter())
        .find(|(ev, _)| ev.to_ascii_lowercase() == q)
        .or_else(|| {
            DEMO_GROUPS
                .iter()
                .find(|g| g.name.to_ascii_lowercase() == q)
                .and_then(|g| g.items.first())
        })
        .map(|(ev, sev)| (*ev, *sev))
}

// Add one demo alert for `event` (replacing one with the same id).
fn add_demo_alert(sh: &mut Shared, event: &str, severity: Severity) -> Alert {
    let alert = build_demo_alert(event, severity, Utc::now());
    sh.log(
        LogLevel::Info,
        format!("demo alert: {} [{}]", alert.display_event, severity.label()),
    );
    sh.demo_alerts.retain(|a| a.id != alert.id);
    sh.demo_alerts.push(alert.clone());
    sh.bump_alerts();
    alert
}

/// Seconds an asteroid countdown lasts.
const ASTEROID_SECS: u64 = 60;

fn start_asteroid(sh: &mut Shared) {
    if sh.asteroid.is_some() {
        sh.log(LogLevel::Warn, "asteroid already inbound");
        return;
    }
    let alert = build_asteroid_alert(Utc::now(), ASTEROID_SECS);
    sh.asteroid = Some(AsteroidState {
        alert_id: alert.id.clone(),
        impact_at: Instant::now() + Duration::from_secs(ASTEROID_SECS),
        total_secs: ASTEROID_SECS,
    });
    sh.demo_alerts.retain(|a| a.id != alert.id);
    sh.demo_alerts.push(alert);
    sh.bump_alerts();
    sh.log(
        LogLevel::Warn,
        format!("ASTEROID INBOUND. impact in {ASTEROID_SECS}s"),
    );
}

/// Returns the alert that was added, if any, so the caller can announce it.
fn run_demo(sh: &mut Shared, group: Option<String>) -> Option<Alert> {
    match group {
        None => {
            sh.log(LogLevel::Info, "usage: demo <group|event>");
            for g in DEMO_GROUPS {
                sh.log(LogLevel::Info, format!("  {}", g.name));
                for (ev, sev) in g.items {
                    sh.log(LogLevel::Info, format!("    {ev} [{}]", sev.label()));
                }
            }
        }
        Some(s) => match resolve_demo(&s) {
            Some((ev, sev)) => return Some(add_demo_alert(sh, ev, sev)),
            None => sh.log(
                LogLevel::Error,
                format!("demo: unknown group or event {s:?} (try :demo)"),
            ),
        },
    }
    None
}

/// Commands gated to later slices: `(name, slice)`. Every command is
/// implemented now, so this always returns `None`; it stays as the gate for
/// any future stubbed command.
pub fn unavailable(_cmd: &Command) -> Option<(&'static str, u8)> {
    None
}

pub fn default_column(panel: PanelKind) -> Column {
    Layout::default()
        .find(panel)
        .map(|(c, _)| c)
        .unwrap_or(Column::Center)
}

/// `:radio ...`. Config changes are picked up by `App::sync_radio`.
fn run_radio(app: &mut App, sh: &mut Shared, cmd: RadioCmd) {
    match cmd {
        RadioCmd::Toggle => {
            let on = !sh.config.weather_radio_enabled;
            sh.config.weather_radio_enabled = on;
            sh.dirty_config = true;
            sh.log(
                LogLevel::Info,
                if on {
                    "weather radio on"
                } else {
                    "weather radio off"
                },
            );
        }
        RadioCmd::Live(url) => {
            sh.config.weather_radio_enabled = true;
            sh.config.weather_radio_mode = RadioMode::Live;
            match url {
                Some(u) => {
                    sh.config.weather_radio_live_feed_mode = LiveFeedMode::Manual;
                    sh.config.weather_radio_live_stream_url = Some(u);
                }
                None => sh.config.weather_radio_live_feed_mode = LiveFeedMode::Auto,
            }
            sh.dirty_config = true;
            sh.log(LogLevel::Info, "weather radio: live");
        }
        RadioCmd::Simulated => {
            sh.config.weather_radio_enabled = true;
            sh.config.weather_radio_mode = RadioMode::Simulated;
            sh.dirty_config = true;
            sh.log(LogLevel::Info, "weather radio: simulated");
        }
        RadioCmd::Stop => {
            sh.config.weather_radio_enabled = false;
            sh.dirty_config = true;
            sh.log(LogLevel::Info, "weather radio off");
        }
        RadioCmd::Volume(v) => {
            sh.radio.volume = v;
            app.audio.radio_volume(f32::from(v) / 100.0);
        }
        RadioCmd::Retry => {
            app.audio.force_resync();
            sh.log(LogLevel::Info, "radio: retrying");
        }
        RadioCmd::Test => {
            app.audio.test();
            sh.log(LogLevel::Info, "radio: test announcement");
        }
    }
}

// ---------------------------------------------------------------------------
// State mutations shared with the event handlers in app.rs
// ---------------------------------------------------------------------------

/// Kick off a forecast + alerts refresh for one location.
pub fn refresh_one(tasks: &Tasks, sh: &mut Shared, loc: &SavedLocation) {
    sh.pending_results += 2;
    sh.refreshing = true;
    tasks.refresh_location(loc, &sh.config);
}

pub fn select_location(tasks: &Tasks, sh: &mut Shared, idx: usize) {
    let loc = sh.locations.saved_locations[idx].clone();
    sh.locations.active_location_id = Some(loc.id.clone());
    sh.dirty_locations = true;
    sh.bump_alerts();
    if !sh.weather.contains_key(&loc.id) {
        refresh_one(tasks, sh, &loc);
    }
}

/// Select a saved location matching `loc` (same label or within ~500 m) or add
/// it. Returns the saved location id.
pub fn add_or_select(tasks: &Tasks, sh: &mut Shared, loc: Location) -> String {
    let existing = sh.locations.saved_locations.iter().position(|l| {
        l.label.eq_ignore_ascii_case(&loc.label)
            || ((l.lat - loc.lat).abs() < 0.005 && (l.lon - loc.lon).abs() < 0.005)
    });
    if let Some(i) = existing {
        select_location(tasks, sh, i);
        return sh.locations.saved_locations[i].id.clone();
    }
    let saved = SavedLocation {
        id: uuid::Uuid::new_v4().to_string(),
        label: loc.label,
        lat: loc.lat,
        lon: loc.lon,
        accu_weather_location_key: None,
    };
    let id = saved.id.clone();
    sh.log(LogLevel::Info, format!("added location: {}", saved.label));
    sh.locations.saved_locations.push(saved);
    let idx = sh.locations.saved_locations.len() - 1;
    select_location(tasks, sh, idx);
    id
}

fn remove_location(sh: &mut Shared, idx: usize) {
    let removed = sh.locations.saved_locations.remove(idx);
    sh.weather.remove(&removed.id);
    sh.alerts.remove(&removed.id);
    sh.weather_errors.remove(&removed.id);
    if sh.locations.active_location_id.as_deref() == Some(removed.id.as_str()) {
        sh.locations.active_location_id =
            sh.locations.saved_locations.first().map(|l| l.id.clone());
    }
    sh.dirty_locations = true;
    sh.bump_alerts();
    sh.log(
        LogLevel::Info,
        format!("removed location: {}", removed.label),
    );
}

/// Apply a view command (`:zoom`, `:radar recenter`, `:alerts clear`) to one
/// window's pending requests.
pub fn apply_view_cmd(req: &mut PanelRequests, cmd: &Command) {
    match cmd {
        Command::Zoom(z) => req.map_zoom = Some(*z),
        Command::Radar(RadarCmd::Recenter) => req.map_recenter = true,
        Command::Play => req.radar_play = Some(true),
        Command::Pause => req.radar_play = Some(false),
        Command::Frame(n) => req.radar_step = Some(*n),
        Command::Radar(RadarCmd::Live) => req.radar_live = true,
        Command::Alerts(AlertsCmd::Clear) => {
            req.clear_selection = true;
            req.selected_alert_id = None;
        }
        _ => {}
    }
}

/// Radar tuning commands that only touch `config.radar`. Returns whether the
/// command was one of them.
pub fn run_radar_setting(sh: &mut Shared, cmd: &RadarCmd) -> bool {
    let on_off = |b: bool| if b { "on" } else { "off" };
    let msg = match cmd {
        RadarCmd::Scheme(id) => {
            let known = match sh.weather_maps.as_ref() {
                Some(m) => m.color_schemes.iter().any(|s| s.id == *id),
                None => ss_net::librewxr::default_color_schemes()
                    .iter()
                    .any(|s| s.id == *id),
            };
            if !known {
                sh.log(
                    LogLevel::Error,
                    format!("unknown color scheme {id} (see :help radar)"),
                );
                return true;
            }
            sh.config.radar.color_scheme = *id;
            format!("radar scheme {id}")
        }
        RadarCmd::Opacity(p) => {
            let p = (*p).min(100);
            sh.config.radar.opacity = f32::from(p) / 100.0;
            format!("radar opacity {p}%")
        }
        RadarCmd::Nowcast(b) => {
            sh.config.radar.nowcast = *b;
            format!("radar nowcast {}", on_off(*b))
        }
        RadarCmd::Satellite(b) => {
            sh.config.radar.satellite = *b;
            format!("radar satellite {}", on_off(*b))
        }
        RadarCmd::Smooth(b) => {
            sh.config.radar.smooth = *b;
            format!("radar smooth {}", on_off(*b))
        }
        RadarCmd::Snow(b) => {
            sh.config.radar.snow = *b;
            format!("radar snow {}", on_off(*b))
        }
        RadarCmd::Arrows(b) => {
            sh.config.radar.show_arrows = *b;
            format!("radar arrows {}", on_off(*b))
        }
        RadarCmd::Cells(b) => {
            sh.config.radar.show_cells = *b;
            format!("radar cells {}", on_off(*b))
        }
        RadarCmd::Legend(b) => {
            sh.config.radar.legend = *b;
            format!("radar legend {}", on_off(*b))
        }
        RadarCmd::New | RadarCmd::Popout | RadarCmd::Recenter | RadarCmd::Live => return false,
    };
    sh.dirty_config = true;
    sh.log(LogLevel::Info, msg);
    true
}

/// `:layer <name> [on|off]`. Returns true when the SPC products should be
/// fetched now (a layer that needs them was just turned on with no data).
pub fn run_layer(sh: &mut Shared, name: &str, on: Option<bool>) -> bool {
    use ss_core::command::{canonical_layer, LAYER_NAMES};
    let Some(layer) = canonical_layer(name) else {
        sh.log(
            LogLevel::Error,
            format!("unknown layer {name} (layers: {})", LAYER_NAMES.join(", ")),
        );
        return false;
    };
    let key_missing = sh
        .config
        .open_weather_map_api_key
        .as_deref()
        .is_none_or(|k| k.trim().is_empty());
    let want = if layer == "nexrad" {
        let want = on.unwrap_or(sh.config.radar.nexrad_site.is_none());
        if want && sh.config.radar.nexrad_site.is_none() {
            sh.log(LogLevel::Error, "use :site <id> to choose a NEXRAD site");
            return false;
        }
        if !want {
            sh.config.radar.nexrad_site = None;
        }
        want
    } else {
        let cfg = &mut sh.config;
        let slot: &mut bool = match layer {
            "alerts" => &mut cfg.radar.show_polygons,
            "satellite" => &mut cfg.radar.satellite,
            "nowcast" => &mut cfg.radar.nowcast,
            "spc" => &mut cfg.spc_outlook_enabled,
            "md" => &mut cfg.radar.md_polygons,
            "barbs" => &mut cfg.radar.wind_barbs,
            "owm-wind" => &mut cfg.radar.owm_wind,
            "owm-temp" => &mut cfg.radar.owm_temp,
            "owm-precip" => &mut cfg.radar.owm_precip,
            "aqi" => &mut cfg.radar.aqi_badge,
            "sites" => &mut cfg.radar.show_stations,
            "legend" => &mut cfg.radar.legend,
            "arrows" => &mut cfg.radar.show_arrows,
            _ => &mut cfg.radar.show_cells,
        };
        let want = on.unwrap_or(!*slot);
        *slot = want;
        want
    };
    sh.dirty_config = true;
    sh.log(
        LogLevel::Info,
        format!("layer {layer} {}", if want { "on" } else { "off" }),
    );
    if want && key_missing && matches!(layer, "owm-wind" | "owm-temp" | "owm-precip" | "aqi") {
        sh.log(
            LogLevel::Warn,
            "OpenWeatherMap API key not set (Settings > Sources)",
        );
    }
    want && matches!(layer, "spc" | "md") && sh.spc_outlook.is_empty() && sh.mcd_alerts.is_empty()
}

/// `:product <name>`.
pub fn run_product(sh: &mut Shared, p: ss_core::RadarProduct) {
    sh.config.radar.nexrad_product = p;
    sh.dirty_config = true;
    sh.log(LogLevel::Info, format!("radar product: {}", p.label()));
}

/// `:site [id]`.
pub fn run_site(sh: &mut Shared, id: Option<String>) {
    let Some(id) = id else {
        sh.config.radar.nexrad_site = None;
        sh.dirty_config = true;
        sh.log(LogLevel::Info, "radar site cleared (composite)");
        return;
    };
    let id = id.trim().to_ascii_uppercase();
    let station = sh
        .radar_stations
        .iter()
        .find(|s| s.id.eq_ignore_ascii_case(&id))
        .map(|s| s.name.clone());
    if station.is_none() && !sh.radar_stations.is_empty() {
        sh.log(LogLevel::Error, "unknown radar site ID");
        return;
    }
    let line = match station {
        Some(name) => format!("radar site: {id} ({name})"),
        None => format!("radar site: {id}"),
    };
    sh.config.radar.nexrad_site = Some(id);
    sh.dirty_config = true;
    sh.log(LogLevel::Info, line);
}

/// Id of the location the issuing window tracks (`""` when none).
fn loc_id(app: &App, sh: &Shared, target: &WindowTarget) -> String {
    app.windows
        .location_for(target, sh)
        .map(|l| l.id)
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Effects {
    palette: bool,
    refresh_all: bool,
}

pub fn execute(app: &mut App, target: WindowTarget, cmd: Command) {
    let shared = app.shared.clone();
    let mut fx = Effects::default();
    {
        let mut sh = shared.write();
        run(app, &mut sh, &target, cmd, &mut fx);
    }
    if fx.palette {
        app.update_palette(true);
    }
    if fx.refresh_all {
        app.refresh_all();
    }
}

fn run(app: &mut App, sh: &mut Shared, target: &WindowTarget, cmd: Command, fx: &mut Effects) {
    if let Some((name, slice)) = unavailable(&cmd) {
        sh.log(
            LogLevel::Warn,
            format!("{name}: not available yet (slice {slice})"),
        );
        return;
    }
    match cmd {
        Command::Goto { query } | Command::Add { label: Some(query) } => {
            sh.log(LogLevel::Info, format!("searching for {query:?}…"));
            app.tasks.geocode(query);
        }
        Command::Add { label: None } => {
            sh.log(LogLevel::Info, "locating via IP…");
            app.tasks.ip_locate();
        }
        Command::GotoCoords { lat, lon } => {
            let loc = Location::new(lat, lon, format!("{lat:.3}, {lon:.3}"));
            let id = add_or_select(&app.tasks, sh, loc);
            app.location_changed();
            app.tasks.reverse_geocode(id, lat, lon);
            fx.palette = true;
        }
        Command::Remove { target } => match match_target(&sh.locations.saved_locations, &target) {
            Some(i) => {
                remove_location(sh, i);
                fx.palette = true;
            }
            None => sh.log(
                LogLevel::Error,
                format!("no saved location matches {target:?}"),
            ),
        },
        Command::Select { target: t } => match match_target(&sh.locations.saved_locations, &t) {
            Some(i) => {
                let loc = sh.locations.saved_locations[i].clone();
                let radar_child = target.child_id().filter(|id| app.windows.is_radar(id));
                if let Some(id) = radar_child {
                    // A radar instance tracks its own location.
                    if let Some(w) = app.windows.get_mut(id) {
                        w.location_id = Some(loc.id.clone());
                        w.req.map_recenter = true;
                        w.req.selected_alert_id = None;
                    }
                    if !sh.weather.contains_key(&loc.id) {
                        refresh_one(&app.tasks, sh, &loc);
                    }
                    let short: String = id.chars().take(8).collect();
                    sh.log(
                        LogLevel::Info,
                        format!("radar {short}: tracking {}", loc.label),
                    );
                } else {
                    select_location(&app.tasks, sh, i);
                    app.location_changed();
                    fx.palette = true;
                }
            }
            None => sh.log(LogLevel::Error, format!("no saved location matches {t:?}")),
        },
        Command::Refresh => {
            sh.log(LogLevel::Info, "refreshing…");
            fx.refresh_all = true;
        }
        Command::Units(u) => {
            let next = u.unwrap_or(match sh.config.units {
                UnitPref::F => UnitPref::C,
                UnitPref::C => UnitPref::F,
            });
            sh.config.units = next;
            sh.dirty_config = true;
            sh.log(LogLevel::Info, format!("units: {next:?}"));
        }
        Command::Time(t) => {
            let next = t.unwrap_or(match sh.config.time_format {
                TimeFormat::H12 => TimeFormat::H24,
                TimeFormat::H24 => TimeFormat::H12,
            });
            sh.config.time_format = next;
            sh.dirty_config = true;
            sh.log(LogLevel::Info, format!("time format: {next:?}"));
        }
        Command::Theme(None) => {
            sh.log(
                LogLevel::Info,
                format!(
                    "current theme: {} ({:?})",
                    sh.config.theme_id, sh.config.theme
                ),
            );
            sh.log(
                LogLevel::Info,
                "  light | dark | system   (with theme default)",
            );
            sh.log(LogLevel::Info, "  default   condition-tinted accent");
            for t in builtin_themes() {
                sh.log(LogLevel::Info, format!("  {:<12} {}", t.id, t.name));
            }
            sh.log(LogLevel::Info, "  custom    your pasted theme (settings)");
        }
        Command::Theme(Some(id)) => {
            let lower = id.trim().to_ascii_lowercase();
            let ok = match lower.as_str() {
                "light" | "dark" | "system" => {
                    sh.config.theme = match lower.as_str() {
                        "light" => ThemePref::Light,
                        "dark" => ThemePref::Dark,
                        _ => ThemePref::System,
                    };
                    sh.config.theme_id = "default".to_string();
                    true
                }
                "default" => {
                    sh.config.theme_id = "default".to_string();
                    true
                }
                "custom" if sh.config.custom_theme.is_some() => {
                    sh.config.theme_id = "custom".to_string();
                    true
                }
                "custom" => {
                    sh.log(LogLevel::Error, "no custom theme saved");
                    false
                }
                other if builtin_themes().iter().any(|t| t.id == other) => {
                    sh.config.theme_id = other.to_string();
                    true
                }
                _ => {
                    sh.log(LogLevel::Error, format!("unknown theme: {id} (try :theme)"));
                    false
                }
            };
            if ok {
                sh.dirty_config = true;
                fx.palette = true;
                sh.log(LogLevel::Info, format!("theme: {}", sh.config.theme_id));
            }
        }
        Command::Move { panel, col, index } => {
            app.redock_if_popped(sh, panel);
            sh.layout.place(panel, col, index);
            sh.dirty_session = true;
        }
        Command::Swap(a, b) => {
            if sh.layout.is_docked(a) && sh.layout.is_docked(b) {
                sh.layout.swap(a, b);
                sh.dirty_session = true;
            } else {
                sh.log(LogLevel::Error, "swap: both panels must be visible");
            }
        }
        Command::Hide(p) => {
            sh.layout.hide(p);
            sh.dirty_session = true;
        }
        Command::Show(p) => {
            app.redock_if_popped(sh, p);
            sh.layout.place(p, default_column(p), None);
            sh.dirty_session = true;
        }
        Command::ResetLayout => {
            sh.layout = Layout::default();
            app.hide_popped_out(sh);
            sh.dirty_session = true;
            sh.log(LogLevel::Info, "layout reset");
        }
        Command::Alerts(AlertsCmd::List) => {
            let lid = loc_id(app, sh, target);
            let lines: Vec<String> = sh
                .filtered_alerts_for(&lid)
                .iter()
                .enumerate()
                .map(|(i, a)| {
                    format!(
                        "{:>2}. [{}] {} - {}",
                        i + 1,
                        a.severity.label(),
                        a.display_event,
                        a.area_desc.as_deref().unwrap_or("")
                    )
                })
                .collect();
            if lines.is_empty() {
                sh.log(LogLevel::Info, "no active alerts");
            }
            for l in lines {
                sh.log(LogLevel::Info, l);
            }
        }
        Command::Alerts(AlertsCmd::Show(i)) => {
            let lid = loc_id(app, sh, target);
            let found = sh.filtered_alerts_for(&lid).get(i).map(|a| {
                (
                    a.id.clone(),
                    a.headline
                        .clone()
                        .unwrap_or_else(|| a.display_event.clone()),
                    a.description.clone(),
                )
            });
            match found {
                Some((id, head, desc)) => {
                    if let Some(r) = req_mut(&mut app.req, &mut app.windows, target) {
                        r.selected_alert_id = Some(id);
                    }
                    sh.log(LogLevel::Info, head);
                    for line in desc
                        .unwrap_or_default()
                        .lines()
                        .filter(|l| !l.trim().is_empty())
                    {
                        sh.log(LogLevel::Info, format!("  {}", line.trim()));
                    }
                }
                None => sh.log(LogLevel::Error, format!("alerts: no alert #{}", i + 1)),
            }
        }
        Command::Alerts(AlertsCmd::Clear) => {
            sh.area_alerts.clear();
            sh.viewport_alerts.clear();
            sh.viewport_alerts_bbox = None;
            sh.selection_bbox = None;
            if let Some(r) = req_mut(&mut app.req, &mut app.windows, target) {
                apply_view_cmd(r, &Command::Alerts(AlertsCmd::Clear));
            }
            sh.bump_alerts();
            sh.log(LogLevel::Info, "area alerts cleared");
        }
        Command::Alerts(AlertsCmd::Filter(f)) => {
            sh.alert_filter = f.unwrap_or_default();
            sh.log(
                LogLevel::Info,
                if sh.alert_filter.is_empty() {
                    "alert filter cleared".to_string()
                } else {
                    format!("alert filter: {}", sh.alert_filter)
                },
            );
        }
        Command::Speak(Some(text)) => {
            app.audio.speak_now(text);
            sh.log(LogLevel::Info, "speaking");
        }
        Command::Speak(None) => {
            let id = sh.locations.active_location_id.clone().unwrap_or_default();
            let top = sh
                .all_alerts_for(&id)
                .into_iter()
                .min_by_key(|a| a.severity)
                .map(|a| {
                    alert_announcement(
                        &a.display_event,
                        a.headline.as_deref(),
                        a.area_desc.as_deref(),
                        a.description.as_deref(),
                        600,
                    )
                });
            match top {
                Some(text) => {
                    let tone = sh.config.tts_attention_tone;
                    app.audio.announce(text, tone);
                    sh.log(LogLevel::Info, "reading the top alert");
                }
                None => sh.log(LogLevel::Info, "no active alerts to read"),
            }
        }
        Command::Mute => {
            app.audio.mute();
            sh.log(LogLevel::Info, "speech stopped");
        }
        Command::Radio(r) => run_radio(app, sh, r),
        Command::Set { key, value } => match parse_set(&key, &value) {
            Ok(op) => {
                if let SetOp::LibrewxrHost(h) = &op {
                    app.tasks.set_libre_host(h);
                }
                let overrides_changed = matches!(op, SetOp::StormPolygons(_));
                apply_set(&mut sh.config, op);
                sh.dirty_config = true;
                if overrides_changed {
                    sh.bump_alerts();
                }
                sh.log(LogLevel::Info, format!("set {key} = {value}"));
            }
            Err(e) => sh.log(LogLevel::Error, e),
        },
        Command::Demo { group } => {
            // Demo alerts never pass through `AlertsLoaded`, so announce them here.
            if let Some(a) = run_demo(sh, group) {
                if let Some(tone) = should_announce(&sh.config, &a, true) {
                    app.audio.announce(
                        alert_announcement(
                            &a.display_event,
                            a.headline.as_deref(),
                            a.area_desc.as_deref(),
                            a.description.as_deref(),
                            600,
                        ),
                        tone,
                    );
                }
            }
        }
        Command::Asteroid => start_asteroid(sh),
        Command::Help(topic) => {
            for l in ss_core::command::help_lines(topic.as_deref()) {
                sh.log(LogLevel::Info, l);
            }
            sh.log(
                LogLevel::Info,
                "  log            Expand or collapse this terminal",
            );
            sh.log(LogLevel::Info, "  clear          Clear the terminal");
        }
        Command::Quit => app.ctx.send_viewport_cmd(egui::ViewportCommand::Close),
        Command::Zoom(_)
        | Command::Radar(RadarCmd::Recenter | RadarCmd::Live)
        | Command::Play
        | Command::Pause
        | Command::Frame(_) => {
            if let Some(r) = req_mut(&mut app.req, &mut app.windows, target) {
                apply_view_cmd(r, &cmd);
            }
        }
        Command::Popout(kind) => app.popout_panel(sh, kind),
        Command::Radar(RadarCmd::Popout) => app.popout_panel(sh, PanelKind::Radar),
        Command::Radar(RadarCmd::New) | Command::Open(WindowRole::Radar) => app.open_radar(sh),
        Command::Radar(r) => {
            run_radar_setting(sh, &r);
        }
        Command::Layer { name, on } => {
            if run_layer(sh, &name, on) {
                app.tasks.spc_products();
            }
        }
        Command::Product(p) => run_product(sh, p),
        Command::Site(id) => run_site(sh, id),
        Command::Open(role) => app.open_window(sh, target, role),
        Command::Close => match target {
            WindowTarget::Main => sh.log(LogLevel::Info, "use :quit to exit"),
            WindowTarget::Child(id) => app.close_window(sh, id),
        },
        Command::Fullscreen => {
            // Toggle the window the command was typed in.
            let vid = match target {
                WindowTarget::Main => egui::ViewportId::ROOT,
                WindowTarget::Child(id) => match app.windows.get(id) {
                    Some(w) => w.viewport_id(),
                    None => egui::ViewportId::ROOT,
                },
            };
            let fs = app
                .ctx
                .input_for(vid, |i| i.viewport().fullscreen.unwrap_or(false));
            app.ctx
                .send_viewport_cmd_to(vid, egui::ViewportCommand::Fullscreen(!fs));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn locs() -> Vec<SavedLocation> {
        ["Phoenix, AZ", "Tucson, AZ", "Seattle, WA"]
            .iter()
            .enumerate()
            .map(|(i, l)| SavedLocation {
                id: format!("abcd{i}-1111-2222"),
                label: (*l).to_string(),
                lat: 0.0,
                lon: 0.0,
                accu_weather_location_key: None,
            })
            .collect()
    }

    #[test]
    fn target_by_exact_id_number_prefix_and_label() {
        let l = locs();
        assert_eq!(match_target(&l, "abcd1-1111-2222"), Some(1));
        assert_eq!(match_target(&l, "3"), Some(2));
        assert_eq!(match_target(&l, "abcd2"), Some(2));
        assert_eq!(match_target(&l, "tucson"), Some(1));
        assert_eq!(match_target(&l, "SEA"), Some(2));
        assert_eq!(
            match_target(&l, "AZ"),
            Some(0),
            "first substring match wins"
        );
    }

    #[test]
    fn target_rejects_out_of_range_and_unknown() {
        let l = locs();
        assert_eq!(match_target(&l, "0"), None);
        assert_eq!(match_target(&l, "9"), None);
        assert_eq!(match_target(&l, "nowhere"), None);
        assert_eq!(match_target(&l, "  "), None);
        assert_eq!(match_target(&[], "1"), None);
    }

    #[test]
    fn set_parses_bools_and_numbers() {
        assert_eq!(parse_set("topGlow", "off"), Ok(SetOp::TopGlow(false)));
        assert_eq!(parse_set("top-glow", "YES"), Ok(SetOp::TopGlow(true)));
        assert_eq!(
            parse_set("autoRefreshMinutes", "15"),
            Ok(SetOp::AutoRefreshMinutes(15))
        );
        assert!(parse_set("autoRefreshMinutes", "-1").is_err());
        assert!(parse_set("autoRefreshMinutes", "5000").is_err());
        assert_eq!(parse_set("ttsRate", "1.25"), Ok(SetOp::TtsRate(1.25)));
        assert!(parse_set("ttsRate", "9").is_err());
        assert!(parse_set("notifications", "maybe").is_err());
    }

    #[test]
    fn set_parses_hosts_filters_and_unknown_keys() {
        assert_eq!(
            parse_set("librewxrHost", "https://x.test/"),
            Ok(SetOp::LibrewxrHost("https://x.test".into()))
        );
        assert!(parse_set("librewxrHost", "x.test").is_err());
        assert_eq!(
            parse_set("ttsFilter", "extreme"),
            Ok(SetOp::TtsFilter(TtsSeverityFilter::ExtremeOnly))
        );
        assert!(parse_set("ttsFilter", "loud").is_err());
        assert!(parse_set("bogus", "1")
            .unwrap_err()
            .contains("unknown setting"));
    }

    #[test]
    fn apply_set_mutates_config() {
        let mut c = Config::default();
        apply_set(&mut c, SetOp::StormPolygons(false));
        apply_set(&mut c, SetOp::AutoRefreshMinutes(30));
        apply_set(&mut c, SetOp::TtsFilter(TtsSeverityFilter::All));
        assert!(!c.storm_polygons_enabled);
        assert_eq!(c.auto_refresh_minutes, 30);
        assert_eq!(c.tts_severity_filter, TtsSeverityFilter::All);
    }

    #[test]
    fn later_slice_commands_are_flagged() {
        assert_eq!(unavailable(&Command::Mute), None);
        assert_eq!(unavailable(&Command::Radio(RadioCmd::Toggle)), None);
        assert_eq!(unavailable(&Command::Speak(None)), None);
        assert_eq!(unavailable(&Command::Demo { group: None }), None);
        assert_eq!(unavailable(&Command::Asteroid), None);
        assert_eq!(unavailable(&Command::Close), None);
        assert_eq!(unavailable(&Command::Popout(PanelKind::Radar)), None);
        assert_eq!(unavailable(&Command::Play), None);
        assert_eq!(unavailable(&Command::Pause), None);
        assert_eq!(unavailable(&Command::Frame(1)), None);
        assert_eq!(unavailable(&Command::Site(None)), None);
        assert_eq!(
            unavailable(&Command::Product(ss_core::RadarProduct::SrBvel)),
            None
        );
        assert_eq!(
            unavailable(&Command::Layer {
                name: "alerts".into(),
                on: None
            }),
            None
        );
        assert_eq!(unavailable(&Command::Radar(RadarCmd::Popout)), None);
        assert_eq!(unavailable(&Command::Radar(RadarCmd::New)), None);
        assert_eq!(unavailable(&Command::Radar(RadarCmd::Scheme(4))), None);
        assert_eq!(unavailable(&Command::Radar(RadarCmd::Recenter)), None);
        assert_eq!(unavailable(&Command::Refresh), None);
    }

    fn shared() -> Shared {
        Shared::new(
            Config::default(),
            ss_core::LocationsFile::default(),
            ss_core::SessionFile::default(),
        )
    }

    #[test]
    fn resolve_demo_matches_event_group_and_case() {
        assert_eq!(
            resolve_demo("Tornado Watch"),
            Some(("Tornado Watch", Severity::Severe))
        );
        assert_eq!(
            resolve_demo("  tornado watch "),
            Some(("Tornado Watch", Severity::Severe))
        );
        assert_eq!(
            resolve_demo("tornado"),
            Some(("Tornado Warning", Severity::Extreme)),
            "group name picks its first item"
        );
        assert_eq!(resolve_demo("nope"), None);
        assert_eq!(resolve_demo(""), None);
    }

    #[test]
    fn demo_command_adds_alert_and_bumps_rev() {
        let mut sh = shared();
        let rev = sh.alerts_rev;
        run_demo(&mut sh, Some("tornado watch".into()));
        assert_eq!(sh.demo_alerts.len(), 1);
        assert_ne!(sh.alerts_rev, rev);
        let rev = sh.alerts_rev;
        run_demo(&mut sh, Some("bogus".into()));
        assert_eq!(sh.demo_alerts.len(), 1);
        assert_eq!(sh.alerts_rev, rev);
        run_demo(&mut sh, None);
        assert_eq!(sh.demo_alerts.len(), 1);
    }

    #[test]
    fn asteroid_twice_creates_one_countdown() {
        let mut sh = shared();
        start_asteroid(&mut sh);
        let first = sh.asteroid.clone().unwrap();
        start_asteroid(&mut sh);
        assert_eq!(sh.asteroid, Some(first));
        assert_eq!(sh.demo_alerts.len(), 1);
        assert_eq!(sh.demo_alerts[0].class, "alert-asteroid");
    }

    #[test]
    fn default_column_follows_default_layout() {
        assert_eq!(default_column(PanelKind::Locations), Column::Left);
        assert_eq!(default_column(PanelKind::Hourly), Column::Right);
        assert_eq!(default_column(PanelKind::Radio), Column::Center);
    }

    #[test]
    fn view_commands_apply_to_the_given_requests_only() {
        let mut child = PanelRequests::default();
        let main = PanelRequests::default();
        apply_view_cmd(&mut child, &Command::Zoom(9.0));
        apply_view_cmd(&mut child, &Command::Radar(RadarCmd::Recenter));
        assert_eq!(child.map_zoom, Some(9.0));
        assert!(child.map_recenter);
        assert_eq!(main, PanelRequests::default());
    }

    #[test]
    fn alerts_clear_resets_selection_request() {
        let mut r = PanelRequests {
            selected_alert_id: Some("x".into()),
            ..PanelRequests::default()
        };
        apply_view_cmd(&mut r, &Command::Alerts(AlertsCmd::Clear));
        assert!(r.clear_selection);
        assert_eq!(r.selected_alert_id, None);
        // Unrelated commands are ignored.
        let before = r.clone();
        apply_view_cmd(&mut r, &Command::Refresh);
        assert_eq!(r, before);
    }

    fn last_log(sh: &Shared) -> (LogLevel, String) {
        let l = sh.log.back().expect("a log line");
        (l.level, l.text.clone())
    }

    fn station(id: &str, name: &str) -> ss_core::RadarStation {
        ss_core::RadarStation {
            id: id.into(),
            name: name.into(),
            lat: 0.0,
            lon: 0.0,
            elevation_m: None,
            vcp: None,
            operability_status: None,
            alarm_summary: None,
            last_received_time: None,
        }
    }

    #[test]
    fn playback_commands_set_panel_requests() {
        let mut r = PanelRequests::default();
        apply_view_cmd(&mut r, &Command::Play);
        assert_eq!(r.radar_play, Some(true));
        apply_view_cmd(&mut r, &Command::Pause);
        assert_eq!(r.radar_play, Some(false));
        apply_view_cmd(&mut r, &Command::Frame(-3));
        assert_eq!(r.radar_step, Some(-3));
        assert!(!r.radar_live);
        apply_view_cmd(&mut r, &Command::Radar(RadarCmd::Live));
        assert!(r.radar_live);
    }

    #[test]
    fn radar_scheme_is_validated_and_opacity_clamped() {
        let mut sh = shared();
        // No weather map index yet: the built-in scheme list is used.
        assert!(run_radar_setting(&mut sh, &RadarCmd::Scheme(4)));
        assert_eq!(sh.config.radar.color_scheme, 4);
        assert!(sh.dirty_config);
        sh.dirty_config = false;
        assert!(run_radar_setting(&mut sh, &RadarCmd::Scheme(250)));
        assert_eq!(sh.config.radar.color_scheme, 4);
        assert!(!sh.dirty_config);
        assert_eq!(last_log(&sh).0, LogLevel::Error);

        sh.weather_maps = Some(ss_core::WeatherMaps {
            color_schemes: vec![ss_core::ColorScheme {
                id: 9,
                name: "x".into(),
            }],
            ..Default::default()
        });
        run_radar_setting(&mut sh, &RadarCmd::Scheme(4));
        assert_eq!(
            sh.config.radar.color_scheme, 4,
            "4 is not in the loaded index"
        );
        run_radar_setting(&mut sh, &RadarCmd::Scheme(9));
        assert_eq!(sh.config.radar.color_scheme, 9);

        run_radar_setting(&mut sh, &RadarCmd::Opacity(60));
        assert!((sh.config.radar.opacity - 0.6).abs() < 1e-6);
        run_radar_setting(&mut sh, &RadarCmd::Opacity(200));
        assert!((sh.config.radar.opacity - 1.0).abs() < 1e-6);
        run_radar_setting(&mut sh, &RadarCmd::Smooth(false));
        assert!(!sh.config.radar.smooth);
        assert!(!run_radar_setting(&mut sh, &RadarCmd::Live));
    }

    #[test]
    fn layer_toggle_sets_and_flags() {
        let mut sh = shared();
        assert!(sh.config.radar.show_polygons);
        run_layer(&mut sh, "alerts", None);
        assert!(!sh.config.radar.show_polygons);
        assert!(sh.dirty_config);
        run_layer(&mut sh, "polygons", Some(true));
        assert!(sh.config.radar.show_polygons);
        run_layer(&mut sh, "stations", Some(false));
        assert!(!sh.config.radar.show_stations);
    }

    #[test]
    fn unknown_layer_logs_error_and_changes_nothing() {
        let mut sh = shared();
        let before = sh.config.clone();
        assert!(!run_layer(&mut sh, "bogus", None));
        assert_eq!(sh.config, before);
        assert!(!sh.dirty_config);
        let (lvl, text) = last_log(&sh);
        assert_eq!(lvl, LogLevel::Error);
        assert!(text.contains("unknown layer bogus") && text.contains("owm-wind"));
    }

    #[test]
    fn spc_layer_requests_fetch_only_without_data() {
        let mut sh = shared();
        sh.config.spc_outlook_enabled = false;
        assert!(run_layer(&mut sh, "spc", Some(true)));
        assert!(sh.config.spc_outlook_enabled);
        assert!(!run_layer(&mut sh, "spc", Some(false)));
    }

    #[test]
    fn owm_layer_warns_without_key() {
        let mut sh = shared();
        run_layer(&mut sh, "aqi", Some(true));
        assert!(sh.config.radar.aqi_badge, "flag is set regardless");
        assert_eq!(last_log(&sh).0, LogLevel::Warn);
        sh.config.open_weather_map_api_key = Some("k".into());
        run_layer(&mut sh, "aqi", Some(false));
        assert_eq!(last_log(&sh).0, LogLevel::Info);
    }

    #[test]
    fn nexrad_layer_needs_a_site() {
        let mut sh = shared();
        run_layer(&mut sh, "nexrad", Some(true));
        assert_eq!(last_log(&sh).0, LogLevel::Error);
        run_layer(&mut sh, "nexrad", None);
        assert_eq!(last_log(&sh).0, LogLevel::Error);
        assert!(!sh.dirty_config);
        sh.config.radar.nexrad_site = Some("KFSX".into());
        run_layer(&mut sh, "nexrad", Some(false));
        assert_eq!(sh.config.radar.nexrad_site, None);
        assert!(sh.dirty_config);
    }

    #[test]
    fn site_validation_against_loaded_stations() {
        let mut sh = shared();
        // Station list not loaded yet: accept and uppercase.
        run_site(&mut sh, Some("kfsx".into()));
        assert_eq!(sh.config.radar.nexrad_site.as_deref(), Some("KFSX"));
        run_site(&mut sh, None);
        assert_eq!(sh.config.radar.nexrad_site, None);

        sh.radar_stations = vec![station("KFSX", "Flagstaff")];
        sh.dirty_config = false;
        run_site(&mut sh, Some("kzzz".into()));
        assert_eq!(sh.config.radar.nexrad_site, None);
        assert!(!sh.dirty_config);
        assert_eq!(last_log(&sh).0, LogLevel::Error);
        run_site(&mut sh, Some("kfsx".into()));
        assert_eq!(sh.config.radar.nexrad_site.as_deref(), Some("KFSX"));
        assert!(last_log(&sh).1.contains("Flagstaff"));
    }

    #[test]
    fn product_command_sets_product() {
        let mut sh = shared();
        run_product(&mut sh, ss_core::RadarProduct::SrBvel);
        assert_eq!(
            sh.config.radar.nexrad_product,
            ss_core::RadarProduct::SrBvel
        );
        assert!(sh.dirty_config);
    }

    #[test]
    fn set_radar_keys() {
        assert_eq!(parse_set("radarOpacity", "40"), Ok(SetOp::RadarOpacity(40)));
        assert!(parse_set("radarOpacity", "101").is_err());
        assert_eq!(parse_set("radar-scheme", "3"), Ok(SetOp::RadarScheme(3)));
        assert!(parse_set("radarScheme", "x").is_err());
        let mut c = Config::default();
        apply_set(&mut c, SetOp::RadarOpacity(50));
        apply_set(&mut c, SetOp::RadarScheme(2));
        assert!((c.radar.opacity - 0.5).abs() < 1e-6);
        assert_eq!(c.radar.color_scheme, 2);
    }
}
