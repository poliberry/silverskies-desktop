use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::time::Duration;

use chrono::{Local, Utc};
use egui::{vec2, Align, Align2, Color32, FontId, Layout, RichText, Ui};
use ss_core::alerts::classify::{storm_tier, StormTier};
use ss_core::alerts::colors::effective_color;
use ss_core::command::{Command, RadarCmd};
use ss_core::theme::{brightness, parse_color};
use ss_core::{
    BBox, Geometry, PanelKind, RadarProduct, RadarSettings, SpcOutlookFeature, TimeFormat,
    WeatherMaps,
};
use ss_map::viewport::world_px_at;
use ss_map::{
    draw_color_legend, esri_basemap, radar_dbz_stops, Barb, Layer, LayerStack, MapWidget, Marker,
    MarkerKind, MarkerLayer, PolyItem, PolygonLayer, RangeRingLayer, RasterTileLayer, TileCache,
    TileId, WindBarbLayer, WmsImageLayer,
};
use ss_net::librewxr::{radar_tile_url, satellite_tile_url};
use ss_net::ncep;
use ss_net::nws::is_live;
use ss_net::owm::{self, OwmLayer};

use super::{Panel, PanelCx};
use crate::state::LogLevel;
use crate::theme::{c32, c32a};

/// Max native zoom of the LibreWXR radar / satellite tiles.
const TILE_MAX_ZOOM: u8 = 12;
const OWM_MAX_ZOOM: u8 = 10;
const MIN_SITE_ZOOM: f64 = 5.0;
const BARB_MIN_ZOOM: f64 = 6.0;
/// Below this zoom the viewport spans too much area to auto-load alerts.
const VIEWPORT_ALERTS_MIN_ZOOM: f64 = 4.0;
const FRAME_SECS: f64 = 0.8;
const BAR_H: f32 = 26.0;
const LAYERS_H: f32 = 26.0;
const LEGEND_H: f32 = 36.0;
const LAYERS_GAP: f32 = 4.0;

/// One frame of the composite radar loop.
#[derive(Debug, Clone, PartialEq)]
pub struct LoopFrame {
    pub time: i64,
    pub path: String,
    pub nowcast: bool,
}

/// Past frames followed by (optionally) nowcast frames.
pub fn loop_frames(maps: &WeatherMaps, include_nowcast: bool) -> Vec<LoopFrame> {
    let mut out: Vec<LoopFrame> = maps
        .radar_past
        .iter()
        .map(|f| LoopFrame {
            time: f.time,
            path: f.path.clone(),
            nowcast: false,
        })
        .collect();
    if include_nowcast {
        out.extend(maps.radar_nowcast.iter().map(|f| LoopFrame {
            time: f.time,
            path: f.path.clone(),
            nowcast: true,
        }));
    }
    out
}

/// Index of the last observed (non-nowcast) frame, 0 if there is none.
pub fn latest_observed_index(frames: &[LoopFrame]) -> usize {
    frames.iter().rposition(|f| !f.nowcast).unwrap_or(0)
}

/// Loop playback state (egui-free).
pub struct Playback {
    pub idx: usize,
    pub playing: bool,
    pub tracking_live: bool,
    last_advance: f64,
    prev_latest_time: Option<i64>,
}

impl Default for Playback {
    fn default() -> Self {
        Self::new()
    }
}

impl Playback {
    pub fn new() -> Self {
        Self {
            idx: 0,
            playing: false,
            tracking_live: true,
            last_advance: f64::NAN,
            prev_latest_time: None,
        }
    }

    /// Call every frame with the current loop and time in seconds.
    pub fn tick(&mut self, frames: &[LoopFrame], now: f64) {
        if frames.is_empty() {
            return;
        }
        let latest = latest_observed_index(frames);
        let latest_time = frames.get(latest).filter(|f| !f.nowcast).map(|f| f.time);
        if self.tracking_live && latest_time != self.prev_latest_time {
            self.idx = latest;
        }
        self.prev_latest_time = latest_time;
        self.idx = self.idx.min(frames.len() - 1);
        if self.playing {
            if self.last_advance.is_nan() {
                self.last_advance = now;
            } else if now - self.last_advance >= FRAME_SECS {
                self.idx = (self.idx + 1) % frames.len();
                self.last_advance = now;
            }
        }
    }

    pub fn step(&mut self, frames: &[LoopFrame], delta: i32) {
        self.tracking_live = false;
        if frames.is_empty() {
            return;
        }
        let n = frames.len() as i64;
        self.idx = (self.idx as i64 + i64::from(delta)).rem_euclid(n) as usize;
    }

    pub fn set_playing(&mut self, on: bool) {
        self.playing = on;
        if on {
            self.tracking_live = false;
            self.last_advance = f64::NAN;
        }
    }

    pub fn go_live(&mut self, frames: &[LoopFrame]) {
        self.idx = latest_observed_index(frames);
        self.tracking_live = true;
        self.playing = false;
    }

    pub fn scrub(&mut self, frames: &[LoopFrame], idx: usize) {
        self.tracking_live = false;
        self.idx = idx.min(frames.len().saturating_sub(1));
    }

    pub fn is_live(&self, frames: &[LoopFrame]) -> bool {
        !frames.is_empty()
            && self.idx == latest_observed_index(frames)
            && frames.get(self.idx).is_some_and(|f| !f.nowcast)
    }
}

/// Arrow / cell overlay style: light strokes on a dark palette, dark on a light one.
fn overlay_style(on: bool, dark: bool) -> Option<&'static str> {
    on.then_some(if dark { "light" } else { "dark" })
}

/// Tile-cache key for the composite radar layer; changes with every URL-affecting input.
pub fn radar_layer_key(path: &str, rs: &RadarSettings, dark: bool) -> String {
    format!(
        "radar:{path}:{}:{}{}:{}:{}",
        rs.color_scheme,
        u8::from(rs.smooth),
        u8::from(rs.snow),
        overlay_style(rs.show_arrows, dark).unwrap_or("-"),
        overlay_style(rs.show_cells, dark).unwrap_or("-"),
    )
}

/// SPC Day-1 outlook polygons, lowest risk first so higher risk draws on top.
pub fn spc_items(features: &[SpcOutlookFeature]) -> Vec<PolyItem> {
    let mut sorted: Vec<&SpcOutlookFeature> = features.iter().collect();
    sorted.sort_by_key(|f| f.level);
    sorted
        .into_iter()
        .map(|f| {
            let (fill, stroke) = (parse_color(&f.fill), parse_color(&f.stroke));
            PolyItem {
                id: format!("spc:{}:{}", f.code, f.level),
                geometry: f.geometry.clone(),
                fill: match fill {
                    Some([r, g, b, _]) => Color32::from_rgba_unmultiplied(r, g, b, 48),
                    None => Color32::from_rgba_unmultiplied(128, 128, 128, 48),
                },
                stroke: match stroke {
                    Some([r, g, b, _]) => Color32::from_rgb(r, g, b),
                    None => Color32::GRAY,
                },
                stroke_width: 1.5,
                pulse: false,
                label: Some(format!("SPC Day 1 outlook: {}", f.name)),
            }
        })
        .collect()
}

/// Is a new METAR wind request due for the view `cur`? `last` is the previous
/// request's bbox and time; `settled` means the view has been still for a moment.
pub fn wind_request_due(last: Option<(&BBox, f64)>, now: f64, cur: &BBox, settled: bool) -> bool {
    bbox_request_due(last, now, cur, settled, 300.0)
}

/// Generalised form of `wind_request_due`: a request is also due once the last one is
/// `max_age_secs` old.
pub fn bbox_request_due(
    last: Option<(&BBox, f64)>,
    now: f64,
    cur: &BBox,
    settled: bool,
    max_age_secs: f64,
) -> bool {
    let Some((prev, t)) = last else {
        return true;
    };
    if now - t >= max_age_secs {
        return true;
    }
    if !settled {
        return false;
    }
    let (w, h) = (cur.east - cur.west, cur.north - cur.south);
    let dx = ((cur.west + cur.east) - (prev.west + prev.east)).abs() / 2.0;
    let dy = ((cur.south + cur.north) - (prev.south + prev.north)).abs() / 2.0;
    if dx > 0.3 * w || dy > 0.3 * h {
        return true;
    }
    // A zoom change of one level or more means the width halved or doubled.
    let ratio = w / (prev.east - prev.west).max(1e-9);
    ratio <= 0.5 + 1e-9 || ratio >= 2.0 - 1e-9
}

pub struct RadarPanel {
    map: MapWidget,
    playback: Playback,
    dark: bool,
    positioned: bool,
    alerts_sig: u64,
    locations_sig: u64,
    stations_sig: u64,
    spc_sig: u64,
    md_sig: u64,
    barbs_sig: u64,
    nexrad_cfg: Option<(String, RadarProduct)>,
    last_wind_req: Option<(BBox, f64)>,
    last_alert_req: Option<(BBox, f64)>,
    view_sig: (u64, u64, u64),
    last_view_change: f64,
}

/// Zoom level that fits `bbox` inside a viewport of `size` pixels.
pub fn fit_zoom(bbox: &BBox, size: egui::Vec2) -> f64 {
    let (x0, y0) = world_px_at(bbox.west, bbox.north, 0.0);
    let (x1, y1) = world_px_at(bbox.east, bbox.south, 0.0);
    let dx = (x1 - x0).abs().max(1e-6);
    let dy = (y1 - y0).abs().max(1e-6);
    let zx = (f64::from(size.x.max(32.0)) * 0.7 / dx).log2();
    let zy = (f64::from(size.y.max(32.0)) * 0.7 / dy).log2();
    zx.min(zy).clamp(2.0, 12.0)
}

fn hash_of<T: Hash>(v: &T) -> u64 {
    let mut h = DefaultHasher::new();
    v.hash(&mut h);
    h.finish()
}

fn placeholder_raster(name: &str, max_zoom: u8, opacity: f32) -> RasterTileLayer {
    let mut l = RasterTileLayer::new(name, "", max_zoom, |_| String::new()).with_opacity(opacity);
    l.visible = false;
    l
}

fn nexrad_layer(site: &str, product: RadarProduct) -> WmsImageLayer {
    let site_lc = site.to_ascii_lowercase();
    WmsImageLayer::new(
        "nexrad",
        format!("nexrad:{site_lc}:{}", product.id()),
        120.0,
        move |bbox, w, h| ncep::wms_url(&site_lc, product, bbox, w, h),
    )
    .with_opacity(0.85)
}

/// Point a raster layer at a (possibly new) template; the URL closure is only
/// installed when the cache key changed.
fn sync_raster(
    layers: &mut LayerStack,
    name: &str,
    visible: bool,
    opacity: f32,
    key: Option<String>,
    f: impl Fn(TileId) -> String + Send + 'static,
) {
    if let Some(l) = layers.get_mut::<RasterTileLayer>(name) {
        l.visible = visible;
        l.opacity = opacity;
        if let (true, Some(key)) = (visible, key) {
            if l.key != key {
                l.set_template(key, f);
            }
        }
    }
}

impl RadarPanel {
    pub fn new(
        client: reqwest::Client,
        rt: tokio::runtime::Handle,
        tile_dir: Option<PathBuf>,
        ctx: egui::Context,
    ) -> Self {
        let cache = TileCache::new(client, rt, tile_dir, ctx);
        let mut map = MapWidget::new(cache);
        let l = &mut map.layers;
        l.push(esri_basemap(true));
        l.push(placeholder_raster("satellite", TILE_MAX_ZOOM, 0.75));
        l.push(placeholder_raster("radar", TILE_MAX_ZOOM, 0.7));
        l.push(placeholder_raster("owm-wind", OWM_MAX_ZOOM, 0.55));
        l.push(placeholder_raster("owm-temp", OWM_MAX_ZOOM, 0.55));
        l.push(placeholder_raster("owm-precip", OWM_MAX_ZOOM, 0.55));
        let mut nx = nexrad_layer("kxxx", RadarProduct::SrBref);
        nx.visible = false;
        l.push(nx);
        let mut ring =
            RangeRingLayer::new("range-ring", 0.0, 0.0, ncep::RANGE_RING_M, Color32::GRAY);
        ring.visible = false;
        l.push(ring);
        l.push(PolygonLayer::new("spc-outlook"));
        l.push(PolygonLayer::new("md"));
        l.push(PolygonLayer::new("alerts"));
        l.push(WindBarbLayer::new("barbs", Color32::GRAY));
        l.push(MarkerLayer::new("locations"));
        l.push(MarkerLayer::new("radar-sites"));
        Self {
            map,
            playback: Playback::new(),
            dark: true,
            positioned: false,
            alerts_sig: 0,
            locations_sig: 0,
            stations_sig: 0,
            spc_sig: 0,
            md_sig: 0,
            barbs_sig: 0,
            nexrad_cfg: None,
            last_wind_req: None,
            last_alert_req: None,
            view_sig: (0, 0, 0),
            last_view_change: 0.0,
        }
    }

    fn set_dark(&mut self, dark: bool) {
        self.dark = dark;
        self.map.dark = dark;
        self.map.layers.remove("basemap");
        self.map
            .layers
            .layers
            .insert(0, Box::new(esri_basemap(dark)) as Box<dyn Layer>);
    }
}

fn overlay_text(
    painter: &egui::Painter,
    pos: egui::Pos2,
    align: Align2,
    text: &str,
    color: Color32,
) {
    let font = FontId::monospace(11.0);
    painter.text(
        pos + vec2(1.0, 1.0),
        align,
        text,
        font.clone(),
        Color32::from_black_alpha(200),
    );
    painter.text(pos, align, text, font, color);
}

/// Topmost visible polygon under `pos` in the named layer: `(id, label)`.
fn hit_polygon(
    map: &mut MapWidget,
    name: &str,
    pos: egui::Pos2,
    rect: egui::Rect,
) -> Option<(String, Option<String>)> {
    let vp = &map.viewport;
    let layer = map.layers.get_mut::<PolygonLayer>(name)?;
    if !layer.visible {
        return None;
    }
    layer
        .hit_test(pos, vp, rect)
        .first()
        .map(|it| (it.id.clone(), it.label.clone()))
}

fn legend_stops(rs: &RadarSettings) -> Option<Vec<(Color32, &'static str)>> {
    let dbz = match &rs.nexrad_site {
        None => true,
        Some(_) => rs.nexrad_product == RadarProduct::SrBref,
    };
    (rs.legend && dbz).then(|| radar_dbz_stops(rs.color_scheme))
}

/// Color schemes for the layers row: the live index when loaded, else the
/// built-in list. Pure (no egui) so it can be unit tested.
pub fn scheme_options(maps: Option<&WeatherMaps>) -> Vec<(u8, String)> {
    match maps {
        Some(m) if !m.color_schemes.is_empty() => m
            .color_schemes
            .iter()
            .map(|s| (s.id, s.name.clone()))
            .collect(),
        _ => ss_net::librewxr::default_color_schemes()
            .into_iter()
            .map(|s| (s.id, s.name))
            .collect(),
    }
}

/// Layer toggle buttons for the floating box: `(label, active, command)`.
/// Pure (no egui) so it can be unit tested.
pub fn layer_toggles(rs: &RadarSettings) -> Vec<(&'static str, bool, Command)> {
    vec![
        (
            "SAT",
            rs.satellite,
            Command::Layer {
                name: "satellite".to_string(),
                on: Some(!rs.satellite),
            },
        ),
        (
            "PLY",
            rs.show_polygons,
            Command::Layer {
                name: "alerts".to_string(),
                on: Some(!rs.show_polygons),
            },
        ),
        (
            "ARW",
            rs.show_arrows,
            Command::Layer {
                name: "arrows".to_string(),
                on: Some(!rs.show_arrows),
            },
        ),
        (
            "CEL",
            rs.show_cells,
            Command::Layer {
                name: "cells".to_string(),
                on: Some(!rs.show_cells),
            },
        ),
        (
            "STN",
            rs.show_stations,
            Command::Layer {
                name: "sites".to_string(),
                on: Some(!rs.show_stations),
            },
        ),
        (
            "BRB",
            rs.wind_barbs,
            Command::Layer {
                name: "barbs".to_string(),
                on: Some(!rs.wind_barbs),
            },
        ),
    ]
}

impl Panel for RadarPanel {
    fn kind(&self) -> PanelKind {
        PanelKind::Radar
    }

    fn ui(&mut self, ui: &mut Ui, cx: &mut PanelCx) {
        let p = cx.palette;

        let dark = brightness(p.bg) < 128.0;
        if dark != self.dark {
            self.set_dark(dark);
        }
        self.map.units = match cx.shared.config.units {
            ss_core::UnitPref::F => ss_map::Units::Imperial,
            ss_core::UnitPref::C => ss_map::Units::Metric,
        };

        let rs = cx.shared.config.radar.clone();
        let now = ui.input(|i| i.time);
        let frames = cx
            .shared
            .weather_maps
            .as_ref()
            .map(|m| loop_frames(m, rs.nowcast))
            .unwrap_or_default();
        if let Some(on) = cx.req.radar_play.take() {
            self.playback.set_playing(on);
        }
        if let Some(d) = cx.req.radar_step.take() {
            self.playback.step(&frames, d);
        }
        if std::mem::take(&mut cx.req.radar_live) {
            self.playback.go_live(&frames);
        }
        self.playback.tick(&frames, now);
        if rs.nexrad_site.is_none() && self.playback.playing {
            ui.ctx().request_repaint_after(Duration::from_millis(100));
        }

        self.sync_layers(cx, &rs, &frames);
        self.handle_requests(cx);

        let stops = legend_stops(&rs);
        let spacing = ui.spacing().item_spacing.y;
        let mut below = BAR_H + spacing + LAYERS_H + spacing;
        if stops.is_some() {
            below += LEGEND_H + spacing;
        }
        let w = ui.available_width();
        let slot = cx.overlay;
        let overlay = slot.is_some();
        let map_h = if overlay {
            ui.available_height()
        } else {
            (ui.available_height() - below).max(64.0)
        };
        let r = ui.allocate_ui(vec2(w, map_h), |ui| self.map.show(ui)).inner;

        if let Some(slot) = slot {
            let box_h = 8.0
                + BAR_H
                + LAYERS_GAP
                + LAYERS_H
                + if stops.is_some() {
                    LAYERS_GAP + LEGEND_H
                } else {
                    0.0
                }
                + 8.0;
            let box_h = box_h.min(slot.height());
            let bx = egui::Rect::from_min_max(
                egui::pos2(slot.left(), slot.bottom() - box_h),
                slot.right_bottom(),
            );
            ui.painter().rect_filled(
                bx,
                0.0,
                Color32::from_rgba_unmultiplied(p.surface[0], p.surface[1], p.surface[2], 232),
            );
            ui.painter().rect_stroke(
                bx,
                0.0,
                egui::Stroke::new(1.0, c32a(p.border)),
                egui::StrokeKind::Inside,
            );
            // Block the map underneath the controls.
            ui.interact(
                bx,
                egui::Id::unique("radar_controls_card"),
                egui::Sense::click_and_drag(),
            );
            let inner = bx.shrink2(vec2(6.0, 4.0));
            let mut child = ui.new_child(
                egui::UiBuilder::new()
                    .id_salt("radar_controls_body")
                    .max_rect(inner)
                    .layout(Layout::top_down(Align::Min)),
            );
            child.set_clip_rect(bx.intersect(ui.clip_rect()));
            let inner_w = inner.width();
            child.allocate_ui_with_layout(
                vec2(inner_w, BAR_H),
                Layout::left_to_right(Align::Center),
                |ui| self.control_bar(ui, cx, &rs, &frames),
            );
            child.add_space(LAYERS_GAP);
            child.allocate_ui_with_layout(
                vec2(inner_w, LAYERS_H),
                Layout::left_to_right(Align::Center),
                |ui| self.layers_bar(ui, cx, &rs),
            );
            if let Some(s) = &stops {
                child.add_space(LAYERS_GAP);
                draw_color_legend(&mut child, "dBZ", s);
            }
        } else {
            ui.allocate_ui_with_layout(
                vec2(w, BAR_H),
                Layout::left_to_right(Align::Center),
                |ui| self.control_bar(ui, cx, &rs, &frames),
            );
            ui.add_space(LAYERS_GAP);
            ui.allocate_ui_with_layout(
                vec2(w, LAYERS_H),
                Layout::left_to_right(Align::Center),
                |ui| self.layers_bar(ui, cx, &rs),
            );
            if let Some(s) = &stops {
                ui.add_space(LAYERS_GAP);
                draw_color_legend(ui, "dBZ", s);
            }
        }

        // Overlay: active location + zoom, AQI badge.
        let label = cx
            .location
            .as_ref()
            .map(|l| l.label.clone())
            .unwrap_or_else(|| "no location".to_string());
        let painter = ui.painter_at(r.rect);
        let text = format!("{label}  z{:.1}", self.map.viewport.zoom);
        let (label_pos, label_align) = if overlay {
            (r.rect.center_top() + vec2(0.0, 6.0), Align2::CENTER_TOP)
        } else {
            (r.rect.left_top() + vec2(8.0, 6.0), Align2::LEFT_TOP)
        };
        overlay_text(&painter, label_pos, label_align, &text, c32(p.a0));
        if rs.aqi_badge {
            let key_blank = cx
                .shared
                .config
                .open_weather_map_api_key
                .as_deref()
                .is_none_or(|k| k.trim().is_empty());
            let text = if key_blank {
                "AQI: no API key".to_string()
            } else {
                match cx.shared.air_quality.get(cx.loc_id()) {
                    Some(a) => format!("AQI {} {}", a.aqi, a.label()),
                    None => "AQI: …".to_string(),
                }
            };
            let (aqi_pos, aqi_align) = if overlay {
                (r.rect.center_top() + vec2(0.0, 24.0), Align2::CENTER_TOP)
            } else {
                (r.rect.right_top() + vec2(-8.0, 6.0), Align2::RIGHT_TOP)
            };
            overlay_text(&painter, aqi_pos, aqi_align, &text, c32(p.a0));
        }
        self.map.layers.set_visible(
            "radar-sites",
            rs.show_stations && self.map.viewport.zoom >= MIN_SITE_ZOOM,
        );

        if rs.wind_barbs {
            self.request_winds(ui, cx, r.rect, now);
        }
        self.request_viewport_alerts(ui, cx, r.rect, now);

        // Hover tooltip: alerts first, then MD, then SPC outlook.
        if let Some(h) = r.response.hover_pos() {
            let tip = ["alerts", "md", "spc-outlook"]
                .iter()
                .find_map(|n| hit_polygon(&mut self.map, n, h, r.rect))
                .and_then(|(_, label)| label);
            if let Some(t) = tip {
                r.response.clone().on_hover_text_at_pointer(t);
            }
        }
        // Click: alert selection, or log an MD.
        if r.clicked.is_some() {
            if let Some(cp) = r.response.interact_pointer_pos() {
                if let Some((id, _)) = hit_polygon(&mut self.map, "alerts", cp, r.rect) {
                    cx.req.selected_alert_id = Some(id);
                } else if let Some((id, _)) = hit_polygon(&mut self.map, "md", cp, r.rect) {
                    let msg = cx.shared.mcd_alerts.iter().find(|a| a.id == id).map(|a| {
                        let head = a
                            .headline
                            .clone()
                            .unwrap_or_else(|| a.display_event.clone());
                        let lines: Vec<&str> = a
                            .description
                            .as_deref()
                            .unwrap_or("")
                            .lines()
                            .map(str::trim)
                            .filter(|l| !l.is_empty())
                            .take(3)
                            .collect();
                        if lines.is_empty() {
                            head
                        } else {
                            format!("{head}: {}", lines.join(" / "))
                        }
                    });
                    if let Some(m) = msg {
                        cx.shared.log(LogLevel::Info, m);
                    }
                }
            }
        }

        if r.selection_changed {
            cx.shared.selection_bbox = self.map.selected_bbox;
            if let Some(b) = self.map.selected_bbox {
                cx.shared.log(
                    LogLevel::Info,
                    format!(
                        "area selected: {:.2},{:.2} to {:.2},{:.2}; fetching alerts…",
                        b.south, b.west, b.north, b.east
                    ),
                );
                cx.tasks.area_alerts(b);
            }
        }
    }
}

fn mono_button(ui: &mut Ui, text: RichText) -> egui::Response {
    ui.add(egui::Button::new(text.monospace()))
}

fn frame_time_label(time: i64, fmt: TimeFormat) -> String {
    let Some(utc) = chrono::DateTime::from_timestamp(time, 0) else {
        return "--:--".to_string();
    };
    let local = utc.with_timezone(&Local);
    match fmt {
        TimeFormat::H12 => local.format("%I:%M %p").to_string(),
        TimeFormat::H24 => local.format("%H:%M").to_string(),
    }
}

impl RadarPanel {
    fn control_bar(
        &mut self,
        ui: &mut Ui,
        cx: &mut PanelCx,
        rs: &RadarSettings,
        frames: &[LoopFrame],
    ) {
        let p = cx.palette;
        if let Some(site) = &rs.nexrad_site {
            let station = cx
                .shared
                .radar_stations
                .iter()
                .find(|s| s.id.eq_ignore_ascii_case(site));
            let mut text = format!("NEXRAD {site} · {}", rs.nexrad_product.label());
            if let Some(s) = station {
                text.push_str(&format!(" · {}", s.name));
            }
            ui.label(RichText::new(text).monospace().color(c32(p.text)));
            if station.is_none() && !cx.shared.radar_stations.is_empty() {
                ui.label(
                    RichText::new("site not found")
                        .monospace()
                        .color(c32(p.danger)),
                );
            }
            if mono_button(ui, RichText::new("[COMPOSITE]")).clicked() {
                cx.emit.push(Command::Site(None));
            }
            return;
        }

        if frames.is_empty() {
            ui.label(
                RichText::new("radar: loading frames…")
                    .monospace()
                    .color(c32a(p.text3)),
            );
            return;
        }
        if mono_button(ui, RichText::new("[|◀]")).clicked() {
            self.playback.step(frames, -1);
        }
        let play = if self.playback.playing {
            "[❚❚]"
        } else {
            "[▶]"
        };
        if mono_button(ui, RichText::new(play)).clicked() {
            let on = !self.playback.playing;
            self.playback.set_playing(on);
        }
        if mono_button(ui, RichText::new("[▶|]")).clicked() {
            self.playback.step(frames, 1);
        }
        let live = self.playback.is_live(frames);
        let live_text = RichText::new("[LIVE]").monospace();
        let live_text = if live {
            live_text.color(c32(p.a0)).strong()
        } else {
            live_text
        };
        if ui.add(egui::Button::new(live_text)).clicked() {
            self.playback.go_live(frames);
        }

        let cur = self.playback.idx.min(frames.len() - 1);
        let mut idx = cur;
        ui.spacing_mut().slider_width = (ui.available_width() - 190.0).max(60.0);
        ui.add(egui::Slider::new(&mut idx, 0..=frames.len() - 1).show_value(false));
        if idx != cur {
            self.playback.scrub(frames, idx);
        }

        let f = &frames[self.playback.idx.min(frames.len() - 1)];
        ui.label(
            RichText::new(frame_time_label(f.time, cx.shared.config.time_format))
                .monospace()
                .color(c32(p.text)),
        );
        if f.nowcast {
            ui.label(RichText::new("NOWCAST").monospace().color(c32a(p.text3)));
        } else if live {
            ui.label(RichText::new("LIVE").monospace().color(c32(p.a0)));
        }
    }

    /// Second row of the floating box: color-scheme selector plus layer
    /// toggles. Emits `:radar scheme` / `:layer` commands so the changes go
    /// through the normal pipeline (dirty config + log). Wrapped in a
    /// horizontal scroll so the 240 px docked slot still fits everything.
    fn layers_bar(&mut self, ui: &mut Ui, cx: &mut PanelCx, rs: &RadarSettings) {
        let p = cx.palette;
        let schemes = scheme_options(cx.shared.weather_maps.as_ref());
        let cur_name = schemes
            .iter()
            .find(|(id, _)| *id == rs.color_scheme)
            .map(|(id, n)| format!("{id}:{n}"))
            .unwrap_or_else(|| format!("{}", rs.color_scheme));
        egui::ScrollArea::horizontal()
            .id_salt("radar_layers_scroll")
            .auto_shrink([false, true])
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    egui::ComboBox::from_id_salt("radar_scheme")
                        .selected_text(RichText::new(cur_name).monospace().size(11.0))
                        .width(92.0)
                        .show_ui(ui, |ui| {
                            for (id, name) in &schemes {
                                let sel = *id == rs.color_scheme;
                                if ui.selectable_label(sel, format!("{id}: {name}")).clicked()
                                    && !sel
                                {
                                    cx.emit.push(Command::Radar(RadarCmd::Scheme(*id)));
                                }
                            }
                        });
                    for (label, active, cmd) in layer_toggles(rs) {
                        let text = RichText::new(format!("[{label}]")).monospace();
                        let text = if active {
                            text.color(c32(p.a0)).strong()
                        } else {
                            text.color(c32a(p.text3))
                        };
                        if ui.add(egui::Button::new(text)).clicked() {
                            cx.emit.push(cmd);
                        }
                    }
                });
            });
    }

    /// Auto-load alerts for the visible area when the view moved or the data is old.
    /// Record viewport motion and report whether the view has been still for a second.
    fn track_view(&mut self, ui: &Ui, now: f64) -> bool {
        let v = &self.map.viewport;
        let sig = (
            v.center_lon.to_bits(),
            v.center_lat.to_bits(),
            v.zoom.to_bits(),
        );
        if sig != self.view_sig {
            self.view_sig = sig;
            self.last_view_change = now;
        }
        let settled = now - self.last_view_change >= 1.0;
        if !settled {
            ui.ctx().request_repaint_after(Duration::from_millis(1100));
        }
        settled
    }

    fn request_viewport_alerts(&mut self, ui: &Ui, cx: &mut PanelCx, rect: egui::Rect, now: f64) {
        if !cx.shared.config.radar.viewport_alerts {
            if !cx.shared.viewport_alerts.is_empty() {
                cx.shared.viewport_alerts.clear();
                cx.shared.viewport_alerts_bbox = None;
                cx.shared.bump_alerts();
            }
            self.last_alert_req = None;
            return;
        }
        let settled = self.track_view(ui, now);
        let v = &self.map.viewport;
        if v.zoom < VIEWPORT_ALERTS_MIN_ZOOM || v.is_animating() {
            return;
        }
        let bbox = v.visible_bbox(rect);
        let last = self.last_alert_req.as_ref().map(|(b, t)| (b, *t));
        if bbox_request_due(last, now, &bbox, settled, 120.0) {
            cx.tasks.viewport_alerts(bbox);
            self.last_alert_req = Some((bbox, now));
        }
    }

    /// Ask for fresh METAR winds when the view has moved or the data is old.
    fn request_winds(&mut self, ui: &Ui, cx: &mut PanelCx, rect: egui::Rect, now: f64) {
        let settled = self.track_view(ui, now);
        let v = &self.map.viewport;
        if v.zoom < BARB_MIN_ZOOM || v.is_animating() {
            return;
        }
        let bbox = v.visible_bbox(rect);
        let last = self.last_wind_req.as_ref().map(|(b, t)| (b, *t));
        if wind_request_due(last, now, &bbox, settled) {
            cx.tasks.wind_obs(bbox);
            self.last_wind_req = Some((bbox, now));
        }
    }
}

impl RadarPanel {
    /// Update layer visibility / templates and rebuild item layers whose inputs changed.
    fn sync_layers(&mut self, cx: &mut PanelCx, rs: &RadarSettings, frames: &[LoopFrame]) {
        let p = cx.palette;
        let sh = &*cx.shared;
        let overrides = &sh.config.alert_type_overrides;
        let host = sh.config.libre_wxr_host.trim_end_matches('/').to_string();
        let composite = rs.nexrad_site.is_none();
        let layers = &mut self.map.layers;

        // --- satellite ---
        let sat = sh
            .weather_maps
            .as_ref()
            .and_then(|m| m.satellite_infrared.last())
            .map(|f| f.path.clone());
        let sat_key = sat.as_ref().map(|path| format!("sat:{path}"));
        let (h, sp) = (host.clone(), sat.clone().unwrap_or_default());
        sync_raster(
            layers,
            "satellite",
            rs.satellite && sat.is_some(),
            0.75,
            sat_key,
            move |t| satellite_tile_url(&h, &sp, u32::from(t.z), t.x, t.y),
        );

        // --- composite radar (current loop frame) ---
        let cur = frames.get(self.playback.idx.min(frames.len().saturating_sub(1)));
        let (h, rsc, dark) = (host.clone(), rs.clone(), self.dark);
        let cur_path = cur.map(|f| f.path.clone()).unwrap_or_default();
        sync_raster(
            layers,
            "radar",
            composite && cur.is_some(),
            rs.opacity,
            cur.map(|f| radar_layer_key(&f.path, rs, dark)),
            move |t| {
                radar_tile_url(
                    &h,
                    &cur_path,
                    u32::from(t.z),
                    t.x,
                    t.y,
                    rsc.color_scheme,
                    rsc.smooth,
                    rsc.snow,
                    overlay_style(rsc.show_arrows, dark),
                    overlay_style(rsc.show_cells, dark),
                )
            },
        );

        // --- OpenWeatherMap tiles ---
        let owm_key = sh
            .config
            .open_weather_map_api_key
            .as_deref()
            .unwrap_or("")
            .trim()
            .to_string();
        for (name, on, which) in [
            ("owm-wind", rs.owm_wind, OwmLayer::Wind),
            ("owm-temp", rs.owm_temp, OwmLayer::Temp),
            ("owm-precip", rs.owm_precip, OwmLayer::Precip),
        ] {
            let vis = on && !owm_key.is_empty();
            let k = owm_key.clone();
            sync_raster(
                layers,
                name,
                vis,
                0.55,
                Some(format!("{name}:{}", owm_key.len())),
                move |t| owm::tile_url(which, u32::from(t.z), t.x, t.y, &k),
            );
        }

        // --- NEXRAD single-site WMS + range ring ---
        let wanted = rs
            .nexrad_site
            .as_ref()
            .map(|s| (s.to_ascii_uppercase(), rs.nexrad_product));
        if wanted != self.nexrad_cfg {
            if let Some((site, product)) = &wanted {
                if let Some(pos) = layers.layers.iter().position(|l| l.name() == "nexrad") {
                    layers.layers[pos] = Box::new(nexrad_layer(site, *product));
                }
                if let Some(l) = layers.get_mut::<WmsImageLayer>("nexrad") {
                    l.reset();
                }
            }
            self.nexrad_cfg = wanted.clone();
        }
        layers.set_visible("nexrad", wanted.is_some());
        let station = wanted.as_ref().and_then(|(site, _)| {
            sh.radar_stations
                .iter()
                .find(|s| s.id.eq_ignore_ascii_case(site))
        });
        if let Some(l) = layers.get_mut::<RangeRingLayer>("range-ring") {
            if let Some(s) = station {
                l.lon = s.lon;
                l.lat = s.lat;
            }
            l.radius_m = ncep::RANGE_RING_M;
            l.color = c32a(p.text2);
        }
        layers.set_visible("range-ring", station.is_some());

        // --- SPC outlook ---
        let ssig = hash_of(&(
            sh.spc_outlook
                .iter()
                .map(|f| (f.code.as_str(), f.level, f.fill.as_str(), f.stroke.as_str()))
                .collect::<Vec<_>>(),
            sh.spc_outlook.len(),
        ));
        if ssig != self.spc_sig {
            self.spc_sig = ssig;
            if let Some(l) = layers.get_mut::<PolygonLayer>("spc-outlook") {
                l.set_items(spc_items(&sh.spc_outlook));
            }
        }
        layers.set_visible("spc-outlook", sh.config.spc_outlook_enabled);

        // --- mesoscale discussions ---
        let is_poly = |a: &&ss_core::Alert| {
            matches!(
                a.geometry,
                Some(Geometry::Polygon(_)) | Some(Geometry::MultiPolygon(_))
            )
        };
        let msig = hash_of(
            &sh.mcd_alerts
                .iter()
                .filter(is_poly)
                .map(|a| {
                    (
                        a.id.as_str(),
                        a.headline.as_deref(),
                        effective_color(&a.class, overrides),
                    )
                })
                .collect::<Vec<_>>(),
        );
        if msig != self.md_sig {
            self.md_sig = msig;
            let items: Vec<PolyItem> = sh
                .mcd_alerts
                .iter()
                .filter(is_poly)
                .map(|a| {
                    let [r, g, b] = effective_color(&a.class, overrides);
                    PolyItem {
                        id: a.id.clone(),
                        geometry: a.geometry.clone().unwrap_or(Geometry::Other),
                        fill: Color32::from_rgba_unmultiplied(r, g, b, 30),
                        stroke: Color32::from_rgb(r, g, b),
                        stroke_width: 2.0,
                        pulse: false,
                        label: Some(
                            a.headline
                                .clone()
                                .unwrap_or_else(|| a.display_event.clone()),
                        ),
                    }
                })
                .collect();
            if let Some(l) = layers.get_mut::<PolygonLayer>("md") {
                l.set_items(items);
            }
        }
        layers.set_visible("md", rs.md_polygons);
        layers.set_visible("alerts", rs.show_polygons);

        // --- wind barbs ---
        let bsig = hash_of(&(
            sh.wind_obs
                .iter()
                .map(|w| {
                    (
                        w.station.id.as_str(),
                        w.obs.wind_direction_deg.map(f64::to_bits),
                        w.obs.wind_speed_kt.map(f64::to_bits),
                        w.obs.wind_gust_kt.map(f64::to_bits),
                    )
                })
                .collect::<Vec<_>>(),
            p.text,
        ));
        if bsig != self.barbs_sig {
            self.barbs_sig = bsig;
            if let Some(l) = layers.get_mut::<WindBarbLayer>("barbs") {
                l.color = c32(p.text);
                l.barbs = sh
                    .wind_obs
                    .iter()
                    .filter_map(|w| {
                        Some(Barb {
                            lon: w.station.lon,
                            lat: w.station.lat,
                            dir_deg: w.obs.wind_direction_deg? as f32,
                            speed_kt: w.obs.wind_speed_kt? as f32,
                            gust_kt: w.obs.wind_gust_kt.map(|g| g as f32),
                        })
                    })
                    .collect();
            }
        }
        layers.set_visible("barbs", rs.wind_barbs);

        // --- alert polygons ---
        let alerts = sh.all_alerts_for(cx.loc_id());
        let sig = hash_of(&(
            alerts
                .iter()
                .map(|a| {
                    (
                        a.id.as_str(),
                        a.class.as_str(),
                        effective_color(&a.class, overrides),
                    )
                })
                .collect::<Vec<_>>(),
            sh.config.storm_polygons_enabled,
        ));
        if sig != self.alerts_sig {
            self.alerts_sig = sig;
            let mut items: Vec<(StormTier, PolyItem)> = alerts
                .iter()
                .filter(|a| {
                    matches!(
                        a.geometry,
                        Some(Geometry::Polygon(_)) | Some(Geometry::MultiPolygon(_))
                    )
                })
                .map(|a| {
                    let [r, g, b] = effective_color(&a.class, overrides);
                    let tier = storm_tier(&a.class);
                    (
                        tier,
                        PolyItem {
                            id: a.id.clone(),
                            geometry: a.geometry.clone().unwrap_or(Geometry::Other),
                            fill: Color32::from_rgba_unmultiplied(r, g, b, 46),
                            stroke: Color32::from_rgb(r, g, b),
                            stroke_width: 1.5,
                            pulse: sh.config.storm_polygons_enabled && tier != StormTier::None,
                            label: Some(a.display_event.clone()),
                        },
                    )
                })
                .collect();
            // Storm-tier warnings draw above zone-based polygons.
            items.sort_by_key(|(t, _)| *t);
            if let Some(l) = layers.get_mut::<PolygonLayer>("alerts") {
                l.set_items(items.into_iter().map(|(_, i)| i).collect());
            }
        }

        // --- saved locations ---
        let lsig = hash_of(&(
            sh.locations
                .saved_locations
                .iter()
                .map(|l| {
                    (
                        l.id.as_str(),
                        l.lat.to_bits(),
                        l.lon.to_bits(),
                        l.label.as_str(),
                    )
                })
                .collect::<Vec<_>>(),
            cx.loc_id(),
            p.a0,
            p.text2,
        ));
        if lsig != self.locations_sig {
            self.locations_sig = lsig;
            let active = cx.loc_id();
            let markers: Vec<Marker> = sh
                .locations
                .saved_locations
                .iter()
                .map(|l| {
                    let is_active = active == l.id;
                    Marker {
                        id: l.id.clone(),
                        lon: l.lon,
                        lat: l.lat,
                        kind: if is_active {
                            MarkerKind::Crosshair
                        } else {
                            MarkerKind::Pin
                        },
                        color: if is_active { c32(p.a0) } else { c32a(p.text2) },
                        label: Some(l.label.clone()),
                    }
                })
                .collect();
            if let Some(l) = self.map.layers.get_mut::<MarkerLayer>("locations") {
                l.markers = markers;
            }
        }

        // --- radar sites (liveness is time dependent: refresh once a minute) ---
        let now = Utc::now();
        let ssig = hash_of(&(
            sh.radar_stations.len(),
            now.timestamp() / 60,
            p.safe,
            p.text3,
        ));
        if ssig != self.stations_sig {
            self.stations_sig = ssig;
            let markers: Vec<Marker> = sh
                .radar_stations
                .iter()
                .map(|s| {
                    let live = s
                        .last_received_time
                        .as_deref()
                        .is_some_and(|t| is_live(t, now));
                    Marker {
                        id: s.id.clone(),
                        lon: s.lon,
                        lat: s.lat,
                        kind: MarkerKind::RadarSite { live },
                        color: if live { c32(p.safe) } else { c32a(p.text3) },
                        label: Some(s.id.clone()),
                    }
                })
                .collect();
            if let Some(l) = self.map.layers.get_mut::<MarkerLayer>("radar-sites") {
                l.markers = markers;
            }
        }
    }

    /// Apply recenter / zoom / focus / clear requests posted for this window.
    fn handle_requests(&mut self, cx: &mut PanelCx) {
        let loc = cx.location.clone();
        let req = &mut *cx.req;

        if !self.positioned {
            if let Some(l) = &loc {
                // First frame with a known location: start there at zoom 7.
                self.map.viewport.fly_to(l.lon, l.lat, 7.0);
                self.positioned = true;
                req.map_recenter = false;
            }
        }
        if req.map_recenter {
            req.map_recenter = false;
            if let Some(l) = &loc {
                let z = self.map.viewport.zoom;
                self.map.viewport.fly_to(l.lon, l.lat, z);
            }
        }
        if let Some(z) = req.map_zoom.take() {
            let v = &self.map.viewport;
            let (lon, lat) = (v.center_lon, v.center_lat);
            self.map.viewport.fly_to(lon, lat, f64::from(z));
        }
        if let Some(b) = req.pending_focus.take() {
            let size = self.map.viewport.size;
            let z = fit_zoom(&b, size);
            self.map
                .viewport
                .fly_to((b.west + b.east) / 2.0, (b.south + b.north) / 2.0, z);
        }
        if req.clear_selection {
            req.clear_selection = false;
            self.map.clear_selection();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ss_core::RadarFrame;

    #[test]
    fn fit_zoom_is_higher_for_smaller_boxes() {
        let size = vec2(800.0, 600.0);
        let big = fit_zoom(&BBox::new(-110.0, 30.0, -100.0, 40.0), size);
        let small = fit_zoom(&BBox::new(-101.0, 34.0, -100.5, 34.5), size);
        assert!(small > big);
        assert!((2.0..=12.0).contains(&big) && (2.0..=12.0).contains(&small));
    }

    #[test]
    fn fit_zoom_handles_degenerate_box() {
        let z = fit_zoom(&BBox::new(-100.0, 35.0, -100.0, 35.0), vec2(800.0, 600.0));
        assert_eq!(z, 12.0);
    }

    fn rf(time: i64) -> RadarFrame {
        RadarFrame {
            time,
            path: format!("/v2/radar/{time}"),
        }
    }

    fn maps(past: &[i64], now: &[i64]) -> WeatherMaps {
        WeatherMaps {
            radar_past: past.iter().map(|t| rf(*t)).collect(),
            radar_nowcast: now.iter().map(|t| rf(*t)).collect(),
            ..Default::default()
        }
    }

    fn frames(past: &[i64], now: &[i64]) -> Vec<LoopFrame> {
        loop_frames(&maps(past, now), true)
    }

    #[test]
    fn loop_frames_orders_past_then_nowcast() {
        let f = frames(&[10, 20], &[30]);
        assert_eq!(
            f.iter().map(|x| (x.time, x.nowcast)).collect::<Vec<_>>(),
            vec![(10, false), (20, false), (30, true)]
        );
        assert_eq!(f[0].path, "/v2/radar/10");
        assert_eq!(loop_frames(&maps(&[10, 20], &[30]), false).len(), 2);
    }

    #[test]
    fn latest_observed_index_cases() {
        assert_eq!(latest_observed_index(&frames(&[10, 20, 30], &[40, 50])), 2);
        assert_eq!(latest_observed_index(&frames(&[], &[40, 50])), 0);
        assert_eq!(latest_observed_index(&[]), 0);
    }

    #[test]
    fn tick_advances_after_interval_and_wraps() {
        let f = frames(&[1, 2, 3], &[]);
        let mut pb = Playback::new();
        pb.tick(&f, 0.0);
        assert_eq!(pb.idx, 2);
        pb.set_playing(true);
        pb.tick(&f, 10.0);
        assert_eq!(pb.idx, 2, "first tick only starts the clock");
        pb.tick(&f, 10.5);
        assert_eq!(pb.idx, 2);
        pb.tick(&f, 10.9);
        assert_eq!(pb.idx, 0, "wraps past the last frame");
        pb.tick(&f, 11.8);
        assert_eq!(pb.idx, 1);
    }

    #[test]
    fn playing_includes_nowcast_frames() {
        let f = frames(&[1, 2], &[3]);
        let mut pb = Playback::new();
        pb.tick(&f, 0.0);
        pb.set_playing(true);
        pb.tick(&f, 1.0);
        pb.tick(&f, 2.0);
        assert_eq!(pb.idx, 2);
        assert!(!pb.is_live(&f));
    }

    #[test]
    fn step_back_from_zero_wraps_and_stops_tracking() {
        let f = frames(&[1, 2, 3], &[]);
        let mut pb = Playback::new();
        pb.tick(&f, 0.0);
        pb.scrub(&f, 0);
        pb.step(&f, -1);
        assert_eq!(pb.idx, 2);
        assert!(!pb.tracking_live);
        pb.step(&f, 1);
        assert_eq!(pb.idx, 0);
    }

    #[test]
    fn stopping_on_latest_is_live_without_tracking() {
        let f = frames(&[1, 2, 3], &[]);
        let mut pb = Playback::new();
        pb.tick(&f, 0.0);
        pb.step(&f, -1);
        pb.step(&f, 1);
        assert!(pb.is_live(&f));
        assert!(!pb.tracking_live);
    }

    #[test]
    fn new_latest_frame_jumps_only_while_tracking() {
        let f1 = frames(&[1, 2, 3], &[]);
        let f2 = frames(&[1, 2, 3, 4], &[]);
        let mut pb = Playback::new();
        pb.tick(&f1, 0.0);
        assert_eq!(pb.idx, 2);
        pb.tick(&f2, 1.0);
        assert_eq!(pb.idx, 3);

        let mut pb = Playback::new();
        pb.tick(&f1, 0.0);
        pb.scrub(&f1, 0);
        pb.tick(&f2, 1.0);
        assert_eq!(pb.idx, 0);
        pb.go_live(&f2);
        assert!(pb.tracking_live && !pb.playing);
        assert_eq!(pb.idx, 3);
    }

    #[test]
    fn idx_is_clamped_when_loop_shrinks() {
        let mut pb = Playback::new();
        pb.tick(&frames(&[1, 2, 3, 4], &[]), 0.0);
        pb.scrub(&frames(&[1, 2, 3, 4], &[]), 3);
        pb.tick(&frames(&[1, 2], &[]), 1.0);
        assert_eq!(pb.idx, 1);
    }

    #[test]
    fn layer_key_tracks_url_inputs() {
        let base = RadarSettings::default();
        let k = radar_layer_key("/v2/radar/1", &base, true);
        assert_ne!(k, radar_layer_key("/v2/radar/2", &base, true));
        let mut s = base.clone();
        s.color_scheme = base.color_scheme.wrapping_add(1);
        assert_ne!(k, radar_layer_key("/v2/radar/1", &s, true));
        let mut s = base.clone();
        s.smooth = !base.smooth;
        assert_ne!(k, radar_layer_key("/v2/radar/1", &s, true));
        let mut s = base.clone();
        s.show_arrows = !base.show_arrows;
        assert_ne!(k, radar_layer_key("/v2/radar/1", &s, true));
        let mut a = base.clone();
        a.show_arrows = true;
        assert_ne!(
            radar_layer_key("/v2/radar/1", &a, true),
            radar_layer_key("/v2/radar/1", &a, false)
        );
    }

    fn spc(code: &str, level: i32, fill: &str, stroke: &str) -> SpcOutlookFeature {
        SpcOutlookFeature {
            code: code.into(),
            name: format!("{code} name"),
            level,
            stroke: stroke.into(),
            fill: fill.into(),
            valid: String::new(),
            expire: String::new(),
            issue: String::new(),
            geometry: Geometry::Other,
        }
    }

    #[test]
    fn spc_items_parse_colors_and_sort_by_level() {
        let items = spc_items(&[
            spc("ENH", 3, "#ff7f00", "#ff0000"),
            spc("SLGT", 2, "#ffff00", "nonsense"),
        ]);
        assert_eq!(items[0].id, "spc:SLGT:2");
        assert_eq!(items[1].id, "spc:ENH:3");
        assert_eq!(
            items[1].fill,
            Color32::from_rgba_unmultiplied(255, 127, 0, 48)
        );
        assert_eq!(items[1].stroke, Color32::from_rgb(255, 0, 0));
        assert_eq!(items[0].stroke, Color32::GRAY);
        assert_eq!(
            items[0].label.as_deref(),
            Some("SPC Day 1 outlook: SLGT name")
        );
        assert!(!items[0].pulse);
    }

    #[test]
    fn bbox_request_due_respects_max_age() {
        let a = BBox::new(-100.0, 30.0, -98.0, 32.0);
        assert!(!bbox_request_due(Some((&a, 0.0)), 119.0, &a, true, 120.0));
        assert!(bbox_request_due(Some((&a, 0.0)), 120.0, &a, true, 120.0));
        assert!(bbox_request_due(None, 0.0, &a, false, 120.0));
    }

    #[test]
    fn wind_request_due_cases() {
        let a = BBox::new(-100.0, 30.0, -98.0, 32.0);
        // Nothing requested yet.
        assert!(wind_request_due(None, 0.0, &a, false));
        // Same view, recent.
        assert!(!wind_request_due(Some((&a, 0.0)), 10.0, &a, true));
        // Stale.
        assert!(wind_request_due(Some((&a, 0.0)), 300.0, &a, true));
        // Small pan.
        let small = BBox::new(-99.8, 30.0, -97.8, 32.0);
        assert!(!wind_request_due(Some((&a, 0.0)), 10.0, &small, true));
        // Big pan, settled vs not.
        let far = BBox::new(-99.0, 30.0, -97.0, 32.0);
        assert!(wind_request_due(Some((&a, 0.0)), 10.0, &far, true));
        assert!(!wind_request_due(Some((&a, 0.0)), 10.0, &far, false));
        // Zoom in by one level.
        let zoomed = BBox::new(-99.5, 30.5, -98.5, 31.5);
        assert!(wind_request_due(Some((&a, 0.0)), 10.0, &zoomed, true));
        assert!(!wind_request_due(Some((&a, 0.0)), 10.0, &zoomed, false));
        // Zoom out by one level.
        let out = BBox::new(-101.0, 29.0, -97.0, 33.0);
        assert!(wind_request_due(Some((&a, 0.0)), 10.0, &out, true));
    }

    #[test]
    fn scheme_options_falls_back_to_builtins() {
        let opts = scheme_options(None);
        assert_eq!(opts.len(), 9);
        assert!(opts.iter().any(|(id, n)| *id == 1 && n == "Original"));
    }

    #[test]
    fn scheme_options_uses_loaded_index() {
        let mut m = WeatherMaps::default();
        m.color_schemes = vec![ss_core::ColorScheme {
            id: 9,
            name: "Custom".into(),
        }];
        let opts = scheme_options(Some(&m));
        assert_eq!(opts, vec![(9, "Custom".to_string())]);
        let empty = WeatherMaps::default();
        assert_eq!(scheme_options(Some(&empty)).len(), 9);
    }

    #[test]
    fn layer_toggles_reflect_state_and_flip() {
        let rs = RadarSettings::default();
        let toggles = layer_toggles(&rs);
        assert_eq!(toggles.len(), 6);
        let sat = toggles.iter().find(|(l, _, _)| *l == "SAT").unwrap();
        assert!(!sat.1);
        assert_eq!(
            sat.2,
            Command::Layer {
                name: "satellite".to_string(),
                on: Some(true),
            }
        );
        let mut on = rs.clone();
        on.satellite = true;
        on.show_polygons = false;
        let toggles = layer_toggles(&on);
        let sat = toggles.iter().find(|(l, _, _)| *l == "SAT").unwrap();
        assert!(sat.1);
        assert_eq!(
            sat.2,
            Command::Layer {
                name: "satellite".to_string(),
                on: Some(false),
            }
        );
        let ply = toggles.iter().find(|(l, _, _)| *l == "PLY").unwrap();
        assert!(!ply.1);
    }
}
