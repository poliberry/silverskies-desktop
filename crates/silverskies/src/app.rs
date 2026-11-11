//! The eframe application: owns the shared state, drains background events,
//! runs the command pipeline and draws the window.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crossbeam_channel::Receiver;
use parking_lot::RwLock;
use ss_audio::alert_announcement;
use ss_core::command::Command;
use ss_core::same::event_name;
use ss_core::theme::resolve_palette;
use ss_core::weather::wmo::accent_for;
use ss_core::{Alert, LiveFeedMode, PanelKind, RadioMode};
use ss_net::Net;
use ss_store::{Dedupe, Store};

use crate::audio::{should_announce, AudioState, RadioCandidate, RadioSyncKey};
use crate::cmdbar::CommandBar;
use crate::commands;
use crate::events::AppEvent;
use crate::layout::{self, LayoutState};
use crate::panels::{self, Panel, PanelFactory};
use crate::state::{
    asteroid_phase, AsteroidPhase, LogLevel, PanelRequests, RadioStatus, Shared, WindowTarget,
    FLASH_DURATION,
};
use crate::tasks::Tasks;
use crate::theme;
use crate::windows::{self, WindowManager};

const STATIC_REFRESH: Duration = Duration::from_secs(30 * 60);
/// Minimum gap between session writes while windows are being dragged.
const SESSION_SAVE_EVERY: Duration = Duration::from_millis(400);

pub struct App {
    pub shared: Arc<RwLock<Shared>>,
    pub tasks: Tasks,
    pub ctx: egui::Context,
    rx: Receiver<AppEvent>,
    cmdbar: CommandBar,
    pub(crate) panels: HashMap<PanelKind, Box<dyn Panel>>,
    layout_state: LayoutState,
    store: Store,
    dedupe: Dedupe,
    last_static: Instant,
    last_maps: Instant,
    last_spc: Instant,
    last_auto: Instant,
    last_session_save: Instant,
    /// Builds panel instances for child windows (holds client, runtime, tile dir).
    pub(crate) factory: PanelFactory,
    pub(crate) windows: WindowManager,
    /// Requests addressed to the main window's panels.
    pub(crate) req: PanelRequests,
    /// Alert announcer and weather radio.
    pub(crate) audio: AudioState,
    /// Logo click counter for the asteroid easter egg.
    logo_clicks: (u8, Instant),
    last_system_dark: Option<bool>,
    /// Cached severe-alert pulse colour and the alerts revision it was built for.
    pulse_color: Option<[u8; 3]>,
    pulse_key: Option<(u64, String, usize)>,
}

impl App {
    pub fn new(
        cc: &eframe::CreationContext<'_>,
        rt: tokio::runtime::Handle,
        store: Store,
    ) -> anyhow::Result<App> {
        let ctx = cc.egui_ctx.clone();
        theme::install_fonts(&ctx);

        let config = store.load_config();
        let locations = store.load_locations();
        let session = store.load_session();
        let dedupe = store.load_dedupe();

        let net = Net::new(&config.libre_wxr_host)?;
        let (tx, rx) = crossbeam_channel::unbounded();
        let audio = AudioState::new(rt.clone(), tx.clone(), ctx.clone());
        let tasks = Tasks::new(rt.clone(), net, tx, ctx.clone());

        let client = reqwest::Client::builder()
            .user_agent(concat!("silverskies/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(20))
            .build()?;
        let factory = PanelFactory::new(client, rt, Some(store.dir().join("tiles")), ctx.clone());
        let mut panels = panels::build_panels(&factory);
        let windows = windows::restore_windows(&session.windows, &locations.saved_locations);
        let mut windows = windows;

        let mut shared = Shared::new(config, locations, session);
        shared.data_dir = Some(store.dir().to_path_buf());
        windows.attach_panels(&factory, &mut panels, &mut shared.layout);
        shared.log(
            LogLevel::Info,
            format!(
                "silverskies {} - press : for commands",
                env!("CARGO_PKG_VERSION")
            ),
        );
        shared.log(
            LogLevel::Info,
            format!("data dir: {}", store.dir().display()),
        );

        let mut app = App {
            shared: Arc::new(RwLock::new(shared)),
            tasks,
            ctx,
            rx,
            cmdbar: CommandBar::default(),
            panels,
            layout_state: LayoutState::default(),
            store,
            dedupe,
            last_static: Instant::now(),
            last_maps: Instant::now(),
            last_spc: Instant::now(),
            last_auto: Instant::now(),
            last_session_save: Instant::now(),
            factory,
            windows,
            req: PanelRequests::default(),
            audio,
            logo_clicks: (0, Instant::now()),
            last_system_dark: None,
            pulse_color: None,
            pulse_key: None,
        };
        app.update_palette(true);
        app.tasks.load_static();
        app.fetch_spc_if_enabled();
        app.refresh_all();
        {
            let mut sh = app.shared.write();
            if sh.locations.saved_locations.is_empty() {
                sh.log(LogLevel::Info, "no saved locations: locating via IP...");
                app.tasks.ip_locate();
            }
        }
        Ok(app)
    }

    pub fn refresh_all(&mut self) {
        let shared = self.shared.clone();
        let mut sh = shared.write();
        let n = sh.locations.saved_locations.len();
        if n == 0 {
            return;
        }
        sh.pending_results += 2 * n;
        sh.refreshing = true;
        self.tasks.refresh_all(&sh.locations, &sh.config);
        self.last_auto = Instant::now();
    }

    /// Recompute the palette from config + active conditions.
    pub fn update_palette(&mut self, force: bool) {
        let system_dark = self
            .ctx
            .input(|i| i.raw.system_theme)
            .map(|t| t == egui::Theme::Dark)
            .unwrap_or(true);
        if self.last_system_dark != Some(system_dark) {
            self.last_system_dark = Some(system_dark);
            self.ctx
                .send_viewport_cmd(egui::ViewportCommand::Icon(Some(crate::icons::app_icon(
                    system_dark,
                ))));
        }
        let mut sh = self.shared.write();
        let accent = sh
            .active_weather()
            .map(|w| {
                accent_for(
                    w.current.weather_code,
                    w.current.is_day,
                    w.current.temperature_c,
                    w.current.wind_speed_kmh,
                )
            })
            .unwrap_or([0x7f, 0xb4, 0xff]);
        let p = resolve_palette(&sh.config, accent, system_dark);
        if force || p != sh.palette {
            sh.palette = p;
            theme::apply_palette(&self.ctx, &p);
        }
    }

    /// Recompute the cached pulse colour when the alerts or active location change.
    fn refresh_pulse(&mut self, sh: &Shared) {
        let loc = sh.locations.active_location_id.clone().unwrap_or_default();
        let key = (sh.alerts_rev, loc.clone(), sh.demo_alerts.len());
        if self.pulse_key.as_ref() == Some(&key) {
            return;
        }
        let alerts: Vec<Alert> = sh.all_alerts_for(&loc).into_iter().cloned().collect();
        self.pulse_color = ss_core::alerts::colors::active_pulse_color(&alerts);
        self.pulse_key = Some(key);
    }

    fn drain_events(&mut self) {
        let events: Vec<AppEvent> = self.rx.try_iter().collect();
        if events.is_empty() {
            return;
        }
        let shared = self.shared.clone();
        let mut sh = shared.write();
        for ev in events {
            self.handle_event(&mut sh, ev);
        }
    }

    fn handle_event(&mut self, sh: &mut Shared, ev: AppEvent) {
        match ev {
            AppEvent::WeatherLoaded {
                location_id,
                result,
            } => {
                let label = label_of(sh, &location_id);
                self.result_done(sh);
                match result {
                    Ok(w) => {
                        sh.log(
                            LogLevel::Info,
                            format!(
                                "forecast loaded for {label}: {} hourly, {} daily",
                                w.hourly.len(),
                                w.daily.len()
                            ),
                        );
                        sh.weather_errors.remove(&location_id);
                        sh.weather.insert(location_id, w);
                        sh.last_refresh = Some(Instant::now());
                    }
                    Err(e) => {
                        sh.log(LogLevel::Error, format!("forecast for {label}: {e}"));
                        sh.weather_errors.insert(location_id, e);
                    }
                }
            }
            AppEvent::AlertsLoaded {
                location_id,
                alerts,
                errors,
            } => {
                let label = label_of(sh, &location_id);
                self.result_done(sh);
                for e in errors {
                    sh.log(LogLevel::Warn, format!("alerts ({label}): {e}"));
                }
                sh.log(
                    LogLevel::Info,
                    format!("alerts loaded for {label}: {}", alerts.len()),
                );
                // Hidden classes stay in the list (so re-enabling them in
                // settings takes effect at once); they are filtered on read.
                let first_load = !sh.alerts.contains_key(&location_id);
                let fresh = self.mark_new(&alerts);
                if !first_load && sh.config.notifications_enabled {
                    for a in &fresh {
                        if ss_core::alerts::colors::effective_visible(
                            &a.class,
                            &sh.config.alert_type_overrides,
                        ) {
                            notify(&label, a);
                        }
                    }
                }
                if !first_load {
                    let is_active =
                        sh.locations.active_location_id.as_deref() == Some(location_id.as_str());
                    for a in &fresh {
                        if !ss_core::alerts::colors::effective_visible(
                            &a.class,
                            &sh.config.alert_type_overrides,
                        ) {
                            continue;
                        }
                        if let Some(tone) = should_announce(&sh.config, a, is_active) {
                            let text = alert_announcement(
                                &a.display_event,
                                a.headline.as_deref(),
                                a.area_desc.as_deref(),
                                a.description.as_deref(),
                                600,
                            );
                            self.audio.announce(text, tone);
                        }
                    }
                }
                sh.alerts.insert(location_id, alerts);
                sh.bump_alerts();
            }
            AppEvent::RadarStations(r) => match r {
                Ok(v) => {
                    sh.log(
                        LogLevel::Info,
                        format!("radar stations loaded: {}", v.len()),
                    );
                    sh.radar_stations = v;
                }
                Err(e) => sh.log(LogLevel::Warn, format!("radar stations: {e}")),
            },
            AppEvent::WeatherMaps(r) => match r {
                Ok(m) => {
                    if sh.weather_maps.is_none() {
                        sh.log(LogLevel::Info, "weather map index loaded");
                    }
                    sh.weather_maps = Some(m);
                }
                Err(e) => sh.log(LogLevel::Warn, format!("weather maps: {e}")),
            },
            AppEvent::SpcOutlook(r) => match r {
                Ok(v) => {
                    sh.log(LogLevel::Info, format!("spc outlook: {} areas", v.len()));
                    sh.spc_outlook = v;
                }
                Err(e) => sh.log(LogLevel::Warn, format!("spc outlook: {e}")),
            },
            AppEvent::McdAlerts(r) => match r {
                Ok(v) => {
                    sh.log(
                        LogLevel::Info,
                        format!("spc mesoscale discussions: {}", v.len()),
                    );
                    sh.mcd_alerts = v;
                    sh.bump_alerts();
                }
                Err(e) => sh.log(LogLevel::Warn, format!("spc mesoscale discussions: {e}")),
            },
            AppEvent::WindObs { obs, .. } => {
                sh.log(LogLevel::Info, format!("wind obs: {} stations", obs.len()));
                sh.wind_obs = obs;
            }
            AppEvent::AirQuality {
                location_id,
                result,
            } => match result {
                Ok(aq) => {
                    sh.air_quality.insert(location_id, aq);
                }
                Err(e) => sh.log(LogLevel::Warn, format!("air quality: {e}")),
            },
            AppEvent::Geocoded { query, results } => {
                if let Some(first) = results.first().cloned() {
                    if results.len() > 1 {
                        sh.log(
                            LogLevel::Info,
                            format!(
                                "{} matches for {query:?}; using {}",
                                results.len(),
                                first.label
                            ),
                        );
                    }
                    commands::add_or_select(&self.tasks, sh, first);
                    self.location_changed();
                } else {
                    sh.log(LogLevel::Error, format!("no results for {query:?}"));
                }
            }
            AppEvent::ReverseGeocoded { location_id, label } => {
                if !label.trim().is_empty() {
                    if let Some(l) = sh
                        .locations
                        .saved_locations
                        .iter_mut()
                        .find(|l| l.id == location_id)
                    {
                        l.label = label;
                        sh.dirty_locations = true;
                    }
                }
            }
            AppEvent::IpLocated(loc) => match loc {
                Some(l) => {
                    sh.log(LogLevel::Info, format!("located: {}", l.label));
                    commands::add_or_select(&self.tasks, sh, l);
                    self.location_changed();
                }
                None => sh.log(
                    LogLevel::Error,
                    "could not determine location (try :goto <place>)",
                ),
            },
            AppEvent::AreaAlertsLoaded(v) => {
                sh.log(LogLevel::Info, format!("area alerts: {}", v.len()));
                sh.area_alerts = v;
                sh.bump_alerts();
            }
            AppEvent::ViewportAlertsLoaded { bbox, alerts } => {
                if alerts.len() != sh.viewport_alerts.len() {
                    sh.log(LogLevel::Info, format!("viewport alerts: {}", alerts.len()));
                }
                sh.viewport_alerts = alerts;
                sh.viewport_alerts_bbox = Some(bbox);
                sh.bump_alerts();
            }
            AppEvent::Log(level, text) => sh.log(level, text),
            AppEvent::RadioCandidates { location_id, feeds } => {
                let wanted = sh.config.weather_radio_enabled
                    && sh.config.weather_radio_mode == RadioMode::Live
                    && sh.config.weather_radio_live_feed_mode == LiveFeedMode::Auto
                    && sh.locations.active_location_id.as_deref() == Some(location_id.as_str());
                if !wanted {
                    return;
                }
                if feeds.is_empty() {
                    sh.radio.candidates.clear();
                    sh.radio.status = RadioStatus::NoFeed(
                        "No public feed could be resolved for this location - try Settings > Radio > Manual URL."
                            .into(),
                    );
                    sh.log(
                        LogLevel::Warn,
                        "radio: no public feed found for this location",
                    );
                } else {
                    let cands: Vec<RadioCandidate> = feeds
                        .iter()
                        .map(|f| RadioCandidate {
                            label: format!("{} {}, {}", f.callsign, f.city, f.state),
                            url: f.stream_url.clone(),
                        })
                        .collect();
                    sh.radio.candidates = feeds;
                    self.audio.radio_play(cands, true);
                }
            }
            AppEvent::RadioStatus(s) => {
                match &s {
                    RadioStatus::Playing { label, .. } => {
                        sh.log(LogLevel::Info, format!("radio: playing {label}"));
                    }
                    RadioStatus::Failed { label, error } => {
                        sh.log(LogLevel::Warn, format!("radio: {label}: {error}"));
                    }
                    RadioStatus::Ended { label } => {
                        sh.log(LogLevel::Warn, format!("radio: {label}: stream ended"));
                    }
                    _ => {}
                }
                sh.radio.status = s;
            }
            AppEvent::SameHeader(h) => {
                let name = event_name(&h.event_code);
                let summary = format!(
                    "{} {} {}",
                    h.originator,
                    h.event_code,
                    h.locations.join(" ")
                );
                sh.log(LogLevel::Info, format!("SAME: {name} ({})", h.originator));
                sh.radio.last_same = Some((name.to_string(), summary, Instant::now()));
            }
            AppEvent::SameEom => sh.log(LogLevel::Info, "SAME: end of message"),
        }
    }

    fn result_done(&mut self, sh: &mut Shared) {
        sh.pending_results = sh.pending_results.saturating_sub(1);
        if sh.pending_results == 0 {
            sh.refreshing = false;
        }
    }

    /// Mark alerts as seen; return the ones not seen before.
    fn mark_new<'a>(&mut self, alerts: &'a [Alert]) -> Vec<&'a Alert> {
        let mut fresh = Vec::new();
        for a in alerts {
            let key = a.dedupe_key();
            if !self.dedupe.has(&key) {
                self.dedupe.mark(&key);
                fresh.push(a);
            }
        }
        self.dedupe.prune(7 * 86_400);
        let _ = self.store.save_dedupe(&self.dedupe);
        fresh
    }

    /// Fetch the SPC outlook + mesoscale discussions when either layer is on.
    fn fetch_spc_if_enabled(&self) {
        let want = {
            let sh = self.shared.read();
            sh.config.spc_outlook_enabled || sh.config.radar.md_polygons
        };
        if want {
            self.tasks.spc_products();
        }
    }

    fn periodic(&mut self) {
        self.tick_asteroid();
        self.audio.tick(&self.ctx);
        self.sync_radio();
        self.mirror_speech();
        if self.last_static.elapsed() >= STATIC_REFRESH {
            self.last_static = Instant::now();
            self.tasks.load_static();
            self.last_spc = Instant::now();
            self.fetch_spc_if_enabled();
        }
        if self.last_maps.elapsed() >= Duration::from_secs(120) {
            self.last_maps = Instant::now();
            self.tasks.weather_maps();
        }
        if self.last_spc.elapsed() >= Duration::from_secs(600) {
            self.last_spc = Instant::now();
            self.fetch_spc_if_enabled();
        }
        let mins = self.shared.read().config.auto_refresh_minutes;
        if mins > 0 && self.last_auto.elapsed() >= Duration::from_secs(u64::from(mins) * 60) {
            self.refresh_all();
        }
    }

    /// Start, stop or re-resolve the weather radio when its config changes.
    fn sync_radio(&mut self) {
        let shared = self.shared.clone();
        let mut sh = shared.write();
        let loc = sh.active_location().cloned();
        let key = RadioSyncKey::new(&sh.config, loc.as_ref().map(|l| l.id.as_str()));
        if !self.audio.sync_changed(key) {
            return;
        }
        let cfg = &sh.config;
        if !(cfg.weather_radio_enabled && cfg.weather_radio_mode == RadioMode::Live) {
            self.audio.radio_stop();
            sh.radio.status = RadioStatus::Off;
            sh.radio.candidates.clear();
            return;
        }
        let feed_mode = cfg.weather_radio_live_feed_mode;
        let url = cfg
            .weather_radio_live_stream_url
            .as_deref()
            .map(str::trim)
            .filter(|u| u.starts_with("http://") || u.starts_with("https://"))
            .map(str::to_string);
        sh.radio.candidates.clear();
        match feed_mode {
            LiveFeedMode::Manual => match url {
                Some(url) => {
                    sh.radio.status = RadioStatus::Connecting {
                        label: "manual stream".into(),
                    };
                    self.audio.radio_play(
                        vec![RadioCandidate {
                            label: "manual stream".into(),
                            url,
                        }],
                        false,
                    );
                }
                None => {
                    self.audio.radio_stop();
                    sh.radio.status = RadioStatus::NoFeed(
                        "Add a live stream URL in Settings > Radio to start listening.".into(),
                    );
                }
            },
            LiveFeedMode::Auto => {
                self.audio.radio_stop();
                match loc {
                    Some(l) => {
                        sh.radio.status = RadioStatus::Connecting {
                            label: "resolving feeds".into(),
                        };
                        self.tasks.nwr_candidates(l.id, l.lat, l.lon);
                    }
                    None => sh.radio.status = RadioStatus::NoFeed("No active location.".into()),
                }
            }
        }
    }

    /// Mirror announcer state into the shared radio view (only when it changed).
    fn mirror_speech(&mut self) {
        let speaking = self.audio.speaking();
        let queued = self.audio.queued();
        let mut sh = self.shared.write();
        if sh.radio.speaking.as_deref() != speaking {
            sh.radio.speaking = speaking.map(str::to_string);
        }
        if sh.radio.queued != queued {
            sh.radio.queued = queued;
        }
    }

    /// Drive the asteroid countdown: keep repainting, detonate on impact and
    /// expire the flash.
    fn tick_asteroid(&mut self) {
        let now = Instant::now();
        let impact = {
            let mut sh = self.shared.write();
            if sh.flash_until.is_some_and(|t| now >= t) {
                sh.flash_until = None;
            }
            if sh.flash_until.is_some() {
                self.ctx.request_repaint();
            }
            let hit = sh
                .asteroid
                .as_ref()
                .is_some_and(|st| asteroid_phase(now, st) == AsteroidPhase::Impact);
            if hit {
                apply_impact(&mut sh, now);
            } else if sh.asteroid.is_some() {
                self.ctx.request_repaint_after(Duration::from_millis(100));
            }
            hit
        };
        if impact {
            self.refresh_all();
        }
    }

    /// Full-window red overlay fading out after an impact.
    fn paint_flash(&self, ctx: &egui::Context) {
        let Some(until) = self.shared.read().flash_until else {
            return;
        };
        let left = until.saturating_duration_since(Instant::now());
        let k = (left.as_secs_f32() / FLASH_DURATION.as_secs_f32()).clamp(0.0, 1.0);
        let alpha = (0.8 * k * 255.0) as u8;
        ctx.layer_painter(egui::LayerId::new(
            egui::Order::Foreground,
            egui::Id::unique("impact_flash"),
        ))
        .rect_filled(
            ctx.content_rect(),
            0.0,
            egui::Color32::from_rgba_unmultiplied(255, 24, 0, alpha),
        );
    }

    /// A new location became active: drop the main window's alert selection
    /// and recentre its map.
    pub(crate) fn location_changed(&mut self) {
        self.req.selected_alert_id = None;
        self.req.map_recenter = true;
    }

    /// Mirror the open windows (and the main window bounds) into the session.
    fn sync_session(&mut self, ctx: &egui::Context) {
        let mut sh = self.shared.write();
        let wins = windows::session_windows(&self.windows.windows, &sh.locations.saved_locations);
        if wins != sh.session.windows {
            sh.session.windows = wins;
            sh.dirty_session = true;
        }
        let main = ctx.input(|i| {
            windows::bounds_from_rects(i.viewport().outer_rect, i.viewport().inner_rect)
        });
        if let Some(b) = main {
            if sh.session.main_bounds != Some(b) {
                sh.session.main_bounds = Some(b);
                sh.dirty_session = true;
            }
        }
    }

    fn persist(&mut self, force: bool) {
        let mut sh = self.shared.write();
        if sh.dirty_config {
            sh.dirty_config = false;
            if let Err(e) = self.store.save_config(&sh.config) {
                sh.log(LogLevel::Error, format!("saving config: {e}"));
            }
        }
        if sh.dirty_locations {
            sh.dirty_locations = false;
            if let Err(e) = self.store.save_locations(&sh.locations) {
                sh.log(LogLevel::Error, format!("saving locations: {e}"));
            }
        }
        let session_pending = sh.dirty_session || sh.session.layout != sh.layout;
        if session_pending && (force || self.last_session_save.elapsed() >= SESSION_SAVE_EVERY) {
            sh.dirty_session = false;
            self.last_session_save = Instant::now();
            sh.session.layout = sh.layout.clone();
            if let Err(e) = self.store.save_session(&sh.session) {
                sh.log(LogLevel::Error, format!("saving session: {e}"));
            }
        }
    }
}

/// The asteroid hit: wipe every demo alert and start the flash.
fn apply_impact(sh: &mut Shared, now: Instant) {
    sh.demo_alerts.clear();
    sh.asteroid = None;
    sh.flash_until = Some(now + FLASH_DURATION);
    sh.log(LogLevel::Warn, "IMPACT. demo alerts cleared.");
    sh.bump_alerts();
}

/// Deterministic pseudo-random shake offset for a frame time.
fn jitter(t_ms: u128, amp: f32) -> egui::Vec2 {
    let mut x = (t_ms as u64 / 33).wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ 0xD1B5_4A32_D192_ED03;
    x ^= x >> 29;
    x = x.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x ^= x >> 32;
    let unit = |v: u64| (v & 0xFFFF) as f32 / 65535.0 * 2.0 - 1.0;
    egui::vec2(unit(x) * amp, unit(x >> 16) * amp)
}

fn label_of(sh: &Shared, id: &str) -> String {
    sh.locations
        .saved_locations
        .iter()
        .find(|l| l.id == id)
        .map(|l| l.label.clone())
        .unwrap_or_else(|| id.to_string())
}

fn notify(label: &str, a: &Alert) {
    let summary = format!("{} - {label}", a.display_event);
    let body = a
        .headline
        .clone()
        .or_else(|| a.area_desc.clone())
        .unwrap_or_default();
    std::thread::spawn(move || {
        let _ = notify_rust::Notification::new()
            .summary(&summary)
            .body(&body)
            .show();
    });
}

impl eframe::App for App {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();
        self.drain_events();
        self.periodic();
        self.update_palette(false);
        self.cmdbar.handle_global_keys(&ctx);

        let mut emit: Vec<(WindowTarget, Command)> = Vec::new();
        let shared = self.shared.clone();
        {
            let mut sh = shared.write();
            let location = sh.active_location().cloned();
            let mut main_cmds: Vec<Command> = Vec::new();
            let h = ctx.content_rect().height();
            let t = ctx.input(|i| i.time);
            let dark = sh.palette.bg.iter().map(|&v| v as u32).sum::<u32>() < 384;
            self.refresh_pulse(&sh);
            let pulse = self.pulse_color;
            let bg = theme::c32(crate::glow::pulse_bg(sh.palette.bg, pulse, dark, t));
            let now = chrono::Local::now();
            egui::Panel::top("header")
                .exact_size(34.0)
                .resizable(false)
                .frame(egui::Frame::NONE.fill(bg).inner_margin(egui::Margin {
                    left: 12,
                    right: 12,
                    top: 8,
                    bottom: 6,
                }))
                .show(ui, |ui| {
                    if crate::header::show(ui, &sh, pulse, now).logo_clicked
                        && crate::header::count_click(&mut self.logo_clicks, Instant::now())
                    {
                        main_cmds.push(Command::Asteroid);
                    }
                });
            let cmd_h = self.cmdbar.panel_height(h);
            let phase = sh
                .asteroid
                .as_ref()
                .map(|st| asteroid_phase(Instant::now(), st));
            if let Some(ph) = phase {
                let secs = match ph {
                    AsteroidPhase::Countdown(n) | AsteroidPhase::Violent(n) => n,
                    AsteroidPhase::Impact => 0,
                };
                egui::Panel::top("asteroid_banner")
                    .exact_size(24.0)
                    .resizable(false)
                    .frame(egui::Frame::NONE.fill(egui::Color32::from_rgb(0xcc, 0x10, 0x00)))
                    .show(ui, |ui| {
                        ui.centered_and_justified(|ui| {
                            ui.label(
                                egui::RichText::new(format!("IMPACT IN {secs}s"))
                                    .monospace()
                                    .strong()
                                    .color(egui::Color32::WHITE),
                            );
                        });
                    });
            }
            let shake = phase.map(|ph| {
                let amp = if matches!(ph, AsteroidPhase::Violent(_)) {
                    6.0
                } else {
                    2.0
                };
                let ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0);
                jitter(ms, amp)
            });
            let frame = egui::Frame::NONE.fill(bg);
            let mut central = egui::Rect::NOTHING;
            egui::CentralPanel::default().frame(frame).show(ui, |ui| {
                central = ui.max_rect();
                let rect = ui.max_rect().translate(shake.unwrap_or(egui::Vec2::ZERO));
                ui.scope_builder(egui::UiBuilder::new().max_rect(rect), |ui| {
                    layout::show(
                        ui,
                        &mut self.layout_state,
                        &mut sh,
                        &mut self.panels,
                        &self.tasks,
                        &mut main_cmds,
                        &mut self.req,
                        location.as_ref(),
                        cmd_h,
                    );
                });
            });
            {
                let rect = layout::cmdbar_rect(central, &sh.layout, cmd_h);
                let fill = layout::card_fill(&sh.palette);
                let border = theme::c32a(sh.palette.border);
                egui::Area::new(egui::Id::unique("cmdbar_float"))
                    .order(egui::Order::Middle)
                    .fixed_pos(rect.min)
                    .interactable(true)
                    .show(&ctx, |ui| {
                        ui.set_min_size(rect.size());
                        ui.set_max_size(rect.size());
                        ui.painter().rect_filled(rect, 0.0, fill);
                        ui.painter().rect_stroke(
                            rect,
                            0.0,
                            egui::Stroke::new(1.0, border),
                            egui::StrokeKind::Inside,
                        );
                        // Registered before the content so the map never sees the press.
                        ui.interact(
                            rect,
                            egui::Id::unique("cmdbar_float_block"),
                            egui::Sense::click_and_drag(),
                        );
                        let inner = rect.shrink2(egui::vec2(6.0, 4.0));
                        let mut child = ui.new_child(
                            egui::UiBuilder::new()
                                .id_salt("cmdbar_body")
                                .max_rect(inner)
                                .layout(egui::Layout::top_down(egui::Align::Min)),
                        );
                        child.set_clip_rect(rect.intersect(ui.clip_rect()));
                        if let Some(c) = self.cmdbar.show(&mut child, &mut sh, location.as_ref()) {
                            main_cmds.push(c);
                        }
                    });
            }
            if sh.config.top_glow_enabled {
                let params = crate::glow::GlowParams {
                    color: pulse.unwrap_or(sh.palette.a0),
                    pulsing: pulse.is_some(),
                    dark,
                };
                let painter = ctx.layer_painter(egui::LayerId::new(
                    egui::Order::Foreground,
                    egui::Id::unique("top_glow"),
                ));
                let top = ctx.content_rect();
                crate::glow::draw_top_glow(&painter, top, &params, t);
            }
            if sh.config.top_glow_enabled || pulse.is_some() {
                ctx.request_repaint_after(Duration::from_millis(33));
            }
            emit.extend(main_cmds.into_iter().map(|c| (WindowTarget::Main, c)));
        }
        // The main lock must be released here: child windows take it themselves.
        let closed = self
            .windows
            .show_all(&ctx, &shared, &self.tasks, &mut self.req, &mut emit);
        for id in closed {
            let mut sh = shared.write();
            self.close_window(&mut sh, &id);
        }
        let palette_dirty = std::mem::take(&mut shared.write().palette_dirty);
        if palette_dirty {
            self.update_palette(true);
        }
        for (target, c) in emit {
            commands::execute(self, target, c);
        }
        self.paint_flash(&ctx);
        self.windows.route_radar_requests(&mut self.req);
        self.sync_session(&ctx);
        self.persist(false);
        ctx.request_repaint_after(Duration::from_secs(1));
    }

    fn on_exit(&mut self, _gl: Option<&eframe::glow::Context>) {
        self.persist(true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AsteroidState;
    use ss_core::{Config, LocationsFile, SessionFile};

    #[test]
    fn impact_clears_demo_alerts_and_starts_flash() {
        let mut sh = Shared::new(
            Config::default(),
            LocationsFile::default(),
            SessionFile::default(),
        );
        let now = Instant::now();
        sh.asteroid = Some(AsteroidState {
            alert_id: "x".into(),
            impact_at: now,
            total_secs: 60,
        });
        sh.demo_alerts
            .push(ss_core::alerts::demo::build_asteroid_alert(
                chrono::Utc::now(),
                60,
            ));
        let rev = sh.alerts_rev;
        apply_impact(&mut sh, now);
        assert!(sh.demo_alerts.is_empty());
        assert!(sh.asteroid.is_none());
        assert_eq!(sh.flash_until, Some(now + FLASH_DURATION));
        assert_ne!(sh.alerts_rev, rev);
    }

    #[test]
    fn jitter_is_bounded_and_deterministic() {
        for t in (0..5000u128).step_by(33) {
            let v = jitter(t, 6.0);
            assert!(v.x.abs() <= 6.0 && v.y.abs() <= 6.0);
            assert_eq!(v, jitter(t, 6.0));
        }
        assert_ne!(jitter(0, 6.0), jitter(33, 6.0));
    }
}
