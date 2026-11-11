//! The editable settings window: tabbed, terminal-styled, and wired to
//! `Shared.config`. Every edit goes through `apply_config_change`, which marks
//! the config dirty and requests the follow-up work (palette, radar layer,
//! radar host).

use std::collections::BTreeMap;

use egui::{RichText, Ui};
use ss_core::alerts::colors::{class_color, effective_color, effective_visible, ALL_CLASSES};
use ss_core::alerts::demo::DEMO_GROUPS;
use ss_core::command::Command;
use ss_core::theme::{builtin_themes, parse_color, resolve_palette, Palette};
use ss_core::{
    AlertTypeOverride, Config, LiveFeedMode, RadarProduct, RadioMode, ThemeColors, ThemeDefinition,
    ThemePref, TimeFormat, TtsSeverityFilter, UnitPref, WeatherProviderId,
};

use crate::state::Shared;
use crate::theme::{c32, c32a};
use crate::windows::config_text;

const REPO_URL: &str = "https://github.com/poliberry/silverskies-desktop";
/// Fixed accent for theme previews.
const PREVIEW_ACCENT: [u8; 3] = [0x7f, 0xb4, 0xff];
const REFRESH_CHOICES: [u32; 7] = [0, 5, 10, 15, 30, 60, 120];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Tab {
    #[default]
    General,
    Sources,
    Radar,
    Alerts,
    Radio,
    Themes,
    Developer,
    About,
}

impl Tab {
    const ALL: [Tab; 8] = [
        Tab::General,
        Tab::Sources,
        Tab::Radar,
        Tab::Alerts,
        Tab::Radio,
        Tab::Themes,
        Tab::Developer,
        Tab::About,
    ];

    fn label(self) -> &'static str {
        match self {
            Tab::General => "GENERAL",
            Tab::Sources => "SOURCES",
            Tab::Radar => "RADAR",
            Tab::Alerts => "ALERTS",
            Tab::Radio => "RADIO",
            Tab::Themes => "THEMES",
            Tab::Developer => "DEVELOPER",
            Tab::About => "ABOUT",
        }
    }
}

/// Per-window UI state (not persisted).
#[derive(Default)]
pub struct SettingsState {
    pub tab: Tab,
    alert_filter: String,
    theme_json: String,
    theme_path: String,
    /// `(is_error, text)` from the last theme import.
    notice: Option<(bool, String)>,
    demo_group: usize,
    demo_item: usize,
    /// Pending text of the LibreWXR host box until it loses focus.
    host_buf: Option<String>,
    site_buf: Option<String>,
    show_accu: bool,
    show_willy: bool,
    show_owm: bool,
}

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

fn hex(rgb: [u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", rgb[0], rgb[1], rgb[2])
}

/// Drop the entry when it carries no information.
fn prune_override(map: &mut BTreeMap<String, AlertTypeOverride>, class: &str) {
    let empty = map
        .get(class)
        .is_some_and(|o| o.color.is_none() && o.visible.unwrap_or(true));
    if empty {
        map.remove(class);
    }
}

/// Set a class color; the default color clears the override.
pub fn set_override_color(
    map: &mut BTreeMap<String, AlertTypeOverride>,
    class: &str,
    rgb: [u8; 3],
) {
    let color = (rgb != class_color(class)).then(|| hex(rgb));
    map.entry(class.to_string()).or_default().color = color;
    prune_override(map, class);
}

/// Show or hide a class; "visible" is the default so it clears the field.
pub fn set_override_visible(
    map: &mut BTreeMap<String, AlertTypeOverride>,
    class: &str,
    visible: bool,
) {
    map.entry(class.to_string()).or_default().visible = (!visible).then_some(false);
    prune_override(map, class);
}

pub fn reset_override(map: &mut BTreeMap<String, AlertTypeOverride>, class: &str) {
    map.remove(class);
}

/// Empty / whitespace-only strings are stored as `None`.
pub fn opt_string(s: &str) -> Option<String> {
    let t = s.trim();
    (!t.is_empty()).then(|| t.to_string())
}

/// Whether the system/light/dark preference has any effect with this config.
pub fn theme_pref_applies(cfg: &Config) -> bool {
    match cfg.theme_id.as_str() {
        "custom" => cfg.custom_theme.is_none(),
        id => !builtin_themes().iter().any(|t| t.id == id),
    }
}

fn slots(c: &ThemeColors) -> [(&'static str, &Option<String>); 10] {
    [
        ("a0", &c.a0),
        ("bg", &c.bg),
        ("surface", &c.surface),
        ("surface3", &c.surface3),
        ("border", &c.border),
        ("text", &c.text),
        ("text2", &c.text2),
        ("text3", &c.text3),
        ("danger", &c.danger),
        ("safe", &c.safe),
    ]
}

/// Parse a pasted theme: `{ "name", "colors": {..} }`, or a bare colors
/// object. Unknown keys are ignored; every known slot must hold a parseable
/// color.
pub fn parse_theme_json(s: &str) -> Result<ThemeDefinition, String> {
    let v: serde_json::Value = serde_json::from_str(s).map_err(|e| format!("invalid JSON: {e}"))?;
    let obj = v.as_object().ok_or("expected a JSON object")?;
    let colors_val = match obj.get("colors") {
        Some(c) => c.clone(),
        None => v.clone(),
    };
    let colors: ThemeColors = serde_json::from_value(colors_val)
        .map_err(|e| format!("colors must map slot names to strings: {e}"))?;
    if slots(&colors).iter().all(|(_, v)| v.is_none()) {
        return Err("no colors found (expected slots like a0, bg, surface, text)".to_string());
    }
    for (slot, val) in slots(&colors) {
        if let Some(raw) = val {
            if parse_color(raw).is_none() {
                return Err(format!("invalid color for {slot}: {raw:?}"));
            }
        }
    }
    let name = obj
        .get("name")
        .and_then(|n| n.as_str())
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .unwrap_or("Custom")
        .to_string();
    Ok(ThemeDefinition {
        id: String::new(),
        name,
        colors,
    })
}

/// A palette as an exportable theme definition.
pub fn palette_to_theme(p: &Palette) -> ThemeDefinition {
    let rgba = |c: [u8; 4]| {
        format!(
            "rgba({}, {}, {}, {:.3})",
            c[0],
            c[1],
            c[2],
            f32::from(c[3]) / 255.0
        )
    };
    ThemeDefinition {
        id: String::new(),
        name: "Exported".to_string(),
        colors: ThemeColors {
            a0: Some(format!("{}, {}, {}", p.a0[0], p.a0[1], p.a0[2])),
            bg: Some(hex(p.bg)),
            surface: Some(hex(p.surface)),
            surface3: Some(hex(p.surface3)),
            border: Some(rgba(p.border)),
            text: Some(hex(p.text)),
            text2: Some(rgba(p.text2)),
            text3: Some(rgba(p.text3)),
            danger: Some(hex(p.danger)),
            safe: Some(hex(p.safe)),
        },
    }
}

fn preview_palette(cfg: &Config, id: &str) -> Palette {
    let c = Config {
        theme_id: id.to_string(),
        theme: ThemePref::Dark,
        custom_theme: cfg.custom_theme.clone(),
        ..Config::default()
    };
    resolve_palette(&c, PREVIEW_ACCENT, true)
}

/// Follow-up work after a settings edit. Does nothing when `before` equals
/// the current config.
pub fn apply_config_change(sh: &mut Shared, before: &Config, emit: &mut Vec<Command>) {
    if sh.config == *before {
        return;
    }
    sh.dirty_config = true;
    let now = &sh.config;
    if now.theme != before.theme
        || now.theme_id != before.theme_id
        || now.custom_theme != before.custom_theme
    {
        sh.palette_dirty = true;
    }
    if now.alert_type_overrides != before.alert_type_overrides
        || now.storm_polygons_enabled != before.storm_polygons_enabled
    {
        sh.bump_alerts();
    }
    for (name, was, is) in [
        (
            "spc",
            before.spc_outlook_enabled,
            sh.config.spc_outlook_enabled,
        ),
        ("md", before.radar.md_polygons, sh.config.radar.md_polygons),
    ] {
        if is && !was {
            // Re-using `:layer ... on` kicks off the SPC fetch when there is no data yet.
            emit.push(Command::Layer {
                name: name.to_string(),
                on: Some(true),
            });
        }
    }
    if sh.config.libre_wxr_host != before.libre_wxr_host {
        emit.push(Command::Set {
            key: "librewxrhost".to_string(),
            value: sh.config.libre_wxr_host.clone(),
        });
    }
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

fn mono(text: impl Into<String>, color: egui::Color32) -> RichText {
    RichText::new(text.into()).monospace().color(color)
}

fn section(ui: &mut Ui, p: &Palette, title: &str) {
    ui.add_space(8.0);
    ui.label(mono(format!("-- {title} --"), c32(p.a0)));
    ui.add_space(2.0);
}

fn note(ui: &mut Ui, p: &Palette, text: &str) {
    ui.add(egui::Label::new(mono(text, c32a(p.text3))).wrap());
}

fn label(ui: &mut Ui, p: &Palette, text: &str) {
    ui.label(mono(text, c32a(p.text2)));
}

fn enum_combo<T: Copy + PartialEq>(ui: &mut Ui, id: &str, cur: &mut T, opts: &[(T, &str)]) {
    let text = opts
        .iter()
        .find(|(v, _)| v == cur)
        .map(|(_, l)| *l)
        .unwrap_or("?");
    egui::ComboBox::from_id_salt(id)
        .selected_text(text)
        .show_ui(ui, |ui| {
            for (v, l) in opts {
                ui.selectable_value(cur, *v, *l);
            }
        });
}

fn secret_field(ui: &mut Ui, val: &mut Option<String>, reveal: &mut bool) {
    let mut s = val.clone().unwrap_or_default();
    ui.horizontal(|ui| {
        ui.add(
            egui::TextEdit::singleline(&mut s)
                .password(!*reveal)
                .font(egui::TextStyle::Monospace)
                .desired_width(240.0),
        );
        ui.checkbox(reveal, "show");
    });
    let new = opt_string(&s);
    if new != *val {
        *val = new;
    }
}

pub fn settings_ui(
    ui: &mut Ui,
    sh: &mut Shared,
    p: &Palette,
    st: &mut SettingsState,
    emit: &mut Vec<Command>,
) {
    let before = sh.config.clone();
    ui.horizontal_wrapped(|ui| {
        for t in Tab::ALL {
            let sel = st.tab == t;
            let color = if sel { c32(p.a0) } else { c32a(p.text2) };
            let text = mono(format!("[ {} ]", t.label()), color);
            if ui.selectable_label(sel, text).clicked() {
                st.tab = t;
            }
        }
    });
    ui.separator();
    egui::ScrollArea::vertical()
        .id_salt("settings_scroll")
        .auto_shrink([false, false])
        .show(ui, |ui| match st.tab {
            Tab::General => general_tab(ui, &mut sh.config, p, st),
            Tab::Sources => sources_tab(ui, &mut sh.config, p, st),
            Tab::Radar => radar_tab(ui, sh, p, st),
            Tab::Alerts => alerts_tab(ui, &mut sh.config, p, st),
            Tab::Radio => radio_tab(ui, &mut sh.config, p),
            Tab::Themes => themes_tab(ui, sh, p, st),
            Tab::Developer => developer_tab(ui, sh, p, st, emit),
            Tab::About => about_tab(ui, sh, p),
        });
    apply_config_change(sh, &before, emit);
}

fn general_tab(ui: &mut Ui, cfg: &mut Config, p: &Palette, st: &mut SettingsState) {
    egui::Grid::new("general_grid")
        .num_columns(2)
        .spacing([12.0, 6.0])
        .show(ui, |ui| {
            label(ui, p, "provider");
            enum_combo(
                ui,
                "provider",
                &mut cfg.provider,
                &[
                    (WeatherProviderId::OpenMeteo, "Open-Meteo"),
                    (WeatherProviderId::AccuWeather, "AccuWeather"),
                ],
            );
            ui.end_row();

            label(ui, p, "units");
            enum_combo(
                ui,
                "units",
                &mut cfg.units,
                &[(UnitPref::F, "Fahrenheit"), (UnitPref::C, "Celsius")],
            );
            ui.end_row();

            label(ui, p, "time format");
            enum_combo(
                ui,
                "time_format",
                &mut cfg.time_format,
                &[(TimeFormat::H12, "12-hour"), (TimeFormat::H24, "24-hour")],
            );
            ui.end_row();

            label(ui, p, "appearance");
            let applies = theme_pref_applies(cfg);
            ui.add_enabled_ui(applies, |ui| {
                enum_combo(
                    ui,
                    "theme_pref",
                    &mut cfg.theme,
                    &[
                        (ThemePref::System, "System"),
                        (ThemePref::Light, "Light"),
                        (ThemePref::Dark, "Dark"),
                    ],
                );
            });
            ui.end_row();

            label(ui, p, "auto refresh");
            let cur = cfg.auto_refresh_minutes;
            let text = if cur == 0 {
                "Off".to_string()
            } else {
                format!("{cur} min")
            };
            egui::ComboBox::from_id_salt("auto_refresh")
                .selected_text(text)
                .show_ui(ui, |ui| {
                    for m in REFRESH_CHOICES {
                        let l = if m == 0 {
                            "Off".to_string()
                        } else {
                            format!("{m} min")
                        };
                        ui.selectable_value(&mut cfg.auto_refresh_minutes, m, l);
                    }
                });
            ui.end_row();
        });
    if !theme_pref_applies(cfg) {
        note(
            ui,
            p,
            "appearance is ignored while a named theme is selected (see THEMES)",
        );
    }
    if cfg.provider == WeatherProviderId::AccuWeather {
        section(ui, p, "ACCUWEATHER");
        label(ui, p, "api key");
        secret_field(ui, &mut cfg.accu_weather_api_key, &mut st.show_accu);
        if cfg.accu_weather_api_key.is_none() {
            note(ui, p, "AccuWeather needs an API key to return data");
        }
    }
    section(ui, p, "BEHAVIOUR");
    ui.checkbox(&mut cfg.notifications_enabled, "desktop notifications");
    ui.checkbox(&mut cfg.top_glow_enabled, "top glow bar");
    ui.checkbox(
        &mut cfg.storm_polygons_enabled,
        "emphasised storm polygons on the radar",
    );
}

fn sources_tab(ui: &mut Ui, cfg: &mut Config, p: &Palette, st: &mut SettingsState) {
    section(ui, p, "WILLYWEATHER");
    secret_field(ui, &mut cfg.willy_weather_api_key, &mut st.show_willy);
    note(ui, p, "api key; enables BOM (Australia) warnings");

    section(ui, p, "LIBREWXR RADAR HOST");
    let mut buf = st
        .host_buf
        .clone()
        .unwrap_or_else(|| cfg.libre_wxr_host.clone());
    let resp = ui.add(
        egui::TextEdit::singleline(&mut buf)
            .font(egui::TextStyle::Monospace)
            .desired_width(320.0),
    );
    if resp.changed() {
        st.host_buf = Some(buf);
    }
    if resp.lost_focus() {
        if let Some(b) = st.host_buf.take() {
            let host = b.trim().trim_end_matches('/').to_string();
            if host.starts_with("http://") || host.starts_with("https://") {
                cfg.libre_wxr_host = host;
            }
        }
    }
    note(
        ui,
        p,
        "http(s) URL; applied when the box loses focus (invalid values are discarded)",
    );

    section(ui, p, "OPENWEATHERMAP");
    secret_field(ui, &mut cfg.open_weather_map_api_key, &mut st.show_owm);
    note(ui, p, "api key; enables the radar overlay layers");
}

fn radar_tab(ui: &mut Ui, sh: &mut Shared, p: &Palette, st: &mut SettingsState) {
    let schemes: Vec<(u8, String)> = match sh.weather_maps.as_ref() {
        Some(m) if !m.color_schemes.is_empty() => m
            .color_schemes
            .iter()
            .map(|s| (s.id, s.name.clone()))
            .collect(),
        _ => ss_net::librewxr::default_color_schemes()
            .into_iter()
            .map(|s| (s.id, s.name))
            .collect(),
    };
    let key_set = sh
        .config
        .open_weather_map_api_key
        .as_deref()
        .is_some_and(|k| !k.trim().is_empty());
    let cfg = &mut sh.config;

    section(ui, p, "COMPOSITE RADAR");
    egui::Grid::new("radar_grid")
        .num_columns(2)
        .spacing([12.0, 6.0])
        .show(ui, |ui| {
            label(ui, p, "color scheme");
            let opts: Vec<(u8, &str)> = schemes.iter().map(|(i, n)| (*i, n.as_str())).collect();
            let cur = cfg.radar.color_scheme;
            let text = opts
                .iter()
                .find(|(i, _)| *i == cur)
                .map(|(_, n)| n.to_string())
                .unwrap_or_else(|| format!("scheme {cur}"));
            egui::ComboBox::from_id_salt("radar_scheme")
                .selected_text(text)
                .show_ui(ui, |ui| {
                    for (id, name) in &opts {
                        ui.selectable_value(&mut cfg.radar.color_scheme, *id, *name);
                    }
                });
            ui.end_row();

            label(ui, p, "opacity");
            ui.add(
                egui::Slider::new(&mut cfg.radar.opacity, 0.0..=1.0)
                    .custom_formatter(|v, _| format!("{:.0}%", v * 100.0))
                    .custom_parser(|s| {
                        s.trim()
                            .trim_end_matches('%')
                            .parse::<f64>()
                            .ok()
                            .map(|v| v / 100.0)
                    }),
            );
            ui.end_row();
        });
    ui.checkbox(&mut cfg.radar.smooth, "smooth tiles");
    ui.checkbox(&mut cfg.radar.snow, "snow");
    ui.checkbox(&mut cfg.radar.show_arrows, "storm motion arrows");
    ui.checkbox(&mut cfg.radar.show_cells, "storm cell markers");
    ui.checkbox(&mut cfg.radar.nowcast, "include nowcast frames");
    ui.checkbox(&mut cfg.radar.legend, "legend");

    section(ui, p, "LAYERS");
    ui.checkbox(&mut cfg.radar.show_polygons, "alert polygons");
    ui.checkbox(&mut cfg.radar.viewport_alerts, "Alerts in view");
    ui.checkbox(&mut cfg.radar.satellite, "IR satellite");
    ui.checkbox(&mut cfg.spc_outlook_enabled, "SPC Day 1 convective outlook");
    ui.checkbox(&mut cfg.radar.md_polygons, "SPC mesoscale discussions");
    ui.checkbox(&mut cfg.radar.wind_barbs, "wind barbs (METAR)");
    ui.checkbox(&mut cfg.radar.show_stations, "radar sites");

    section(ui, p, "NEXRAD SINGLE SITE");
    let mut buf = st
        .site_buf
        .clone()
        .unwrap_or_else(|| cfg.radar.nexrad_site.clone().unwrap_or_default());
    ui.horizontal(|ui| {
        label(ui, p, "site id");
        let resp = ui.add(
            egui::TextEdit::singleline(&mut buf)
                .font(egui::TextStyle::Monospace)
                .desired_width(80.0),
        );
        if resp.changed() {
            st.site_buf = Some(buf.clone());
        }
        if resp.lost_focus() {
            st.site_buf = None;
            cfg.radar.nexrad_site = opt_string(&buf).map(|s| s.to_ascii_uppercase());
        }
    });
    note(ui, p, "e.g. KFSX; blank uses the composite radar");
    ui.horizontal(|ui| {
        label(ui, p, "product");
        let opts: Vec<(RadarProduct, &str)> =
            RadarProduct::ALL.iter().map(|p| (*p, p.label())).collect();
        enum_combo(ui, "radar_product", &mut cfg.radar.nexrad_product, &opts);
    });

    section(ui, p, "OPENWEATHERMAP OVERLAYS");
    ui.checkbox(&mut cfg.radar.owm_wind, "wind");
    ui.checkbox(&mut cfg.radar.owm_temp, "temperature");
    ui.checkbox(&mut cfg.radar.owm_precip, "precipitation");
    ui.checkbox(&mut cfg.radar.aqi_badge, "air quality badge");
    if !key_set {
        note(
            ui,
            p,
            "set an OpenWeatherMap API key in SOURCES to enable these overlays",
        );
    }
}

fn alerts_tab(ui: &mut Ui, cfg: &mut Config, p: &Palette, st: &mut SettingsState) {
    ui.horizontal(|ui| {
        label(ui, p, "filter");
        ui.add(
            egui::TextEdit::singleline(&mut st.alert_filter)
                .font(egui::TextStyle::Monospace)
                .desired_width(200.0),
        );
        if ui.button("reset all").clicked() {
            cfg.alert_type_overrides.clear();
        }
    });
    note(
        ui,
        p,
        "color, visibility and reset per class. Hidden classes are dropped everywhere.",
    );
    ui.add_space(4.0);
    let f = st.alert_filter.trim().to_lowercase();
    for (class, name, _) in ALL_CLASSES {
        if !f.is_empty() && !class.contains(&f) && !name.to_lowercase().contains(&f) {
            continue;
        }
        let mut rgb = effective_color(class, &cfg.alert_type_overrides);
        let mut vis = effective_visible(class, &cfg.alert_type_overrides);
        ui.horizontal(|ui| {
            if egui::color_picker::color_edit_button_srgb(ui, &mut rgb).changed() {
                set_override_color(&mut cfg.alert_type_overrides, class, rgb);
            }
            if ui.checkbox(&mut vis, "").changed() {
                set_override_visible(&mut cfg.alert_type_overrides, class, vis);
            }
            let has = cfg.alert_type_overrides.contains_key(*class);
            if ui.add_enabled(has, egui::Button::new("reset")).clicked() {
                reset_override(&mut cfg.alert_type_overrides, class);
            }
            ui.label(mono(*name, c32(p.text)));
            ui.label(mono(*class, c32a(p.text3)));
        });
    }
}

fn radio_tab(ui: &mut Ui, cfg: &mut Config, p: &Palette) {
    section(ui, p, "WEATHER RADIO");
    ui.checkbox(&mut cfg.weather_radio_enabled, "weather radio enabled");
    egui::Grid::new("radio_grid")
        .num_columns(2)
        .spacing([12.0, 6.0])
        .show(ui, |ui| {
            label(ui, p, "mode");
            enum_combo(
                ui,
                "radio_mode",
                &mut cfg.weather_radio_mode,
                &[
                    (RadioMode::Simulated, "Simulated"),
                    (RadioMode::Live, "Live"),
                ],
            );
            ui.end_row();
            label(ui, p, "live feed");
            enum_combo(
                ui,
                "radio_feed",
                &mut cfg.weather_radio_live_feed_mode,
                &[
                    (LiveFeedMode::Auto, "Auto"),
                    (LiveFeedMode::Manual, "Manual"),
                ],
            );
            ui.end_row();
        });
    if cfg.weather_radio_live_feed_mode == LiveFeedMode::Manual {
        let mut url = cfg
            .weather_radio_live_stream_url
            .clone()
            .unwrap_or_default();
        ui.horizontal(|ui| {
            label(ui, p, "stream url");
            ui.add(
                egui::TextEdit::singleline(&mut url)
                    .font(egui::TextStyle::Monospace)
                    .desired_width(300.0),
            );
        });
        let new = opt_string(&url);
        if new != cfg.weather_radio_live_stream_url {
            cfg.weather_radio_live_stream_url = new;
        }
    }

    section(ui, p, "SPOKEN ALERTS (TTS)");
    ui.checkbox(&mut cfg.tts_alerts_enabled, "read new alerts aloud");
    egui::Grid::new("tts_grid")
        .num_columns(2)
        .spacing([12.0, 6.0])
        .show(ui, |ui| {
            label(ui, p, "severity");
            enum_combo(
                ui,
                "tts_filter",
                &mut cfg.tts_severity_filter,
                &[
                    (TtsSeverityFilter::ExtremeOnly, "Extreme only"),
                    (TtsSeverityFilter::SevereAndUp, "Severe and up"),
                    (TtsSeverityFilter::ModerateAndUp, "Moderate and up"),
                    (TtsSeverityFilter::All, "All"),
                ],
            );
            ui.end_row();
            label(ui, p, "rate");
            let mut r = cfg.tts_rate;
            if ui
                .add(egui::Slider::new(&mut r, 0.5..=2.0).step_by(0.05))
                .changed()
            {
                cfg.tts_rate = r.clamp(0.5, 2.0);
            }
            ui.end_row();
        });
    ui.checkbox(
        &mut cfg.tts_attention_tone,
        "attention tone before each alert",
    );
    ui.checkbox(
        &mut cfg.tts_all_saved_locations,
        "announce alerts for all saved locations",
    );
}

fn swatches(ui: &mut Ui, p: &Palette) {
    for c in [p.bg, p.surface, p.a0, p.text, p.danger] {
        let (r, _) = ui.allocate_exact_size(egui::vec2(14.0, 14.0), egui::Sense::hover());
        ui.painter().rect_filled(r, 0.0, c32(c));
        ui.painter().rect_stroke(
            r,
            0.0,
            egui::Stroke::new(1.0, egui::Color32::from_gray(90)),
            egui::StrokeKind::Inside,
        );
    }
}

fn themes_tab(ui: &mut Ui, sh: &mut Shared, p: &Palette, st: &mut SettingsState) {
    let mut ids: Vec<(String, String)> =
        vec![("default".into(), "Default (condition accent)".into())];
    ids.extend(builtin_themes().into_iter().map(|t| (t.id, t.name)));
    if let Some(c) = &sh.config.custom_theme {
        ids.push(("custom".into(), format!("Custom: {}", c.name)));
    }
    for (id, name) in &ids {
        let sel = sh.config.theme_id == *id;
        let pv = preview_palette(&sh.config, id);
        ui.horizontal(|ui| {
            let color = if sel { c32(p.a0) } else { c32a(p.text2) };
            if ui
                .selectable_label(sel, mono(name.as_str(), color))
                .clicked()
            {
                sh.config.theme_id = id.clone();
            }
            swatches(ui, &pv);
        });
    }

    section(ui, p, "CUSTOM THEME");
    note(
        ui,
        p,
        "paste theme JSON: {\"name\": \"..\", \"colors\": {\"a0\": \"255, 45, 155\", \"bg\": \"#180510\"}}",
    );
    ui.add(
        egui::TextEdit::multiline(&mut st.theme_json)
            .font(egui::TextStyle::Monospace)
            .desired_rows(6)
            .desired_width(f32::INFINITY),
    );
    let mut parsed: Option<Result<ThemeDefinition, String>> = None;
    ui.horizontal(|ui| {
        if ui.button("Apply JSON").clicked() {
            parsed = Some(parse_theme_json(&st.theme_json));
        }
        if ui.button("Export current theme").clicked() {
            let json =
                serde_json::to_string_pretty(&palette_to_theme(&sh.palette)).unwrap_or_default();
            ui.ctx().copy_text(json);
            st.notice = Some((false, "current theme copied to the clipboard".to_string()));
        }
    });
    ui.horizontal(|ui| {
        label(ui, p, "file");
        ui.add(
            egui::TextEdit::singleline(&mut st.theme_path)
                .font(egui::TextStyle::Monospace)
                .desired_width(260.0),
        );
        if ui.button("Load file").clicked() {
            match std::fs::read_to_string(st.theme_path.trim()) {
                Ok(text) => {
                    st.theme_json = text;
                    parsed = Some(parse_theme_json(&st.theme_json));
                }
                Err(e) => st.notice = Some((true, format!("cannot read file: {e}"))),
            }
        }
    });
    match parsed {
        Some(Ok(def)) => {
            st.notice = Some((false, format!("applied custom theme {:?}", def.name)));
            sh.config.custom_theme = Some(def);
            sh.config.theme_id = "custom".to_string();
        }
        Some(Err(e)) => st.notice = Some((true, e)),
        None => {}
    }
    if let Some((is_err, text)) = &st.notice {
        let c = if *is_err { c32(p.danger) } else { c32(p.safe) };
        ui.add(egui::Label::new(mono(text.as_str(), c)).wrap());
    }
}

fn developer_tab(
    ui: &mut Ui,
    sh: &mut Shared,
    p: &Palette,
    st: &mut SettingsState,
    emit: &mut Vec<Command>,
) {
    ui.checkbox(&mut sh.config.dev_tools_enabled, "enable developer tools");
    if !sh.config.dev_tools_enabled {
        return;
    }
    section(ui, p, "DEMO ALERTS");
    st.demo_group = st.demo_group.min(DEMO_GROUPS.len().saturating_sub(1));
    st.demo_item = st
        .demo_item
        .min(DEMO_GROUPS[st.demo_group].items.len().saturating_sub(1));
    ui.horizontal(|ui| {
        egui::ComboBox::from_id_salt("demo_group")
            .selected_text(DEMO_GROUPS[st.demo_group].name)
            .show_ui(ui, |ui| {
                for (i, g) in DEMO_GROUPS.iter().enumerate() {
                    if ui.selectable_value(&mut st.demo_group, i, g.name).changed() {
                        st.demo_item = 0;
                    }
                }
            });
        let group = &DEMO_GROUPS[st.demo_group];
        let item = group.items.get(st.demo_item).map(|(e, _)| *e).unwrap_or("");
        egui::ComboBox::from_id_salt("demo_item")
            .selected_text(item)
            .show_ui(ui, |ui| {
                for (i, (e, _)) in group.items.iter().enumerate() {
                    ui.selectable_value(&mut st.demo_item, i, *e);
                }
            });
        if ui.button("Add alert").clicked() && !item.is_empty() {
            emit.push(Command::Demo {
                group: Some(item.to_string()),
            });
        }
    });
    ui.horizontal(|ui| {
        let idle = sh.asteroid.is_none();
        if ui
            .add_enabled(idle, egui::Button::new("Asteroid impact warning"))
            .clicked()
        {
            emit.push(Command::Asteroid);
        }
        if ui.button("Clear demo alerts").clicked() {
            sh.demo_alerts.clear();
            sh.asteroid = None;
            sh.bump_alerts();
        }
    });
    label(
        ui,
        p,
        &format!("active demo alerts: {}", sh.demo_alerts.len()),
    );
}

fn about_tab(ui: &mut Ui, sh: &Shared, p: &Palette) {
    ui.label(mono(
        format!("Silver Skies {}", env!("CARGO_PKG_VERSION")),
        c32(p.a0),
    ));
    let dir = sh
        .data_dir
        .as_ref()
        .map(|d| d.display().to_string())
        .unwrap_or_else(|| "(unknown)".to_string());
    label(ui, p, &format!("data directory  {dir}"));
    ui.horizontal(|ui| {
        label(ui, p, "repository");
        ui.hyperlink_to(mono(REPO_URL, c32(p.a0)), REPO_URL);
    });
    section(ui, p, "KEY COMMANDS");
    for l in [
        ":help              list commands",
        ":goto <place>      search and select a location",
        ":refresh           reload forecasts and alerts",
        ":theme <id>        switch theme",
        ":set <key> <val>   change a setting",
        ":settings          open this window",
    ] {
        label(ui, p, l);
    }
    ui.add_space(8.0);
    egui::CollapsingHeader::new(mono("raw config (secrets masked)", c32a(p.text2)))
        .id_salt("raw_config")
        .show(ui, |ui| {
            ui.label(mono(config_text(&sh.config), c32a(p.text3)));
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use ss_core::{LocationsFile, SessionFile};

    fn shared() -> Shared {
        Shared::new(
            Config::default(),
            LocationsFile::default(),
            SessionFile::default(),
        )
    }

    const CLASS: &str = "alert-tornado-warning";

    #[test]
    fn override_color_is_minimal() {
        let mut m = BTreeMap::new();
        set_override_color(&mut m, CLASS, [1, 2, 3]);
        assert_eq!(m[CLASS].color.as_deref(), Some("#010203"));
        assert_eq!(m[CLASS].visible, None);
        // Back to the default colour removes the entry entirely.
        set_override_color(&mut m, CLASS, class_color(CLASS));
        assert!(m.is_empty());
    }

    #[test]
    fn override_visible_is_minimal() {
        let mut m = BTreeMap::new();
        set_override_visible(&mut m, CLASS, false);
        assert_eq!(m[CLASS].visible, Some(false));
        assert_eq!(m[CLASS].color, None);
        set_override_color(&mut m, CLASS, [9, 9, 9]);
        set_override_visible(&mut m, CLASS, true);
        assert_eq!(m[CLASS].visible, None, "visible is the default");
        assert_eq!(m[CLASS].color.as_deref(), Some("#090909"));
        set_override_color(&mut m, CLASS, class_color(CLASS));
        assert!(m.is_empty());
        set_override_visible(&mut m, CLASS, true);
        assert!(m.is_empty());
    }

    #[test]
    fn reset_removes_only_that_class() {
        let mut m = BTreeMap::new();
        set_override_visible(&mut m, CLASS, false);
        set_override_visible(&mut m, "eccc-red", false);
        reset_override(&mut m, CLASS);
        assert_eq!(m.len(), 1);
        assert!(m.contains_key("eccc-red"));
    }

    #[test]
    fn empty_keys_become_none() {
        assert_eq!(opt_string("  "), None);
        assert_eq!(opt_string(" abc "), Some("abc".into()));
    }

    #[test]
    fn theme_pref_ignored_for_named_themes() {
        let mut c = Config::default();
        assert!(theme_pref_applies(&c));
        c.theme_id = builtin_themes()[0].id.clone();
        assert!(!theme_pref_applies(&c));
        c.theme_id = "custom".into();
        assert!(theme_pref_applies(&c), "custom without a theme falls back");
        c.custom_theme = Some(parse_theme_json(r##"{"bg":"#000"}"##).unwrap());
        assert!(!theme_pref_applies(&c));
    }

    #[test]
    fn theme_json_full_and_partial() {
        let t = parse_theme_json(
            r##"{"name":"Mine","colors":{"a0":"255, 45, 155","bg":"#180510","extra":"x"},"other":1}"##,
        )
        .unwrap();
        assert_eq!(t.name, "Mine");
        assert_eq!(t.colors.bg.as_deref(), Some("#180510"));
        assert_eq!(t.colors.text, None);
    }

    #[test]
    fn theme_json_without_name_or_wrapper() {
        let t = parse_theme_json(r##"{"colors":{"bg":"#000000"}}"##).unwrap();
        assert_eq!(t.name, "Custom");
        let t = parse_theme_json(r##"{"bg":"#000000","text":"rgb(1,2,3)"}"##).unwrap();
        assert_eq!(t.name, "Custom");
        assert_eq!(t.colors.text.as_deref(), Some("rgb(1,2,3)"));
    }

    #[test]
    fn theme_json_rejects_bad_input() {
        let e = parse_theme_json(r##"{"colors":{"bg":"#000","text":"nope"}}"##).unwrap_err();
        assert!(e.contains("text"), "{e}");
        assert!(parse_theme_json(r##"{"name":"x","colors":{}}"##).is_err());
        assert!(parse_theme_json(r##"{"name":"x"}"##).is_err());
        assert!(parse_theme_json("not json").is_err());
        assert!(parse_theme_json("[1]").is_err());
    }

    #[test]
    fn exported_theme_parses_back() {
        let p = ss_core::theme::dark_base();
        let json = serde_json::to_string_pretty(&palette_to_theme(&p)).unwrap();
        let def = parse_theme_json(&json).unwrap();
        assert_eq!(def.colors.bg.as_deref(), Some(hex(p.bg).as_str()));
    }

    #[test]
    fn unchanged_config_does_nothing() {
        let mut sh = shared();
        let before = sh.config.clone();
        let mut emit = Vec::new();
        let rev = sh.alerts_rev;
        apply_config_change(&mut sh, &before, &mut emit);
        assert!(!sh.dirty_config && !sh.palette_dirty);
        assert!(emit.is_empty());
        assert_eq!(sh.alerts_rev, rev);
    }

    #[test]
    fn plain_edit_only_marks_dirty() {
        let mut sh = shared();
        let before = sh.config.clone();
        sh.config.units = UnitPref::C;
        let mut emit = Vec::new();
        let rev = sh.alerts_rev;
        apply_config_change(&mut sh, &before, &mut emit);
        assert!(sh.dirty_config);
        assert!(!sh.palette_dirty);
        assert!(emit.is_empty());
        assert_eq!(sh.alerts_rev, rev);
    }

    #[test]
    fn theme_edit_marks_palette_dirty() {
        let mut sh = shared();
        let before = sh.config.clone();
        sh.config.theme_id = "custom".into();
        apply_config_change(&mut sh, &before, &mut Vec::new());
        assert!(sh.dirty_config && sh.palette_dirty);
    }

    #[test]
    fn override_and_host_edits_have_side_effects() {
        let mut sh = shared();
        let before = sh.config.clone();
        set_override_visible(&mut sh.config.alert_type_overrides, CLASS, false);
        sh.config.libre_wxr_host = "https://x.test".into();
        let mut emit = Vec::new();
        let rev = sh.alerts_rev;
        apply_config_change(&mut sh, &before, &mut emit);
        assert!(sh.dirty_config);
        assert_ne!(sh.alerts_rev, rev);
        assert_eq!(
            emit,
            vec![Command::Set {
                key: "librewxrhost".into(),
                value: "https://x.test".into()
            }]
        );
    }

    #[test]
    fn every_tab_renders_headless() {
        let mut sh = shared();
        sh.config.dev_tools_enabled = true;
        sh.config.provider = WeatherProviderId::AccuWeather;
        sh.config.weather_radio_live_feed_mode = LiveFeedMode::Manual;
        sh.config.custom_theme = Some(parse_theme_json(r##"{"bg":"#000"}"##).unwrap());
        sh.config.theme_id = "custom".into();
        let p = sh.palette;
        let ctx = egui::Context::default();
        for tab in Tab::ALL {
            let mut st = SettingsState {
                tab,
                ..Default::default()
            };
            let mut emit = Vec::new();
            let mut out = ctx.run_ui(egui::RawInput::default(), |ui| {
                settings_ui(ui, &mut sh, &p, &mut st, &mut emit);
            });
            out.textures_delta.clear();
            assert!(emit.is_empty(), "{tab:?} emitted {emit:?} without input");
        }
        assert!(
            !sh.dirty_config,
            "rendering alone must not dirty the config"
        );
    }
}

#[cfg(test)]
mod headless_probe {
    use super::*;
    #[test]
    fn every_tab_renders() {
        let mut sh = Shared::new(Config::default(), Default::default(), Default::default());
        let p = sh.palette;
        for t in Tab::ALL {
            let mut st = SettingsState {
                tab: t,
                ..Default::default()
            };
            let mut emit = Vec::new();
            let ctx = egui::Context::default();
            let mut out = ctx.run_ui(egui::RawInput::default(), |ui| {
                settings_ui(ui, &mut sh, &p, &mut st, &mut emit);
            });
            out.textures_delta.clear();
            eprintln!("tab {:?} ok", t);
        }
    }
}
