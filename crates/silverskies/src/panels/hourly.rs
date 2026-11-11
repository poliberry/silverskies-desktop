use egui::{vec2, RichText, ScrollArea, Ui};
use ss_core::weather::icons::pixel_icon;
use ss_core::weather::units::{fmt_temp, fmt_time};
use ss_core::{HourlyPoint, PanelKind};

use super::{placeholder, Panel, PanelCx};
use crate::icons::weather_image;
use crate::theme::{c32, c32a};

pub struct HourlyPanel;

const CELL_W: f32 = 54.0;

/// Index of the first hourly point at or after `now_key` (`%Y-%m-%dT%H:00`).
/// If every point is in the past, show the last 24.
pub fn hourly_start_index(hourly: &[HourlyPoint], now_key: &str) -> usize {
    hourly
        .iter()
        .position(|h| h.time.as_str() >= now_key)
        .unwrap_or_else(|| hourly.len().saturating_sub(24))
}

impl Panel for HourlyPanel {
    fn kind(&self) -> PanelKind {
        PanelKind::Hourly
    }

    fn ui(&mut self, ui: &mut Ui, cx: &mut PanelCx) {
        let p = cx.palette;
        let Some(w) = cx
            .location
            .as_ref()
            .and_then(|l| cx.shared.weather_for(&l.id))
        else {
            placeholder(ui, &p, "no data");
            return;
        };
        let (units, tf) = (cx.shared.config.units, cx.shared.config.time_format);
        let now_key = chrono::Local::now().format("%Y-%m-%dT%H:00").to_string();
        let start = hourly_start_index(&w.hourly, &now_key);

        ScrollArea::horizontal()
            .id_salt("hourly_scroll")
            .auto_shrink([false, false])
            .show(ui, |ui| {
                ui.horizontal_top(|ui| {
                    for h in w.hourly.iter().skip(start).take(24) {
                        ui.allocate_ui(vec2(CELL_W, ui.available_height()), |ui| {
                            ui.vertical_centered(|ui| {
                                ui.spacing_mut().item_spacing.y = 2.0;
                                ui.label(
                                    RichText::new(fmt_time(&h.time, tf))
                                        .small()
                                        .color(c32a(p.text3)),
                                );
                                ui.add(weather_image(
                                    ui.ctx(),
                                    pixel_icon(h.weather_code, h.is_day),
                                    &p,
                                    16,
                                ));
                                ui.label(
                                    RichText::new(fmt_temp(h.temperature_c, units))
                                        .color(c32(p.a0)),
                                );
                                ui.label(
                                    RichText::new(format!(
                                        "{:.0}%",
                                        h.precipitation_probability_pct
                                    ))
                                    .small()
                                    .color(c32a(p.text2)),
                                );
                            });
                        });
                    }
                });
            });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pts(times: &[&str]) -> Vec<HourlyPoint> {
        times
            .iter()
            .map(|t| HourlyPoint {
                time: (*t).to_string(),
                temperature_c: 0.0,
                weather_code: 0,
                is_day: true,
                precipitation_probability_pct: 0.0,
            })
            .collect()
    }

    #[test]
    fn start_index_finds_first_not_before_now() {
        let h = pts(&["2026-11-10T09:00", "2026-11-10T10:00", "2026-11-10T11:00"]);
        assert_eq!(hourly_start_index(&h, "2026-11-10T10:00"), 1);
        assert_eq!(hourly_start_index(&h, "2026-11-10T09:30"), 1);
        assert_eq!(hourly_start_index(&h, "2026-11-09T00:00"), 0);
    }

    #[test]
    fn start_index_falls_back_to_tail_when_all_past() {
        let times: Vec<String> = (0..30)
            .map(|i| format!("2026-11-10T{:02}:00", i % 24))
            .collect();
        let refs: Vec<&str> = times.iter().take(10).map(String::as_str).collect();
        let h = pts(&refs);
        assert_eq!(hourly_start_index(&h, "2027-01-01T00:00"), 0);
        let h2 = pts(&times.iter().map(String::as_str).collect::<Vec<_>>());
        assert_eq!(hourly_start_index(&h2, "9999"), 6);
        assert_eq!(hourly_start_index(&[], "x"), 0);
    }
}
