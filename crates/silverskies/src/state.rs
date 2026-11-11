//! The single shared application state. Background tasks never touch this
//! directly: they post `AppEvent`s that the UI thread applies.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use chrono::{DateTime, Local};
use ss_core::alerts::colors::effective_visible;
use ss_core::theme::{dark_base, Palette};
use ss_core::{
    AirQuality, Alert, BBox, Config, Layout, LocationsFile, MetarObservation, MetarStation,
    NwrFeed, RadarStation, SavedLocation, SessionFile, SpcOutlookFeature, Weather, WeatherMaps,
};

pub const LOG_CAP: usize = 500;

/// A running asteroid-impact countdown (dev easter egg).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AsteroidState {
    pub alert_id: String,
    pub impact_at: Instant,
    pub total_secs: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AsteroidPhase {
    /// Whole seconds left (rounded up), more than 5.
    Countdown(u64),
    /// Final 5 seconds: heavier shaking.
    Violent(u64),
    Impact,
}

/// Seconds at or below which the countdown turns violent.
pub const ASTEROID_VIOLENT_SECS: u64 = 5;
/// How long the red detonation flash lasts.
pub const FLASH_DURATION: Duration = Duration::from_millis(1400);

pub fn asteroid_phase(now: Instant, st: &AsteroidState) -> AsteroidPhase {
    let rem = st.impact_at.saturating_duration_since(now);
    if rem.is_zero() {
        return AsteroidPhase::Impact;
    }
    let n = rem.as_millis().div_ceil(1000) as u64;
    if n <= ASTEROID_VIOLENT_SECS {
        AsteroidPhase::Violent(n)
    } else {
        AsteroidPhase::Countdown(n)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    Info,
    Warn,
    Error,
    Cmd,
}

#[derive(Debug, Clone)]
pub struct LogLine {
    pub time: DateTime<Local>,
    pub level: LogLevel,
    pub text: String,
}

/// Which window a command was issued from (or a panel is drawn in).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WindowTarget {
    Main,
    /// A child window, by instance id.
    Child(String),
}

impl WindowTarget {
    pub fn child_id(&self) -> Option<&str> {
        match self {
            WindowTarget::Main => None,
            WindowTarget::Child(id) => Some(id),
        }
    }
}

/// Requests addressed to the panels of one window. The main window owns one
/// and every child window owns its own, so e.g. `:zoom` only moves the map of
/// the window it was typed in.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct PanelRequests {
    /// The audit log / alert window sets this; the radar panel consumes it and
    /// fits the map.
    pub pending_focus: Option<BBox>,
    pub selected_alert_id: Option<String>,
    /// `:radar recenter` request (consumed by the radar panel).
    pub map_recenter: bool,
    /// `:zoom <level>` request (consumed by the radar panel).
    pub map_zoom: Option<f32>,
    /// `:alerts clear` also drops the radar selection rectangle.
    pub clear_selection: bool,
    pub focus_location_search: bool,
    /// `:play` / `:pause` -> Some(true/false); consumed by the radar panel.
    pub radar_play: Option<bool>,
    /// `:frame <+-n>` relative step; consumed by the radar panel.
    pub radar_step: Option<i32>,
    /// `:radar live` -> jump to the newest observed frame.
    pub radar_live: bool,
}

/// A METAR station with its latest observation (wind barbs layer).
#[derive(Debug, Clone, PartialEq)]
pub struct WindObs {
    pub station: MetarStation,
    pub obs: MetarObservation,
}

/// Weather radio connection state shown in the radio panel.
#[derive(Debug, Clone, PartialEq)]
pub enum RadioStatus {
    Off,
    NoFeed(String),
    Connecting {
        label: String,
    },
    Playing {
        label: String,
        url: String,
        since: Instant,
    },
    Failed {
        label: String,
        error: String,
    },
    Ended {
        label: String,
    },
}

/// Everything the radio panel shows.
#[derive(Debug, Clone)]
pub struct RadioView {
    pub status: RadioStatus,
    pub candidates: Vec<NwrFeed>,
    /// 0..=100.
    pub volume: u8,
    /// Last decoded SAME header: (event name, summary, when).
    pub last_same: Option<(String, String, Instant)>,
    pub speaking: Option<String>,
    pub queued: usize,
}

impl Default for RadioView {
    fn default() -> Self {
        RadioView {
            status: RadioStatus::Off,
            candidates: Vec::new(),
            volume: 80,
            last_same: None,
            speaking: None,
            queued: 0,
        }
    }
}

pub struct Shared {
    pub config: Config,
    pub locations: LocationsFile,
    /// Keyed by saved-location id.
    pub weather: HashMap<String, Weather>,
    pub weather_errors: HashMap<String, String>,
    pub alerts: HashMap<String, Vec<Alert>>,
    /// Alerts for the radar bbox selection / audit log (slice 5 fills more).
    pub area_alerts: Vec<Alert>,
    /// Alerts auto-loaded for the radar viewport, and the bbox they cover.
    pub viewport_alerts: Vec<Alert>,
    pub viewport_alerts_bbox: Option<BBox>,
    /// Locally generated demo alerts (location independent, never persisted).
    pub demo_alerts: Vec<Alert>,
    pub asteroid: Option<AsteroidState>,
    /// Detonation flash end time.
    pub flash_until: Option<Instant>,
    /// Data directory, for the About tab.
    pub data_dir: Option<PathBuf>,
    pub radar_stations: Vec<RadarStation>,
    pub weather_maps: Option<WeatherMaps>,
    pub spc_outlook: Vec<SpcOutlookFeature>,
    /// SPC mesoscale discussions (as alerts with geometry), CONUS-wide.
    pub mcd_alerts: Vec<Alert>,
    /// Latest METAR wind observations for the last requested viewport.
    pub wind_obs: Vec<WindObs>,
    /// Keyed by saved-location id.
    pub air_quality: HashMap<String, AirQuality>,
    pub last_refresh: Option<Instant>,
    pub refreshing: bool,
    /// Outstanding network results (2 per location refresh).
    pub pending_results: usize,
    pub palette: Palette,
    pub log: VecDeque<LogLine>,
    pub layout: Layout,
    pub session: SessionFile,
    pub radio: RadioView,

    // --- cross-panel selections (per-window requests are `PanelRequests`) ---
    pub selection_bbox: Option<BBox>,
    pub alert_filter: String,
    /// Bumped whenever the alert set changes so the radar rebuilds its layer.
    pub alerts_rev: u64,

    // --- persistence flags ---
    /// Config changed in a way that needs the palette recomputed.
    pub palette_dirty: bool,
    pub dirty_config: bool,
    pub dirty_locations: bool,
    pub dirty_session: bool,
}

impl Shared {
    pub fn new(config: Config, locations: LocationsFile, session: SessionFile) -> Shared {
        let layout = session.layout.clone();
        Shared {
            config,
            locations,
            weather: HashMap::new(),
            weather_errors: HashMap::new(),
            alerts: HashMap::new(),
            area_alerts: Vec::new(),
            viewport_alerts: Vec::new(),
            viewport_alerts_bbox: None,
            demo_alerts: Vec::new(),
            asteroid: None,
            flash_until: None,
            data_dir: None,
            radar_stations: Vec::new(),
            weather_maps: None,
            spc_outlook: Vec::new(),
            mcd_alerts: Vec::new(),
            wind_obs: Vec::new(),
            air_quality: HashMap::new(),
            last_refresh: None,
            refreshing: false,
            pending_results: 0,
            palette: dark_base(),
            log: VecDeque::new(),
            layout,
            session,
            radio: RadioView::default(),
            selection_bbox: None,
            alert_filter: String::new(),
            alerts_rev: 0,
            palette_dirty: false,
            dirty_config: false,
            dirty_locations: false,
            dirty_session: false,
        }
    }

    pub fn location_by_id(&self, id: &str) -> Option<&SavedLocation> {
        self.locations.saved_locations.iter().find(|l| l.id == id)
    }

    pub fn active_location(&self) -> Option<&SavedLocation> {
        let id = self.locations.active_location_id.as_deref()?;
        self.location_by_id(id)
    }

    pub fn weather_for(&self, id: &str) -> Option<&Weather> {
        self.weather.get(id)
    }

    pub fn active_weather(&self) -> Option<&Weather> {
        self.weather_for(&self.active_location()?.id)
    }

    /// Forecast alerts for one saved location (empty when unknown).
    pub fn alerts_for(&self, id: &str) -> &[Alert] {
        self.alerts.get(id).map(Vec::as_slice).unwrap_or(&[])
    }

    /// A location's alerts plus area alerts (deduped by id), with hidden
    /// classes removed.
    pub fn all_alerts_for(&self, id: &str) -> Vec<&Alert> {
        let mut out: Vec<&Alert> = Vec::new();
        for a in self
            .alerts_for(id)
            .iter()
            .chain(self.area_alerts.iter())
            .chain(self.viewport_alerts.iter())
            .chain(self.demo_alerts.iter())
        {
            if !effective_visible(&a.class, &self.config.alert_type_overrides) {
                continue;
            }
            if out.iter().any(|b| b.id == a.id) {
                continue;
            }
            out.push(a);
        }
        out
    }

    /// `all_alerts_for` narrowed by the audit-log text filter.
    pub fn filtered_alerts_for(&self, id: &str) -> Vec<&Alert> {
        let mut v = self.all_alerts_for(id);
        if !self.alert_filter.trim().is_empty() {
            v.retain(|a| alert_matches(a, &self.alert_filter));
        }
        v
    }

    /// Look an alert up by id across every location and the area alerts.
    pub fn find_alert(&self, id: &str) -> Option<&Alert> {
        self.alerts
            .values()
            .flatten()
            .chain(self.area_alerts.iter())
            .chain(self.viewport_alerts.iter())
            .chain(self.demo_alerts.iter())
            .find(|a| a.id == id)
    }

    pub fn log(&mut self, level: LogLevel, text: impl Into<String>) {
        let text = text.into();
        match level {
            LogLevel::Error => tracing::error!("{text}"),
            LogLevel::Warn => tracing::warn!("{text}"),
            _ => tracing::info!("{text}"),
        }
        self.log.push_back(LogLine {
            time: Local::now(),
            level,
            text,
        });
        while self.log.len() > LOG_CAP {
            self.log.pop_front();
        }
    }
}

pub fn alert_matches(a: &Alert, filter: &str) -> bool {
    let f = filter.trim().to_lowercase();
    if f.is_empty() {
        return true;
    }
    [
        Some(a.display_event.as_str()),
        Some(a.event.as_str()),
        a.area_desc.as_deref(),
        a.headline.as_deref(),
        Some(a.severity.label()),
    ]
    .into_iter()
    .flatten()
    .any(|s| s.to_lowercase().contains(&f))
}

impl Shared {
    /// Tell the radar panel the alert set (or its visibility rules) changed.
    pub fn bump_alerts(&mut self) {
        self.alerts_rev = self.alerts_rev.wrapping_add(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ss_core::{AlertSource, Severity};

    fn alert(id: &str, event: &str) -> Alert {
        Alert {
            id: id.to_string(),
            source: AlertSource::Nws,
            event: event.to_string(),
            display_event: event.to_string(),
            class: "other".to_string(),
            headline: None,
            description: None,
            instruction: None,
            severity: Severity::Minor,
            area_desc: None,
            onset: None,
            sent: None,
            expires: None,
            issuing_office: None,
            url: None,
            geometry: None,
            affected_zones: vec![],
            vtec: None,
        }
    }

    fn shared() -> Shared {
        let mut sh = Shared::new(
            Config::default(),
            LocationsFile::default(),
            SessionFile::default(),
        );
        sh.alerts
            .insert("a".into(), vec![alert("1", "Wind"), alert("2", "Heat")]);
        sh.alerts.insert("b".into(), vec![alert("3", "Flood")]);
        sh.area_alerts = vec![alert("2", "Heat"), alert("4", "Fog")];
        sh
    }

    fn ids(v: Vec<&Alert>) -> Vec<&str> {
        v.into_iter().map(|a| a.id.as_str()).collect()
    }

    #[test]
    fn alerts_for_is_per_location() {
        let sh = shared();
        assert_eq!(sh.alerts_for("a").len(), 2);
        assert_eq!(sh.alerts_for("b").len(), 1);
        assert!(sh.alerts_for("nope").is_empty());
    }

    #[test]
    fn all_alerts_for_includes_viewport_alerts_deduped() {
        let mut sh = shared();
        sh.viewport_alerts = vec![alert("1", "Wind"), alert("5", "Hail"), alert("4", "Fog")];
        assert_eq!(ids(sh.all_alerts_for("a")), vec!["1", "2", "4", "5"]);
        assert_eq!(ids(sh.all_alerts_for("b")), vec!["3", "2", "4", "1", "5"]);
        assert!(sh.find_alert("5").is_some());
    }

    #[test]
    fn all_alerts_for_merges_area_alerts_without_duplicates() {
        let sh = shared();
        assert_eq!(ids(sh.all_alerts_for("a")), vec!["1", "2", "4"]);
        assert_eq!(ids(sh.all_alerts_for("b")), vec!["3", "2", "4"]);
        assert_eq!(sh.all_alerts_for("").len(), 2);
    }

    #[test]
    fn filtered_alerts_for_applies_text_filter() {
        let mut sh = shared();
        sh.alert_filter = "flood".into();
        assert_eq!(sh.filtered_alerts_for("b").len(), 1);
        assert!(sh.filtered_alerts_for("a").is_empty());
    }

    #[test]
    fn find_alert_searches_every_location_and_area() {
        let sh = shared();
        assert!(sh.find_alert("3").is_some());
        assert!(sh.find_alert("4").is_some());
        assert!(sh.find_alert("9").is_none());
    }

    #[test]
    fn demo_alerts_are_location_independent_and_respect_hidden_classes() {
        let mut sh = shared();
        sh.demo_alerts.push(alert("d1", "Demo"));
        assert_eq!(ids(sh.all_alerts_for("a")), vec!["1", "2", "4", "d1"]);
        assert_eq!(ids(sh.all_alerts_for("")), vec!["2", "4", "d1"]);
        assert!(sh.find_alert("d1").is_some());
        sh.config.alert_type_overrides.insert(
            "other".into(),
            ss_core::AlertTypeOverride {
                visible: Some(false),
                color: None,
            },
        );
        assert!(sh.all_alerts_for("a").is_empty());
    }

    #[test]
    fn asteroid_phase_thresholds() {
        let t0 = Instant::now();
        let st = AsteroidState {
            alert_id: "x".into(),
            impact_at: t0 + Duration::from_secs(60),
            total_secs: 60,
        };
        assert_eq!(asteroid_phase(t0, &st), AsteroidPhase::Countdown(60));
        assert_eq!(
            asteroid_phase(t0 + Duration::from_millis(54_500), &st),
            AsteroidPhase::Countdown(6)
        );
        assert_eq!(
            asteroid_phase(t0 + Duration::from_secs(55), &st),
            AsteroidPhase::Violent(5)
        );
        assert_eq!(
            asteroid_phase(t0 + Duration::from_millis(59_100), &st),
            AsteroidPhase::Violent(1)
        );
        assert_eq!(
            asteroid_phase(t0 + Duration::from_secs(60), &st),
            AsteroidPhase::Impact
        );
        assert_eq!(
            asteroid_phase(t0 + Duration::from_secs(90), &st),
            AsteroidPhase::Impact
        );
    }
}
