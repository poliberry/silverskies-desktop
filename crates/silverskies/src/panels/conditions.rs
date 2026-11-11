use egui::{RichText, Ui};
use ss_core::weather::icons::pixel_icon;
use ss_core::weather::outlook::today_outlook;
use ss_core::weather::units::{compass_8, fmt_precip, fmt_temp, fmt_time_full, fmt_wind, uv_label};
use ss_core::weather::wmo::wmo_label;
use ss_core::PanelKind;

use super::{error_text, placeholder, Panel, PanelCx};
use crate::icons::weather_image;
use crate::theme::{c32, c32a};

pub struct ConditionsPanel;

impl Panel for ConditionsPanel {
    fn kind(&self) -> PanelKind {
        PanelKind::Conditions
    }

    fn ui(&mut self, ui: &mut Ui, cx: &mut PanelCx) {
        let p = cx.palette;
        let sh = &*cx.shared;
        let Some(loc) = cx.location.as_ref() else {
            placeholder(ui, &p, "no data");
            return;
        };
        let Some(w) = sh.weather_for(&loc.id) else {
            if let Some(e) = sh.weather_errors.get(&loc.id) {
                error_text(ui, &p, &format!("forecast failed: {e}"));
            } else if sh.refreshing {
                placeholder(ui, &p, "loading…");
            } else {
                placeholder(ui, &p, "no data");
            }
            return;
        };
        let (units, tf) = (sh.config.units, sh.config.time_format);
        let c = &w.current;

        egui::ScrollArea::vertical()
            .id_salt("conditions_scroll")
            .auto_shrink([false, false])
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.add(weather_image(
                        ui.ctx(),
                        pixel_icon(c.weather_code, c.is_day),
                        &p,
                        64,
                    ));
                    ui.vertical(|ui| {
                        ui.label(
                            RichText::new(fmt_temp(c.temperature_c, units))
                                .size(32.0)
                                .color(c32(p.a0)),
                        );
                        ui.label(wmo_label(c.weather_code));
                    });
                });
                ui.add_space(4.0);

                let (uv_text, uv_col) = uv_label(c.uv_index);
                let sun = w.daily.first();
                egui::Grid::new("conditions_grid")
                    .num_columns(2)
                    .spacing([10.0, 2.0])
                    .show(ui, |ui| {
                        let mut row = |k: &str, v: RichText| {
                            ui.label(RichText::new(k).color(c32a(p.text3)));
                            ui.label(v);
                            ui.end_row();
                        };
                        row(
                            "feels like",
                            RichText::new(fmt_temp(c.apparent_temperature_c, units)),
                        );
                        row(
                            "humidity",
                            RichText::new(format!("{:.0}%", c.relative_humidity_pct)),
                        );
                        row(
                            "wind",
                            RichText::new(format!(
                                "{} {}",
                                fmt_wind(c.wind_speed_kmh, units),
                                compass_8(c.wind_direction_deg)
                            )),
                        );
                        row(
                            "precip",
                            RichText::new(fmt_precip(c.precipitation_mm, units)),
                        );
                        row("cloud", RichText::new(format!("{:.0}%", c.cloud_cover_pct)));
                        row(
                            "uv",
                            RichText::new(format!("{:.0} {uv_text}", c.uv_index))
                                .color(c32(uv_col)),
                        );
                        if let Some(d) = sun {
                            row("sunrise", RichText::new(fmt_time_full(&d.sunrise, tf)));
                            row("sunset", RichText::new(fmt_time_full(&d.sunset, tf)));
                        }
                    });

                if let Some(text) = today_outlook(w, units) {
                    ui.add_space(6.0);
                    ui.add(egui::Label::new(RichText::new(text).color(c32a(p.text2))).wrap());
                }
                ui.add_space(6.0);
                ui.label(
                    RichText::new(format!("{:?} · {}", w.provider, w.timezone))
                        .small()
                        .color(c32a(p.text3)),
                );
                if let Some(e) = sh.weather_errors.get(&loc.id) {
                    error_text(ui, &p, &format!("last refresh failed: {e}"));
                }
            });
    }
}
