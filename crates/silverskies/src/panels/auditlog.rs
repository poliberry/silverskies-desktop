use chrono::{DateTime, Utc};
use egui::{vec2, Align2, FontId, Id, RichText, Sense, TextEdit, TextStyle, Ui};
use ss_core::alerts::classify::icon_glyph;
use ss_core::alerts::colors::effective_color;
use ss_core::geo::geometry_bbox;
use ss_core::{Alert, BBox, PanelKind};

use super::{paint_truncated, placeholder, Panel, PanelCx};
use crate::theme::{c32, c32a};

#[derive(Default)]
pub struct AuditLogPanel {
    scrolled_to: Option<String>,
}

const ROW_H: f32 = 20.0;

/// `12m left`, `3h left`, or `expired` for non-positive remainders.
pub fn fmt_remaining(secs: i64) -> String {
    if secs <= 0 {
        "expired".to_string()
    } else if secs < 60 {
        "<1m left".to_string()
    } else if secs < 3600 {
        format!("{}m left", secs / 60)
    } else if secs < 86_400 {
        format!("{}h left", secs / 3600)
    } else {
        format!("{}d left", secs / 86_400)
    }
}

fn remaining_secs(expires: &str, now: DateTime<Utc>) -> Option<i64> {
    DateTime::parse_from_rfc3339(expires).ok().map(|t| {
        t.with_timezone(&Utc)
            .signed_duration_since(now)
            .num_seconds()
    })
}

impl Panel for AuditLogPanel {
    fn kind(&self) -> PanelKind {
        PanelKind::AuditLog
    }

    fn ui(&mut self, ui: &mut Ui, cx: &mut PanelCx) {
        let p = cx.palette;

        ui.horizontal(|ui| {
            ui.label(RichText::new("filter").small().color(c32a(p.text3)));
            ui.add(
                TextEdit::singleline(&mut cx.shared.alert_filter)
                    .id(Id::unique("audit_filter"))
                    .font(TextStyle::Monospace)
                    .desired_width(f32::INFINITY)
                    .hint_text("text, severity, area…"),
            );
        });

        let sh = &*cx.shared;
        let alerts = sh.filtered_alerts_for(cx.loc_id());
        if alerts.is_empty() {
            placeholder(
                ui,
                &p,
                if sh.alert_filter.trim().is_empty() {
                    "no active alerts"
                } else {
                    "no alerts match the filter"
                },
            );
            return;
        }

        let now = Utc::now();
        let selected = cx.req.selected_alert_id.clone();
        let mut toggle: Option<String> = None;
        let mut focus: Option<BBox> = None;
        let scroll_target = selected
            .clone()
            .filter(|id| self.scrolled_to.as_ref() != Some(id));

        egui::ScrollArea::vertical()
            .id_salt("audit_scroll")
            .auto_shrink([false, false])
            .show(ui, |ui| {
                ui.spacing_mut().item_spacing.y = 1.0;
                for a in alerts {
                    let open = selected.as_deref() == Some(a.id.as_str());
                    let color = c32(effective_color(&a.class, &sh.config.alert_type_overrides));
                    let (rect, resp) =
                        ui.allocate_exact_size(vec2(ui.available_width(), ROW_H), Sense::click());
                    if open && scroll_target.as_deref() == Some(a.id.as_str()) {
                        ui.scroll_to_rect(rect, Some(egui::Align::Center));
                    }
                    let painter = ui.painter_at(rect);
                    if open || resp.hovered() {
                        painter.rect_filled(rect, 0.0, c32(p.surface3));
                    }
                    painter.rect_filled(
                        egui::Rect::from_min_size(rect.min, vec2(3.0, ROW_H)),
                        0.0,
                        color,
                    );

                    let font = FontId::monospace(12.0);
                    let cy = rect.center().y;
                    // Right: source tag + remaining time.
                    let remain = a
                        .expires
                        .as_deref()
                        .and_then(|e| remaining_secs(e, now))
                        .map(fmt_remaining)
                        .unwrap_or_default();
                    let tag = format!("{:?}", a.source).to_uppercase();
                    let right_text = if remain.is_empty() {
                        tag
                    } else {
                        format!("{remain}  {tag}")
                    };
                    let g = painter.text(
                        egui::pos2(rect.right() - 6.0, cy),
                        Align2::RIGHT_CENTER,
                        right_text,
                        FontId::monospace(10.5),
                        c32a(p.text3),
                    );
                    let avail = (g.left() - rect.left() - 16.0).max(20.0);
                    let mut parts = vec![
                        (format!("{} ", icon_glyph(&a.class)), color),
                        (a.display_event.clone(), c32(p.text)),
                    ];
                    if let Some(area) = a.area_desc.as_deref() {
                        parts.push((format!("  {area}"), c32a(p.text2)));
                    }
                    paint_truncated(
                        &painter,
                        egui::pos2(rect.left() + 9.0, cy),
                        avail,
                        &parts,
                        font,
                    );
                    if resp.clicked() {
                        toggle = Some(a.id.clone());
                    }

                    if open {
                        details(ui, a, &p, &mut focus);
                    }
                }
            });

        self.scrolled_to = selected;
        if let Some(id) = toggle {
            cx.req.selected_alert_id = if cx.req.selected_alert_id.as_deref() == Some(id.as_str()) {
                None
            } else {
                Some(id)
            };
        }
        if let Some(b) = focus {
            cx.req.pending_focus = Some(b);
        }
    }
}

fn details(ui: &mut Ui, a: &Alert, p: &ss_core::theme::Palette, focus: &mut Option<BBox>) {
    egui::Frame::NONE
        .inner_margin(egui::Margin::symmetric(10, 4))
        .show(ui, |ui| {
            let wrap = |ui: &mut Ui, text: &str, col: egui::Color32| {
                ui.add(egui::Label::new(RichText::new(text).color(col)).wrap());
            };
            if let Some(h) = &a.headline {
                ui.add(egui::Label::new(RichText::new(h).strong()).wrap());
            }
            if let Some(d) = &a.description {
                wrap(ui, d.trim(), c32a(p.text2));
            }
            if let Some(i) = &a.instruction {
                ui.add_space(2.0);
                wrap(ui, i.trim(), c32(p.a0));
            }
            if let Some(o) = &a.issuing_office {
                wrap(ui, &format!("issued by {o}"), c32a(p.text3));
            }
            if let Some(b) = a.geometry.as_ref().and_then(geometry_bbox) {
                if ui
                    .add(
                        egui::Button::new(RichText::new("show on map").color(c32(p.a0)))
                            .frame(false),
                    )
                    .clicked()
                {
                    *focus = Some(b);
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remaining_formats() {
        assert_eq!(fmt_remaining(-5), "expired");
        assert_eq!(fmt_remaining(0), "expired");
        assert_eq!(fmt_remaining(30), "<1m left");
        assert_eq!(fmt_remaining(12 * 60 + 5), "12m left");
        assert_eq!(fmt_remaining(3 * 3600 + 10), "3h left");
        assert_eq!(fmt_remaining(2 * 86_400), "2d left");
    }

    #[test]
    fn remaining_secs_is_signed() {
        let now = DateTime::parse_from_rfc3339("2026-11-10T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(remaining_secs("2026-11-10T12:10:00Z", now), Some(600));
        assert_eq!(remaining_secs("2026-11-10T11:50:00Z", now), Some(-600));
        assert_eq!(remaining_secs("garbage", now), None);
    }
}
