//! The egui map widget: interaction, layer drawing, overlays.

use egui::{
    pos2, vec2, Align2, Color32, FontId, Key, Modifiers, PointerButton, Pos2, Rect, Response,
    Sense, Stroke, Ui,
};
use ss_core::types::BBox;

use crate::layers::{LayerStack, SelectionLayer};
use crate::tiles::TileCache;
use crate::viewport::{Units, Viewport};

pub const BACKGROUND: Color32 = Color32::from_rgb(0x0d, 0x0d, 0x0f);
const MIN_SELECTION_PX: f32 = 8.0;

pub struct MapResponse {
    pub response: Response,
    /// (lon, lat)
    pub clicked: Option<(f64, f64)>,
    pub double_clicked: Option<(f64, f64)>,
    pub hovered: Option<(f64, f64)>,
    pub selection_changed: bool,
    pub viewport_changed: bool,
    /// Screen rect the map was drawn into (for layer hit tests).
    pub rect: Rect,
}

pub struct MapWidget {
    pub viewport: Viewport,
    pub layers: LayerStack,
    pub cache: TileCache,
    drag_sel: Option<(Pos2, Pos2)>,
    pub selected_bbox: Option<BBox>,
    pub units: Units,
    pub show_scale: bool,
    pub show_attribution: bool,
    pub show_coords: bool,
    pub show_stats: bool,
    pub dark: bool,
    selection: SelectionLayer,
}

impl MapWidget {
    pub fn new(cache: TileCache) -> Self {
        Self {
            viewport: Viewport::default(),
            layers: LayerStack::new(),
            cache,
            drag_sel: None,
            selected_bbox: None,
            units: Units::Metric,
            show_scale: true,
            show_attribution: true,
            show_coords: true,
            show_stats: false,
            dark: true,
            selection: SelectionLayer::default(),
        }
    }

    pub fn clear_selection(&mut self) {
        self.selected_bbox = None;
        self.drag_sel = None;
    }

    pub fn show(&mut self, ui: &mut Ui) -> MapResponse {
        let ctx = ui.ctx().clone();
        self.cache.poll(&ctx);

        let size = ui.available_size().max(vec2(32.0, 32.0));
        let (rect, response) = ui.allocate_exact_size(size, Sense::click_and_drag());
        let before = (
            self.viewport.center_lon,
            self.viewport.center_lat,
            self.viewport.zoom,
            self.viewport.size,
        );
        self.viewport.size = rect.size();
        let now = ui.input(|i| i.time);

        let mut out = MapResponse {
            response: response.clone(),
            clicked: None,
            double_clicked: None,
            hovered: None,
            selection_changed: false,
            viewport_changed: false,
            rect,
        };

        // --- interaction ---
        let shift = ui.input(|i| i.modifiers.shift);
        if response.clicked() || response.drag_started() {
            response.request_focus();
        }
        if response.drag_started_by(PointerButton::Primary) && shift {
            if let Some(p) = response.interact_pointer_pos() {
                self.drag_sel = Some((p, p));
            }
        }
        if response.dragged_by(PointerButton::Primary) {
            if let Some((a, _)) = self.drag_sel {
                if let Some(p) = response.interact_pointer_pos() {
                    self.drag_sel = Some((a, p.clamp(rect.min, rect.max)));
                }
            } else {
                self.viewport.pan_px(response.drag_delta());
            }
        }
        if response.drag_stopped() {
            if let Some((a, b)) = self.drag_sel.take() {
                if (a - b).abs().max_elem() >= MIN_SELECTION_PX {
                    let (w1, n1) = self.viewport.lonlat_from_screen(a, rect);
                    let (w2, n2) = self.viewport.lonlat_from_screen(b, rect);
                    self.selected_bbox =
                        Some(BBox::new(w1.min(w2), n1.min(n2), w1.max(w2), n1.max(n2)));
                    out.selection_changed = true;
                }
            }
        }

        if response.hovered() {
            let (scroll, zoom_mul) = ui.input(|i| (i.smooth_scroll_delta.y, i.zoom_delta()));
            let mut dz = 0.0;
            if scroll != 0.0 {
                dz += scroll as f64 / 240.0;
            }
            if zoom_mul != 1.0 {
                // ctrl+scroll / pinch: faster
                dz += (zoom_mul as f64).log2() * 2.0;
            }
            if dz != 0.0 {
                let at = response.hover_pos().unwrap_or(rect.center());
                self.viewport.zoom_about(at, rect, dz);
            }
        }

        if response.double_clicked() {
            if let Some(p) = response.interact_pointer_pos() {
                out.double_clicked = Some(self.viewport.lonlat_from_screen(p, rect));
                self.viewport.zoom_about(p, rect, 1.0);
            }
        } else if response.clicked() {
            if let Some(p) = response.interact_pointer_pos() {
                out.clicked = Some(self.viewport.lonlat_from_screen(p, rect));
            }
        }

        if response.has_focus() || response.hovered() {
            let step = 80.0;
            let key = |ui: &mut Ui, k: Key| ui.input_mut(|i| i.consume_key(Modifiers::NONE, k));
            if key(ui, Key::ArrowLeft) {
                self.viewport.pan_px(vec2(step, 0.0));
            }
            if key(ui, Key::ArrowRight) {
                self.viewport.pan_px(vec2(-step, 0.0));
            }
            if key(ui, Key::ArrowUp) {
                self.viewport.pan_px(vec2(0.0, step));
            }
            if key(ui, Key::ArrowDown) {
                self.viewport.pan_px(vec2(0.0, -step));
            }
            let zin = key(ui, Key::Plus) | key(ui, Key::Equals);
            let zout = key(ui, Key::Minus);
            if zin {
                self.viewport.zoom_about(rect.center(), rect, 0.5);
            }
            if zout {
                self.viewport.zoom_about(rect.center(), rect, -0.5);
            }
        }

        if self.viewport.tick(now) {
            ctx.request_repaint();
        }

        out.hovered = response
            .hover_pos()
            .map(|p| self.viewport.lonlat_from_screen(p, rect));

        // --- drawing ---
        let painter = ui.painter_at(rect);
        painter.rect_filled(rect, 0.0, BACKGROUND);
        self.layers.draw(
            &self.viewport,
            rect,
            &mut self.cache,
            now,
            self.dark,
            &painter,
        );
        self.selection.bbox = self.selected_bbox;
        self.selection.drag = self.drag_sel;
        self.selection.paint(&self.viewport, rect, &painter);
        self.draw_overlays(&painter, rect, out.hovered);

        let after = (
            self.viewport.center_lon,
            self.viewport.center_lat,
            self.viewport.zoom,
            self.viewport.size,
        );
        out.viewport_changed = before != after;
        out
    }

    fn draw_overlays(&self, painter: &egui::Painter, rect: Rect, hover: Option<(f64, f64)>) {
        let fg = Color32::from_gray(210);
        let shadow = Color32::from_black_alpha(190);
        let font = FontId::monospace(11.0);
        let text = |pos: Pos2, anchor: Align2, s: &str, f: FontId| {
            painter.text(pos + vec2(1.0, 1.0), anchor, s, f.clone(), shadow);
            painter.text(pos, anchor, s, f, fg);
        };

        if self.show_scale {
            let (px, label) = self.viewport.scale_bar(rect, self.units);
            let base = rect.left_bottom() + vec2(12.0, -12.0);
            let s = Stroke::new(1.5, fg);
            let sh = Stroke::new(3.5, shadow);
            for st in [sh, s] {
                painter.line_segment([base, base + vec2(px, 0.0)], st);
                painter.line_segment([base, base + vec2(0.0, -5.0)], st);
                painter.line_segment([base + vec2(px, 0.0), base + vec2(px, -5.0)], st);
            }
            text(
                base + vec2(0.0, -8.0),
                Align2::LEFT_BOTTOM,
                &label,
                font.clone(),
            );
        }

        let mut y = rect.bottom() - 6.0;
        if self.show_coords {
            let s = match hover {
                Some((lon, lat)) => format!("{lat:8.4}, {lon:9.4}"),
                None => format!(
                    "{:8.4}, {:9.4}  z{:.1}",
                    self.viewport.center_lat, self.viewport.center_lon, self.viewport.zoom
                ),
            };
            text(
                pos2(rect.right() - 8.0, y),
                Align2::RIGHT_BOTTOM,
                &s,
                font.clone(),
            );
            y -= 14.0;
        }
        if self.show_attribution {
            text(
                pos2(rect.right() - 8.0, y),
                Align2::RIGHT_BOTTOM,
                "Esri, HERE, Garmin, \u{a9} OpenStreetMap contributors",
                FontId::monospace(9.0),
            );
        }
        if self.show_stats {
            let st = self.cache.stats();
            let s = format!(
                "tiles ready {} loading {} failed {}",
                st.ready, st.loading, st.failed
            );
            text(
                rect.left_top() + vec2(8.0, 6.0),
                Align2::LEFT_TOP,
                &s,
                FontId::monospace(9.0),
            );
        }
    }
}
