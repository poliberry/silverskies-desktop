use egui::{vec2, RichText, Sense, Ui};
use ss_core::weather::icons::pixel_icon;
use ss_core::weather::units::{fmt_date_short, fmt_temp};
use ss_core::PanelKind;

use super::{placeholder, Panel, PanelCx};
use crate::icons::weather_image;
use crate::theme::{c32, c32a};

pub struct ForecastPanel;

/// Fractions (start, end) of a day's low..high range within the week's range.
pub fn bar_fracs(lo: f64, hi: f64, week_min: f64, week_max: f64) -> (f32, f32) {
    let span = (week_max - week_min).max(0.001);
    let a = ((lo - week_min) / span).clamp(0.0, 1.0) as f32;
    let b = ((hi - week_min) / span).clamp(0.0, 1.0) as f32;
    (a.min(b), b.max(a))
}

impl Panel for ForecastPanel {
    fn kind(&self) -> PanelKind {
        PanelKind::Forecast
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
        let units = cx.shared.config.units;
        let days: Vec<_> = w.daily.iter().take(7).collect();
        if days.is_empty() {
            placeholder(ui, &p, "no data");
            return;
        }
        let wmin = days.iter().map(|d| d.temp_min_c).fold(f64::MAX, f64::min);
        let wmax = days.iter().map(|d| d.temp_max_c).fold(f64::MIN, f64::max);
        let bar_w = (ui.available_width() - 190.0).clamp(24.0, 160.0);

        for d in days {
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 6.0;
                ui.add_sized(
                    [64.0, 16.0],
                    egui::Label::new(RichText::new(fmt_date_short(&d.date)).color(c32a(p.text2))),
                );
                ui.add(weather_image(
                    ui.ctx(),
                    pixel_icon(d.weather_code, true),
                    &p,
                    16,
                ));
                ui.add_sized(
                    [44.0, 16.0],
                    egui::Label::new(
                        RichText::new(fmt_temp(d.temp_min_c, units)).color(c32a(p.text3)),
                    ),
                );
                let (rect, _) = ui.allocate_exact_size(vec2(bar_w, 8.0), Sense::hover());
                ui.painter().rect_filled(rect, 0.0, c32(p.surface3));
                let (a, b) = bar_fracs(d.temp_min_c, d.temp_max_c, wmin, wmax);
                let bar = egui::Rect::from_min_max(
                    egui::pos2(rect.left() + rect.width() * a, rect.top()),
                    egui::pos2(
                        (rect.left() + rect.width() * b).max(rect.left() + rect.width() * a + 2.0),
                        rect.bottom(),
                    ),
                );
                ui.painter().rect_filled(bar, 0.0, c32(p.a0));
                ui.label(RichText::new(fmt_temp(d.temp_max_c, units)));
                ui.label(
                    RichText::new(format!("{:.0}%", d.precipitation_probability_max_pct))
                        .small()
                        .color(c32a(p.text2)),
                );
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bar_fracs_scale_within_week_range() {
        assert_eq!(bar_fracs(0.0, 10.0, 0.0, 10.0), (0.0, 1.0));
        let (a, b) = bar_fracs(5.0, 10.0, 0.0, 20.0);
        assert!((a - 0.25).abs() < 1e-6 && (b - 0.5).abs() < 1e-6);
        // Degenerate week range does not divide by zero.
        let (a, b) = bar_fracs(3.0, 3.0, 3.0, 3.0);
        assert!(a.is_finite() && b.is_finite());
    }
}
