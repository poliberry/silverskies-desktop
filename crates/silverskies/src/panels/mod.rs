//! Dockable panels. Each panel is a small struct implementing [`Panel`]; the
//! layout engine owns where they are drawn.

use std::collections::HashMap;
use std::path::PathBuf;

use egui::{RichText, Ui};
use ss_core::command::Command;
use ss_core::theme::Palette;
use ss_core::{PanelKind, SavedLocation};

use crate::state::{PanelRequests, Shared, WindowTarget};
use crate::tasks::Tasks;
use crate::theme::{c32, c32a};

pub mod auditlog;
pub mod conditions;
pub mod forecast;
pub mod hourly;
pub mod locations;
pub mod radar;
pub mod radio;

pub struct PanelCx<'a> {
    pub shared: &'a mut Shared,
    pub tasks: &'a Tasks,
    pub palette: Palette,
    pub emit: &'a mut Vec<Command>,
    /// Requests addressed to this window's panels.
    pub req: &'a mut PanelRequests,
    /// The saved location this window tracks (cloned for the frame).
    pub location: Option<SavedLocation>,
    #[allow(dead_code)]
    pub window: WindowTarget,
    /// Set when the panel is the full-window backdrop of the main window:
    /// the bottom-aligned slot its floating controls should occupy.
    pub overlay: Option<egui::Rect>,
}

impl PanelCx<'_> {
    /// Id of the tracked location, or `""` when there is none.
    pub fn loc_id(&self) -> &str {
        self.location.as_ref().map(|l| l.id.as_str()).unwrap_or("")
    }
}

pub trait Panel {
    #[allow(dead_code)]
    fn kind(&self) -> PanelKind;
    fn ui(&mut self, ui: &mut Ui, cx: &mut PanelCx);
}

/// Everything needed to construct a fresh panel instance (used for the
/// initial docked set and for independent child-window instances).
pub struct PanelFactory {
    client: reqwest::Client,
    rt: tokio::runtime::Handle,
    tile_dir: Option<PathBuf>,
    ctx: egui::Context,
}

impl PanelFactory {
    pub fn new(
        client: reqwest::Client,
        rt: tokio::runtime::Handle,
        tile_dir: Option<PathBuf>,
        ctx: egui::Context,
    ) -> Self {
        Self {
            client,
            rt,
            tile_dir,
            ctx,
        }
    }

    pub fn make(&self, kind: PanelKind) -> Box<dyn Panel> {
        match kind {
            PanelKind::Locations => Box::new(locations::LocationsPanel::default()),
            PanelKind::Radar => Box::new(radar::RadarPanel::new(
                self.client.clone(),
                self.rt.clone(),
                self.tile_dir.clone(),
                self.ctx.clone(),
            )),
            PanelKind::AuditLog => Box::new(auditlog::AuditLogPanel::default()),
            PanelKind::Conditions => Box::new(conditions::ConditionsPanel),
            PanelKind::Forecast => Box::new(forecast::ForecastPanel),
            PanelKind::Hourly => Box::new(hourly::HourlyPanel),
            PanelKind::Radio => Box::new(radio::RadioPanel),
        }
    }
}

pub fn build_panels(factory: &PanelFactory) -> HashMap<PanelKind, Box<dyn Panel>> {
    PanelKind::ALL
        .iter()
        .map(|k| (*k, factory.make(*k)))
        .collect()
}

/// Dim placeholder text used by empty states.
pub fn placeholder(ui: &mut Ui, p: &Palette, text: &str) {
    ui.label(RichText::new(text).color(c32a(p.text3)));
}

pub fn error_text(ui: &mut Ui, p: &Palette, text: &str) {
    ui.add(egui::Label::new(RichText::new(text).color(c32(p.danger))).wrap());
}

/// Paint single-line, ellipsis-truncated multi-colour text. `pos` is the
/// left-centre of the line. Returns the width actually used.
pub fn paint_truncated(
    painter: &egui::Painter,
    pos: egui::Pos2,
    max_w: f32,
    parts: &[(String, egui::Color32)],
    font: egui::FontId,
) -> f32 {
    use egui::text::{LayoutJob, TextFormat};
    let mut job = LayoutJob::default();
    job.wrap.max_width = max_w;
    job.wrap.max_rows = 1;
    job.wrap.break_anywhere = true;
    job.wrap.overflow_character = Some('…');
    for (text, color) in parts {
        job.append(
            text,
            0.0,
            TextFormat {
                font_id: font.clone(),
                color: *color,
                ..Default::default()
            },
        );
    }
    let galley = painter.layout_job(job);
    let w = galley.size().x;
    let h = galley.size().y;
    painter.galley(
        egui::pos2(pos.x, pos.y - h / 2.0),
        galley,
        egui::Color32::WHITE,
    );
    w
}
