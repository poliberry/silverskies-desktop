use egui::{vec2, Align2, FontId, Id, Key, Sense, TextEdit, TextStyle, Ui};
use ss_core::alerts::colors::effective_color;
use ss_core::command::Command;
use ss_core::weather::units::fmt_temp;
use ss_core::PanelKind;

use super::{paint_truncated, placeholder, Panel, PanelCx};
use crate::theme::{c32, c32a};

#[derive(Default)]
pub struct LocationsPanel {
    search: String,
}

const ROW_H: f32 = 20.0;

impl Panel for LocationsPanel {
    fn kind(&self) -> PanelKind {
        PanelKind::Locations
    }

    fn ui(&mut self, ui: &mut Ui, cx: &mut PanelCx) {
        let p = cx.palette;

        let search = ui.add(
            TextEdit::singleline(&mut self.search)
                .id(Id::unique("location_search"))
                .font(TextStyle::Monospace)
                .desired_width(f32::INFINITY)
                .hint_text("search place…"),
        );
        if cx.req.focus_location_search {
            search.request_focus();
            cx.req.focus_location_search = false;
        }
        if search.lost_focus() && ui.input(|i| i.key_pressed(Key::Enter)) {
            let q = self.search.trim().to_string();
            if !q.is_empty() {
                cx.emit.push(Command::Goto { query: q });
                self.search.clear();
            }
        }
        ui.add_space(2.0);

        if cx.shared.locations.saved_locations.is_empty() {
            placeholder(ui, &p, "no saved locations");
        }

        let active = cx.shared.locations.active_location_id.clone();
        let units = cx.shared.config.units;
        let mut select: Option<String> = None;
        let mut remove: Option<String> = None;

        egui::ScrollArea::vertical()
            .id_salt("locations_scroll")
            .auto_shrink([false, true])
            .max_height((ui.available_height() - 26.0).max(20.0))
            .show(ui, |ui| {
                ui.spacing_mut().item_spacing.y = 1.0;
                for loc in &cx.shared.locations.saved_locations {
                    let (rect, resp) =
                        ui.allocate_exact_size(vec2(ui.available_width(), ROW_H), Sense::click());
                    let is_active = active.as_deref() == Some(loc.id.as_str());
                    let painter = ui.painter_at(rect);
                    if resp.hovered() {
                        painter.rect_filled(rect, 0.0, c32(p.surface3));
                    }
                    let color = if is_active { c32(p.a0) } else { c32(p.text) };
                    let font = FontId::monospace(13.0);

                    // Right side: severity dot + temperature, or a remove button on hover.
                    let mut right = rect.right() - 6.0;
                    let x_rect = egui::Rect::from_center_size(
                        egui::pos2(rect.right() - 10.0, rect.center().y),
                        vec2(16.0, ROW_H),
                    );
                    let x_resp = resp
                        .hovered()
                        .then(|| ui.interact(x_rect, resp.id.with("rm"), Sense::click()));
                    if let Some(x) = &x_resp {
                        let c = if x.hovered() {
                            p.danger
                        } else {
                            [p.text3[0], p.text3[1], p.text3[2]]
                        };
                        painter.text(
                            x_rect.center(),
                            Align2::CENTER_CENTER,
                            "×",
                            font.clone(),
                            c32(c),
                        );
                        right = x_rect.left() - 2.0;
                        if x.clicked() {
                            remove = Some(loc.id.clone());
                        }
                    } else if let Some(w) = cx.shared.weather.get(&loc.id) {
                        let t = fmt_temp(w.current.temperature_c, units);
                        let g = painter.text(
                            egui::pos2(right, rect.center().y),
                            Align2::RIGHT_CENTER,
                            t,
                            font.clone(),
                            c32a(p.text2),
                        );
                        right = g.left() - 6.0;
                    }
                    if let Some(a) = cx
                        .shared
                        .all_alerts_for(&loc.id)
                        .into_iter()
                        .min_by_key(|a| a.severity)
                    {
                        let col = effective_color(&a.class, &cx.shared.config.alert_type_overrides);
                        painter.circle_filled(
                            egui::pos2(right - 3.0, rect.center().y),
                            3.0,
                            c32(col),
                        );
                        right -= 12.0;
                    }

                    let glyph = if is_active { "●" } else { "○" };
                    paint_truncated(
                        &painter,
                        egui::pos2(rect.left() + 4.0, rect.center().y),
                        (right - rect.left() - 8.0).max(10.0),
                        &[(format!("{glyph} {}", loc.label), color)],
                        font,
                    );

                    if resp.clicked() && x_resp.as_ref().is_none_or(|x| !x.hovered()) {
                        select = Some(loc.id.clone());
                    }
                }
            });

        if ui
            .add(
                egui::Button::new(egui::RichText::new("⊕ use my location").color(c32(p.a0)))
                    .frame(false),
            )
            .clicked()
        {
            cx.tasks.ip_locate();
            cx.shared
                .log(crate::state::LogLevel::Info, "locating via IP…");
        }

        if let Some(id) = remove {
            cx.emit.push(Command::Remove { target: id });
        } else if let Some(id) = select {
            cx.emit.push(Command::Select { target: id });
        }
    }
}
