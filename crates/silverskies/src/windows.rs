//! Child windows: pop-out panels, independent radar / conditions / audit-log
//! instances, and the alert, settings and weather-radio windows. They are
//! drawn as immediate viewports from `App::ui` so their state stays plain
//! `&mut` data (the map layers are not `Send`).

use std::collections::HashMap;
use std::sync::Arc;

use egui::{Context, RichText, Ui, ViewportBuilder, ViewportClass, ViewportCommand, ViewportId};
use parking_lot::RwLock;
use ss_core::alerts::colors::effective_color;
use ss_core::command::Command;
use ss_core::geo::geometry_bbox;
use ss_core::theme::{brightness, Palette};
use ss_core::{
    Config, Layout, Location, PanelKind, SavedLocation, SessionWindow, WindowBounds, WindowRole,
};

use crate::app::App;
use crate::cmdbar::CommandBar;
use crate::commands::default_column;
use crate::layout::panel_frame;
use crate::panels::{placeholder, Panel, PanelCx, PanelFactory};
use crate::settings::{settings_ui, SettingsState};
use crate::state::{LogLevel, PanelRequests, Shared, WindowTarget};
use crate::tasks::Tasks;
use crate::theme::{c32, c32a};

const MIN_W: f32 = 200.0;
const MIN_H: f32 = 150.0;
const MAX_DIM: f32 = 10_000.0;
/// Reject positions further out than this (Windows reports -32000 for
/// minimised windows).
const MAX_POS: f32 = 20_000.0;

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

/// Drop garbage bounds: tiny, huge, non-finite or wildly off-screen.
pub fn sane_bounds(b: WindowBounds) -> Option<WindowBounds> {
    let finite = [b.x, b.y, b.width, b.height].iter().all(|v| v.is_finite());
    let ok = finite
        && (MIN_W..=MAX_DIM).contains(&b.width)
        && (MIN_H..=MAX_DIM).contains(&b.height)
        && b.x.abs() <= MAX_POS
        && b.y.abs() <= MAX_POS;
    ok.then_some(b)
}

/// Position from the outer rect, size from the inner rect (so restoring does
/// not grow the window by its decorations each launch).
pub fn bounds_from_rects(
    outer: Option<egui::Rect>,
    inner: Option<egui::Rect>,
) -> Option<WindowBounds> {
    let o = outer?;
    let size = inner.map(|r| r.size()).unwrap_or_else(|| o.size());
    sane_bounds(WindowBounds {
        x: o.min.x.round(),
        y: o.min.y.round(),
        width: size.x.round(),
        height: size.y.round(),
    })
}

/// The panel a window hosts, by role.
pub fn content_kind(role: WindowRole, panel: Option<PanelKind>) -> Option<PanelKind> {
    match role {
        WindowRole::Main => panel,
        WindowRole::Radar => Some(PanelKind::Radar),
        WindowRole::Conditions => Some(PanelKind::Conditions),
        WindowRole::AuditLog => Some(PanelKind::AuditLog),
        WindowRole::WeatherRadio => Some(PanelKind::Radio),
        WindowRole::Alert | WindowRole::Settings => None,
    }
}

fn window_title(role: WindowRole, panel: Option<PanelKind>, number: usize) -> String {
    match role {
        WindowRole::Main => match panel {
            Some(k) => format!("Silver Skies — {}", k.title()),
            None => "Silver Skies".to_string(),
        },
        WindowRole::Radar => format!("Silver Skies — Radar #{number}"),
        WindowRole::Conditions => "Silver Skies — Conditions".to_string(),
        WindowRole::AuditLog => "Silver Skies — Audit Log".to_string(),
        WindowRole::Alert => "Silver Skies — Alert".to_string(),
        WindowRole::WeatherRadio => "Silver Skies — Weather Radio".to_string(),
        WindowRole::Settings => "Silver Skies — Settings".to_string(),
    }
}

fn default_size(role: WindowRole, panel: Option<PanelKind>) -> [f32; 2] {
    match (role, panel) {
        (WindowRole::Radar, _) | (WindowRole::Main, Some(PanelKind::Radar)) => [900.0, 650.0],
        (WindowRole::Conditions, _) => [360.0, 480.0],
        (WindowRole::AuditLog, _) | (WindowRole::Main, Some(PanelKind::AuditLog)) => [700.0, 420.0],
        (WindowRole::Alert, _) => [520.0, 480.0],
        (WindowRole::Settings, _) => [560.0, 560.0],
        (WindowRole::WeatherRadio, _) => [420.0, 300.0],
        _ => [480.0, 420.0],
    }
}

/// Layout transition when a docked panel is popped out.
pub fn popout_layout(layout: &mut Layout, panel: PanelKind) {
    layout.hide(panel);
}

/// Layout transition when a popped-out panel's window closes: back into its
/// default column.
pub fn redock_layout(layout: &mut Layout, panel: PanelKind) {
    layout.place(panel, default_column(panel), None);
}

fn resolve_radar(w: &ChildWindow, sh: &Shared) -> Option<SavedLocation> {
    w.location_id
        .as_deref()
        .and_then(|id| sh.location_by_id(id))
        .cloned()
        .or_else(|| sh.active_location().cloned())
}

/// The saved location a window tracks right now: a radar instance its own
/// `location_id`; a conditions / audit-log window the radar it is paired
/// with; everything else the global active location.
pub fn resolve_location(
    window: &ChildWindow,
    windows: &[ChildWindow],
    sh: &Shared,
) -> Option<SavedLocation> {
    match window.role {
        WindowRole::Radar => resolve_radar(window, sh),
        WindowRole::Conditions | WindowRole::AuditLog => {
            let radar = window.paired.as_deref().and_then(|pid| {
                windows
                    .iter()
                    .find(|x| x.id == pid && x.role == WindowRole::Radar)
            });
            match radar {
                Some(r) => resolve_radar(r, sh),
                None => sh.active_location().cloned(),
            }
        }
        _ => sh.active_location().cloned(),
    }
}

/// The request set a command issued from `target` applies to.
pub fn req_mut<'a>(
    main: &'a mut PanelRequests,
    wm: &'a mut WindowManager,
    target: &WindowTarget,
) -> Option<&'a mut PanelRequests> {
    match target {
        WindowTarget::Main => Some(main),
        WindowTarget::Child(id) => wm.get_mut(id).map(|w| &mut w.req),
    }
}

/// The persisted form of the open windows. `Alert` windows are transient and
/// skipped; bad bounds are dropped.
pub fn session_windows(windows: &[ChildWindow], locations: &[SavedLocation]) -> Vec<SessionWindow> {
    windows
        .iter()
        .filter(|w| w.role != WindowRole::Alert)
        .map(|w| SessionWindow {
            role: w.role,
            instance_id: (w.role != WindowRole::Main).then(|| w.id.clone()),
            paired_instance_id: w.paired.clone(),
            is_primary_popout: w.is_primary_popout,
            location: (w.role == WindowRole::Radar)
                .then(|| {
                    w.location_id
                        .as_deref()
                        .and_then(|id| locations.iter().find(|l| l.id == id))
                        .map(|l| Location::new(l.lat, l.lon, l.label.clone()))
                })
                .flatten(),
            bounds: w.bounds.and_then(sane_bounds),
            panel: w.panel,
        })
        .collect()
}

/// Rebuild windows (without panel instances) from a saved session.
pub fn restore_windows(saved: &[SessionWindow], locations: &[SavedLocation]) -> WindowManager {
    let mut wm = WindowManager::default();
    for sw in saved {
        match sw.role {
            WindowRole::Alert => continue,
            WindowRole::Main if sw.panel.is_none_or(|k| wm.popout_of(k).is_some()) => continue,
            WindowRole::Settings | WindowRole::WeatherRadio
                if wm.first_of_role(sw.role).is_some() =>
            {
                continue
            }
            _ => {}
        }
        let number = if sw.role == WindowRole::Radar {
            wm.next_radar_number()
        } else {
            0
        };
        let mut w = ChildWindow::new(sw.role, number);
        if let Some(id) = sw.instance_id.clone().filter(|i| !i.is_empty()) {
            if wm.get(&id).is_none() {
                w.id = id;
            }
        }
        if sw.role == WindowRole::Main {
            w.panel = sw.panel;
            w.is_primary_popout = true;
            w.title = window_title(w.role, w.panel, 0);
        }
        w.paired = sw
            .paired_instance_id
            .clone()
            .filter(|p| p != "main" && !p.is_empty());
        w.location_id = sw.location.as_ref().and_then(|loc| {
            locations
                .iter()
                .find(|l| (l.lat - loc.lat).abs() < 0.005 && (l.lon - loc.lon).abs() < 0.005)
                .map(|l| l.id.clone())
        });
        w.bounds = sw.bounds.and_then(sane_bounds);
        w.initial = w.bounds;
        wm.windows.push(w);
    }
    wm
}

/// Read-only, pretty-printed config with secrets masked.
pub fn config_text(cfg: &Config) -> String {
    fn mask(v: &mut serde_json::Value) {
        match v {
            serde_json::Value::Object(m) => {
                for (k, val) in m.iter_mut() {
                    if k.to_ascii_lowercase().ends_with("apikey") && !val.is_null() {
                        *val = serde_json::Value::String("(set)".to_string());
                    } else {
                        mask(val);
                    }
                }
            }
            serde_json::Value::Array(a) => a.iter_mut().for_each(mask),
            _ => {}
        }
    }
    let mut v = serde_json::to_value(cfg).unwrap_or(serde_json::Value::Null);
    mask(&mut v);
    serde_json::to_string_pretty(&v).unwrap_or_default()
}

/// `Mon Nov 10, 3:04 PM` in local time, or the raw string when unparseable.
fn fmt_when(raw: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(raw)
        .map(|t| {
            t.with_timezone(&chrono::Local)
                .format("%a %b %-d, %-I:%M %p")
                .to_string()
        })
        .unwrap_or_else(|_| raw.to_string())
}

// ---------------------------------------------------------------------------
// Window state
// ---------------------------------------------------------------------------

pub struct ChildWindow {
    /// Instance id (uuid).
    pub id: String,
    pub role: WindowRole,
    /// For `Main`-role pop-outs: which dock panel this window hosts.
    pub panel: Option<PanelKind>,
    pub is_primary_popout: bool,
    /// The radar window a conditions / audit-log window tracks (`None` = main).
    pub paired: Option<String>,
    /// Saved-location id a radar instance tracks (`None` = global active).
    pub location_id: Option<String>,
    pub panels: HashMap<PanelKind, Box<dyn Panel>>,
    pub cmdbar: CommandBar,
    pub req: PanelRequests,
    /// Live bounds, refreshed every frame from the viewport.
    pub bounds: Option<WindowBounds>,
    /// Bounds used to create the window; constant so egui never fights the
    /// user's own moves.
    pub initial: Option<WindowBounds>,
    pub alert_id: Option<String>,
    pub title: String,
    /// UI state of a settings window.
    pub settings: SettingsState,
}

impl ChildWindow {
    pub fn new(role: WindowRole, number: usize) -> ChildWindow {
        ChildWindow {
            id: uuid::Uuid::new_v4().to_string(),
            role,
            panel: None,
            is_primary_popout: false,
            paired: None,
            location_id: None,
            panels: HashMap::new(),
            cmdbar: CommandBar::default(),
            req: PanelRequests::default(),
            bounds: None,
            initial: None,
            alert_id: None,
            title: window_title(role, None, number),
            settings: SettingsState::default(),
        }
    }

    pub fn viewport_id(&self) -> ViewportId {
        ViewportId::from_hash_of(("silverskies-window", &self.id))
    }

    fn builder(&self) -> ViewportBuilder {
        let [w, h] = default_size(self.role, self.panel);
        let mut b = ViewportBuilder::default()
            .with_title(self.title.clone())
            .with_inner_size([w, h])
            .with_min_inner_size([MIN_W, MIN_H]);
        if let Some(r) = self.initial {
            b = b
                .with_position([r.x, r.y])
                .with_inner_size([r.width, r.height]);
        }
        b
    }

    /// Draw the window. Returns true when the user closed it.
    fn show(
        &mut self,
        ctx: &Context,
        shared: &Arc<RwLock<Shared>>,
        tasks: &Tasks,
        main_req: &mut PanelRequests,
        location: Option<SavedLocation>,
        emit: &mut Vec<(WindowTarget, Command)>,
    ) -> bool {
        let vid = self.viewport_id();
        let builder = self.builder();
        let target = WindowTarget::Child(self.id.clone());
        let mut close = false;
        ctx.show_viewport_immediate(vid, builder, |ui, class| {
            let ctx = ui.ctx().clone();
            if class != ViewportClass::EmbeddedWindow
                && ctx.input(|i| i.viewport().close_requested())
            {
                close = true;
            }
            if let Some(b) =
                ctx.input(|i| bounds_from_rects(i.viewport().outer_rect, i.viewport().inner_rect))
            {
                self.bounds = Some(b);
            }
            self.cmdbar.handle_global_keys(&ctx);

            let mut sh = shared.write();
            let h = ctx.content_rect().height();
            egui::Panel::bottom("cmdbar")
                .exact_size(self.cmdbar.panel_height(h))
                .resizable(false)
                .show(ui, |ui| {
                    if let Some(c) = self.cmdbar.show(ui, &mut sh, location.as_ref()) {
                        emit.push((target.clone(), c));
                    }
                });
            let frame = egui::Frame::NONE.fill(c32(sh.palette.bg));
            egui::CentralPanel::default().frame(frame).show(ui, |ui| {
                self.draw(ui, &mut sh, tasks, main_req, location.clone(), emit);
            });
        });
        close
    }

    fn draw(
        &mut self,
        ui: &mut Ui,
        sh: &mut Shared,
        tasks: &Tasks,
        main_req: &mut PanelRequests,
        location: Option<SavedLocation>,
        emit: &mut Vec<(WindowTarget, Command)>,
    ) {
        let p = sh.palette;
        let target = WindowTarget::Child(self.id.clone());
        match self.role {
            WindowRole::Alert => {
                let id = self.alert_id.clone();
                panel_frame(ui, &p, "ALERT", |ui| {
                    alert_ui(ui, sh, id.as_deref(), &p, main_req);
                });
            }
            WindowRole::Settings => {
                let mut cmds: Vec<Command> = Vec::new();
                panel_frame(ui, &p, "SETTINGS", |ui| {
                    settings_ui(ui, sh, &p, &mut self.settings, &mut cmds);
                });
                emit.extend(cmds.into_iter().map(|c| (target.clone(), c)));
            }
            role => {
                let Some(kind) = content_kind(role, self.panel) else {
                    return;
                };
                let title = match (&role, &location) {
                    (WindowRole::Main, _) | (_, None) => kind.title().to_string(),
                    (_, Some(l)) => format!("{}  ·  {}", kind.title(), l.label),
                };
                let mut cmds: Vec<Command> = Vec::new();
                panel_frame(ui, &p, &title, |ui| {
                    if let Some(panel) = self.panels.get_mut(&kind) {
                        let mut cx = PanelCx {
                            shared: &mut *sh,
                            tasks,
                            palette: p,
                            emit: &mut cmds,
                            req: &mut self.req,
                            location: location.clone(),
                            window: target.clone(),
                            overlay: None,
                        };
                        panel.ui(ui, &mut cx);
                    }
                });
                emit.extend(cmds.into_iter().map(|c| (target.clone(), c)));
            }
        }
    }
}

fn alert_ui(ui: &mut Ui, sh: &Shared, id: Option<&str>, p: &Palette, main_req: &mut PanelRequests) {
    let Some(a) = id.and_then(|id| sh.find_alert(id)).cloned() else {
        placeholder(ui, p, "alert expired");
        return;
    };
    let rgb = effective_color(&a.class, &sh.config.alert_type_overrides);
    let on = if brightness(rgb) > 140.0 {
        egui::Color32::BLACK
    } else {
        egui::Color32::WHITE
    };
    egui::Frame::NONE
        .fill(egui::Color32::from_rgb(rgb[0], rgb[1], rgb[2]))
        .inner_margin(egui::Margin::symmetric(8, 6))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.label(
                RichText::new(&a.display_event)
                    .size(18.0)
                    .strong()
                    .color(on),
            );
            ui.label(RichText::new(a.severity.label()).color(on));
        });
    ui.add_space(4.0);
    egui::ScrollArea::vertical()
        .id_salt("alert_scroll")
        .auto_shrink([false, false])
        .show(ui, |ui| {
            let wrap = |ui: &mut Ui, text: RichText| {
                ui.add(egui::Label::new(text).wrap());
            };
            if let Some(area) = &a.area_desc {
                wrap(ui, RichText::new(area).color(c32a(p.text2)));
            }
            if let Some(h) = &a.headline {
                wrap(ui, RichText::new(h).strong());
            }
            if let Some(t) = &a.onset {
                wrap(
                    ui,
                    RichText::new(format!("onset    {}", fmt_when(t))).color(c32a(p.text3)),
                );
            }
            if let Some(t) = &a.expires {
                wrap(
                    ui,
                    RichText::new(format!("expires  {}", fmt_when(t))).color(c32a(p.text3)),
                );
            }
            if let Some(d) = &a.description {
                ui.add_space(6.0);
                wrap(ui, RichText::new(d.trim()).color(c32a(p.text2)));
            }
            if let Some(i) = &a.instruction {
                ui.add_space(6.0);
                wrap(ui, RichText::new(i.trim()).color(c32(p.a0)));
            }
            if let Some(o) = &a.issuing_office {
                ui.add_space(6.0);
                wrap(
                    ui,
                    RichText::new(format!("issued by {o}")).color(c32a(p.text3)),
                );
            }
            if let Some(b) = a.geometry.as_ref().and_then(geometry_bbox) {
                ui.add_space(6.0);
                if ui
                    .add(
                        egui::Button::new(RichText::new("show on map").color(c32(p.a0)))
                            .frame(false),
                    )
                    .clicked()
                {
                    main_req.pending_focus = Some(b);
                }
            }
        });
}

fn take_radar_requests(src: &mut PanelRequests) -> PanelRequests {
    PanelRequests {
        pending_focus: src.pending_focus.take(),
        map_recenter: std::mem::take(&mut src.map_recenter),
        map_zoom: src.map_zoom.take(),
        clear_selection: std::mem::take(&mut src.clear_selection),
        ..PanelRequests::default()
    }
}

fn merge_radar_requests(dst: &mut PanelRequests, r: PanelRequests) {
    if r.pending_focus.is_some() {
        dst.pending_focus = r.pending_focus;
    }
    dst.map_recenter |= r.map_recenter;
    if r.map_zoom.is_some() {
        dst.map_zoom = r.map_zoom;
    }
    dst.clear_selection |= r.clear_selection;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct WindowManager {
    pub windows: Vec<ChildWindow>,
    radar_counter: usize,
}

impl WindowManager {
    pub fn next_radar_number(&mut self) -> usize {
        self.radar_counter += 1;
        self.radar_counter
    }

    pub fn get(&self, id: &str) -> Option<&ChildWindow> {
        self.windows.iter().find(|w| w.id == id)
    }

    pub fn get_mut(&mut self, id: &str) -> Option<&mut ChildWindow> {
        self.windows.iter_mut().find(|w| w.id == id)
    }

    pub fn is_radar(&self, id: &str) -> bool {
        self.get(id).is_some_and(|w| w.role == WindowRole::Radar)
    }

    /// The pop-out window hosting a dock panel, if any.
    pub fn popout_of(&self, panel: PanelKind) -> Option<&ChildWindow> {
        self.windows
            .iter()
            .find(|w| w.is_primary_popout && w.panel == Some(panel))
    }

    pub fn first_of_role(&self, role: WindowRole) -> Option<&ChildWindow> {
        self.windows.iter().find(|w| w.role == role)
    }

    pub fn remove(&mut self, id: &str) -> Option<ChildWindow> {
        let i = self.windows.iter().position(|w| w.id == id)?;
        Some(self.windows.remove(i))
    }

    /// The location a command issued from `target` should act on.
    pub fn location_for(&self, target: &WindowTarget, sh: &Shared) -> Option<SavedLocation> {
        match target {
            WindowTarget::Main => sh.active_location().cloned(),
            WindowTarget::Child(id) => match self.get(id) {
                Some(w) => resolve_location(w, &self.windows, sh),
                None => sh.active_location().cloned(),
            },
        }
    }

    pub fn focus(&self, ctx: &Context, id: &str) {
        if let Some(w) = self.get(id) {
            ctx.send_viewport_cmd_to(w.viewport_id(), ViewportCommand::Focus);
        }
    }

    /// Give restored windows their panel instances. Pop-outs take their panel
    /// out of the dock set (and the layout); a missing panel drops the window.
    pub fn attach_panels(
        &mut self,
        factory: &PanelFactory,
        dock: &mut HashMap<PanelKind, Box<dyn Panel>>,
        layout: &mut Layout,
    ) {
        self.windows.retain_mut(|w| {
            let Some(kind) = content_kind(w.role, w.panel) else {
                return true;
            };
            if w.role == WindowRole::Main {
                let Some(panel) = dock.remove(&kind) else {
                    return false;
                };
                popout_layout(layout, kind);
                w.panels.insert(kind, panel);
            } else {
                w.panels.insert(kind, factory.make(kind));
            }
            true
        });
    }

    /// Forward radar-bound requests (focus / recenter / zoom / clear) to
    /// whichever window currently hosts the main radar: the pop-out when the
    /// radar is popped out, otherwise the main window.
    pub fn route_radar_requests(&mut self, main: &mut PanelRequests) {
        let radar_idx = self
            .windows
            .iter()
            .position(|w| w.is_primary_popout && w.panel == Some(PanelKind::Radar));
        let mut batch: Vec<PanelRequests> = Vec::new();
        for (i, w) in self.windows.iter_mut().enumerate() {
            if w.is_primary_popout && Some(i) != radar_idx {
                batch.push(take_radar_requests(&mut w.req));
            }
        }
        match radar_idx {
            Some(i) => {
                batch.push(take_radar_requests(main));
                for b in batch {
                    merge_radar_requests(&mut self.windows[i].req, b);
                }
            }
            None => {
                for b in batch {
                    merge_radar_requests(main, b);
                }
            }
        }
    }

    /// Draw every window. Returns the ids of windows the user closed.
    pub fn show_all(
        &mut self,
        ctx: &Context,
        shared: &Arc<RwLock<Shared>>,
        tasks: &Tasks,
        main_req: &mut PanelRequests,
        emit: &mut Vec<(WindowTarget, Command)>,
    ) -> Vec<String> {
        let locs: Vec<Option<SavedLocation>> = {
            let sh = shared.read();
            self.windows
                .iter()
                .map(|w| resolve_location(w, &self.windows, &sh))
                .collect()
        };
        let mut closed = Vec::new();
        for (w, loc) in self.windows.iter_mut().zip(locs) {
            if w.show(ctx, shared, tasks, main_req, loc, emit) {
                closed.push(w.id.clone());
            }
        }
        closed
    }
}

// ---------------------------------------------------------------------------
// Window operations on the app
// ---------------------------------------------------------------------------

impl App {
    fn focus_window(&self, id: &str) {
        self.windows.focus(&self.ctx, id);
    }

    /// `:popout <panel>`: move a dock panel into its own window.
    pub fn popout_panel(&mut self, sh: &mut Shared, kind: PanelKind) {
        if let Some(id) = self.windows.popout_of(kind).map(|w| w.id.clone()) {
            self.focus_window(&id);
            sh.log(
                LogLevel::Info,
                format!("{} is already in its own window", kind.title()),
            );
            return;
        }
        let Some(panel) = self.panels.remove(&kind) else {
            sh.log(
                LogLevel::Error,
                format!("popout: {} unavailable", kind.title()),
            );
            return;
        };
        popout_layout(&mut sh.layout, kind);
        sh.dirty_session = true;
        let mut w = ChildWindow::new(WindowRole::Main, 0);
        w.panel = Some(kind);
        w.is_primary_popout = true;
        w.title = window_title(WindowRole::Main, Some(kind), 0);
        w.panels.insert(kind, panel);
        sh.log(LogLevel::Info, format!("popped out {}", kind.title()));
        self.windows.windows.push(w);
    }

    /// `:radar new` / `:open radar`.
    pub fn open_radar(&mut self, sh: &mut Shared) {
        let n = self.windows.next_radar_number();
        let mut w = ChildWindow::new(WindowRole::Radar, n);
        w.location_id = sh.active_location().map(|l| l.id.clone());
        w.panels
            .insert(PanelKind::Radar, self.factory.make(PanelKind::Radar));
        sh.log(LogLevel::Info, format!("opened radar #{n}"));
        self.windows.windows.push(w);
    }

    /// `:open <role>` issued from `target`.
    pub fn open_window(&mut self, sh: &mut Shared, target: &WindowTarget, role: WindowRole) {
        match role {
            WindowRole::Main => sh.log(LogLevel::Info, "main window is always open"),
            WindowRole::Radar => self.open_radar(sh),
            WindowRole::Conditions | WindowRole::AuditLog => {
                let kind = content_kind(role, None).unwrap_or(PanelKind::Conditions);
                let mut w = ChildWindow::new(role, 0);
                w.paired = target
                    .child_id()
                    .filter(|id| self.windows.is_radar(id))
                    .map(str::to_string);
                w.panels.insert(kind, self.factory.make(kind));
                sh.log(LogLevel::Info, format!("opened {}", kind.title()));
                self.windows.windows.push(w);
            }
            WindowRole::Settings | WindowRole::WeatherRadio => {
                if let Some(id) = self.windows.first_of_role(role).map(|w| w.id.clone()) {
                    self.focus_window(&id);
                    sh.log(LogLevel::Info, "that window is already open");
                    return;
                }
                let mut w = ChildWindow::new(role, 0);
                if let Some(kind) = content_kind(role, None) {
                    w.panels.insert(kind, self.factory.make(kind));
                }
                sh.log(LogLevel::Info, "opened window");
                self.windows.windows.push(w);
            }
            WindowRole::Alert => {
                let sel = req_mut(&mut self.req, &mut self.windows, target)
                    .and_then(|r| r.selected_alert_id.clone());
                let Some(alert_id) = sel else {
                    sh.log(
                        LogLevel::Error,
                        "open alert: no alert selected (use :alerts show <n>)",
                    );
                    return;
                };
                if let Some(id) = self
                    .windows
                    .windows
                    .iter()
                    .find(|w| {
                        w.role == WindowRole::Alert && w.alert_id.as_deref() == Some(&alert_id)
                    })
                    .map(|w| w.id.clone())
                {
                    self.focus_window(&id);
                    return;
                }
                let mut w = ChildWindow::new(WindowRole::Alert, 0);
                if let Some(a) = sh.find_alert(&alert_id) {
                    w.title = format!("Silver Skies — {}", a.display_event);
                }
                w.req.selected_alert_id = Some(alert_id.clone());
                w.alert_id = Some(alert_id);
                self.windows.windows.push(w);
            }
        }
    }

    /// A popped-out panel that is asked to dock again: close its window.
    pub fn redock_if_popped(&mut self, sh: &mut Shared, kind: PanelKind) {
        if let Some(id) = self.windows.popout_of(kind).map(|w| w.id.clone()) {
            self.close_window(sh, &id);
        }
    }

    /// After a layout reset, keep popped-out panels out of the dock.
    pub fn hide_popped_out(&mut self, sh: &mut Shared) {
        for w in &self.windows.windows {
            if let (true, Some(kind)) = (w.is_primary_popout, w.panel) {
                popout_layout(&mut sh.layout, kind);
            }
        }
    }

    /// Close a child window; a pop-out hands its panel back to the dock.
    pub fn close_window(&mut self, sh: &mut Shared, id: &str) {
        let Some(mut w) = self.windows.remove(id) else {
            return;
        };
        if w.is_primary_popout {
            if let Some(kind) = w.panel {
                if let Some(panel) = w.panels.remove(&kind) {
                    self.panels.insert(kind, panel);
                }
                redock_layout(&mut sh.layout, kind);
                sh.dirty_session = true;
                sh.log(LogLevel::Info, format!("re-docked {}", kind.title()));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ss_core::{LocationsFile, SessionFile};

    fn loc(id: &str, lat: f64) -> SavedLocation {
        SavedLocation {
            id: id.to_string(),
            label: format!("Place {id}"),
            lat,
            lon: -100.0,
            accu_weather_location_key: None,
        }
    }

    fn shared(active: Option<&str>) -> Shared {
        let locations = LocationsFile {
            saved_locations: vec![loc("a", 30.0), loc("b", 40.0)],
            active_location_id: active.map(str::to_string),
        };
        Shared::new(Config::default(), locations, SessionFile::default())
    }

    fn bounds(w: f32, h: f32) -> WindowBounds {
        WindowBounds {
            x: 10.0,
            y: 20.0,
            width: w,
            height: h,
        }
    }

    fn radar(id: &str, location: Option<&str>) -> ChildWindow {
        let mut w = ChildWindow::new(WindowRole::Radar, 1);
        w.id = id.to_string();
        w.location_id = location.map(str::to_string);
        w
    }

    #[test]
    fn sane_bounds_filters_garbage() {
        assert!(sane_bounds(bounds(800.0, 600.0)).is_some());
        assert!(sane_bounds(bounds(199.0, 600.0)).is_none());
        assert!(sane_bounds(bounds(800.0, 149.0)).is_none());
        assert!(sane_bounds(bounds(10_001.0, 600.0)).is_none());
        assert!(sane_bounds(bounds(f32::NAN, 600.0)).is_none());
        let mut off = bounds(800.0, 600.0);
        off.x = -32_000.0;
        assert!(sane_bounds(off).is_none());
    }

    #[test]
    fn session_skips_alert_windows() {
        let mut alert = ChildWindow::new(WindowRole::Alert, 0);
        alert.alert_id = Some("x".into());
        let windows = vec![
            radar("r1", Some("a")),
            alert,
            ChildWindow::new(WindowRole::Settings, 0),
        ];
        let saved = session_windows(&windows, &shared(None).locations.saved_locations);
        assert_eq!(saved.len(), 2);
        assert!(saved.iter().all(|s| s.role != WindowRole::Alert));
    }

    #[test]
    fn session_drops_bad_bounds_and_keeps_good_ones() {
        let mut good = radar("r1", None);
        good.bounds = Some(bounds(800.0, 600.0));
        let mut bad = radar("r2", None);
        bad.bounds = Some(bounds(50.0, 50.0));
        let saved = session_windows(&[good, bad], &[]);
        assert_eq!(saved[0].bounds, Some(bounds(800.0, 600.0)));
        assert_eq!(saved[1].bounds, None);
    }

    #[test]
    fn session_round_trips_radar_pairing_and_location() {
        let locs = shared(None).locations.saved_locations;
        let mut r = radar("r1", Some("b"));
        r.bounds = Some(bounds(900.0, 650.0));
        let mut c = ChildWindow::new(WindowRole::Conditions, 0);
        c.id = "c1".into();
        c.paired = Some("r1".into());
        let mut pop = ChildWindow::new(WindowRole::Main, 0);
        pop.panel = Some(PanelKind::Forecast);
        pop.is_primary_popout = true;
        let saved = session_windows(&[r, c, pop], &locs);
        assert_eq!(saved[0].instance_id.as_deref(), Some("r1"));
        assert_eq!(saved[0].location.as_ref().map(|l| l.lat), Some(40.0));
        assert_eq!(saved[2].instance_id, None);

        let wm = restore_windows(&saved, &locs);
        assert_eq!(wm.windows.len(), 3);
        let r = wm.get("r1").unwrap();
        assert_eq!(r.location_id.as_deref(), Some("b"));
        assert_eq!(r.bounds, Some(bounds(900.0, 650.0)));
        assert_eq!(r.initial, r.bounds);
        assert_eq!(wm.get("c1").unwrap().paired.as_deref(), Some("r1"));
        assert!(wm.popout_of(PanelKind::Forecast).is_some());
        // And back again: the session form is stable.
        assert_eq!(session_windows(&wm.windows, &locs), saved);
    }

    #[test]
    fn restore_skips_alerts_duplicates_and_panelless_main() {
        let mk = |role, panel| SessionWindow {
            role,
            instance_id: None,
            paired_instance_id: None,
            is_primary_popout: role == WindowRole::Main,
            location: None,
            bounds: None,
            panel,
        };
        let saved = vec![
            mk(WindowRole::Alert, None),
            mk(WindowRole::Main, None),
            mk(WindowRole::Main, Some(PanelKind::Radar)),
            mk(WindowRole::Main, Some(PanelKind::Radar)),
            mk(WindowRole::Settings, None),
            mk(WindowRole::Settings, None),
            mk(WindowRole::WeatherRadio, None),
            mk(WindowRole::WeatherRadio, None),
        ];
        let wm = restore_windows(&saved, &[]);
        let roles: Vec<WindowRole> = wm.windows.iter().map(|w| w.role).collect();
        assert_eq!(
            roles,
            vec![
                WindowRole::Main,
                WindowRole::Settings,
                WindowRole::WeatherRadio
            ]
        );
    }

    #[test]
    fn restore_treats_main_pairing_as_none_and_fixes_duplicate_ids() {
        let mk = |paired: Option<&str>| SessionWindow {
            role: WindowRole::AuditLog,
            instance_id: Some("same".into()),
            paired_instance_id: paired.map(str::to_string),
            is_primary_popout: false,
            location: None,
            bounds: None,
            panel: None,
        };
        let wm = restore_windows(&[mk(Some("main")), mk(None)], &[]);
        assert_eq!(wm.windows[0].paired, None);
        assert_ne!(wm.windows[0].id, wm.windows[1].id);
    }

    #[test]
    fn popout_hides_and_redock_returns_to_default_column() {
        let mut l = Layout::default();
        popout_layout(&mut l, PanelKind::Hourly);
        assert!(!l.is_docked(PanelKind::Hourly));
        assert!(l.hidden.contains(&PanelKind::Hourly));
        redock_layout(&mut l, PanelKind::Hourly);
        assert!(l.is_docked(PanelKind::Hourly));
        assert!(l.hidden.is_empty());
        assert_eq!(
            l.find(PanelKind::Hourly).map(|f| f.0),
            Some(ss_core::Column::Right)
        );
    }

    #[test]
    fn redock_of_a_moved_panel_does_not_duplicate_it() {
        let mut l = Layout::default();
        popout_layout(&mut l, PanelKind::Radar);
        redock_layout(&mut l, PanelKind::Radar);
        redock_layout(&mut l, PanelKind::Radar);
        let count = [&l.left, &l.center, &l.right]
            .iter()
            .flat_map(|c| c.iter())
            .filter(|k| **k == PanelKind::Radar)
            .count();
        assert_eq!(count, 1);
    }

    #[test]
    fn radar_resolves_its_own_location_then_falls_back_to_active() {
        let sh = shared(Some("a"));
        let own = radar("r1", Some("b"));
        assert_eq!(
            resolve_location(&own, &[], &sh).map(|l| l.id),
            Some("b".into())
        );
        let unknown = radar("r2", Some("gone"));
        assert_eq!(
            resolve_location(&unknown, &[], &sh).map(|l| l.id),
            Some("a".into())
        );
        let unset = radar("r3", None);
        assert_eq!(
            resolve_location(&unset, &[], &sh).map(|l| l.id),
            Some("a".into())
        );
    }

    #[test]
    fn paired_window_follows_its_radar() {
        let sh = shared(Some("a"));
        let r = radar("r1", Some("b"));
        let mut c = ChildWindow::new(WindowRole::Conditions, 0);
        c.paired = Some("r1".into());
        let windows = vec![r, c];
        let got = resolve_location(&windows[1], &windows, &sh);
        assert_eq!(got.map(|l| l.id), Some("b".into()));
    }

    #[test]
    fn unpaired_or_orphaned_window_follows_global_active() {
        let sh = shared(Some("a"));
        let mut c = ChildWindow::new(WindowRole::AuditLog, 0);
        assert_eq!(
            resolve_location(&c, &[], &sh).map(|l| l.id),
            Some("a".into())
        );
        c.paired = Some("closed-radar".into());
        assert_eq!(
            resolve_location(&c, &[], &sh).map(|l| l.id),
            Some("a".into())
        );
        assert!(resolve_location(&c, &[], &shared(None)).is_none());
    }

    #[test]
    fn location_for_target_uses_the_issuing_window() {
        let sh = shared(Some("a"));
        let mut wm = WindowManager::default();
        wm.windows.push(radar("r1", Some("b")));
        let main = wm.location_for(&WindowTarget::Main, &sh).map(|l| l.id);
        let child = wm
            .location_for(&WindowTarget::Child("r1".into()), &sh)
            .map(|l| l.id);
        assert_eq!(main.as_deref(), Some("a"));
        assert_eq!(child.as_deref(), Some("b"));
    }

    #[test]
    fn zoom_from_a_child_updates_only_that_childs_requests() {
        let mut main = PanelRequests::default();
        let mut wm = WindowManager::default();
        wm.windows.push(radar("r1", None));
        wm.windows.push(radar("r2", None));
        let t = WindowTarget::Child("r1".into());
        req_mut(&mut main, &mut wm, &t).unwrap().map_zoom = Some(8.0);
        assert_eq!(main.map_zoom, None);
        assert_eq!(wm.get("r1").unwrap().req.map_zoom, Some(8.0));
        assert_eq!(wm.get("r2").unwrap().req.map_zoom, None);
        req_mut(&mut main, &mut wm, &WindowTarget::Main)
            .unwrap()
            .map_recenter = true;
        assert!(main.map_recenter);
        assert!(!wm.get("r1").unwrap().req.map_recenter);
        assert!(req_mut(&mut main, &mut wm, &WindowTarget::Child("nope".into())).is_none());
    }

    #[test]
    fn content_kind_maps_roles() {
        assert_eq!(
            content_kind(WindowRole::Radar, None),
            Some(PanelKind::Radar)
        );
        assert_eq!(
            content_kind(WindowRole::WeatherRadio, None),
            Some(PanelKind::Radio)
        );
        assert_eq!(
            content_kind(WindowRole::Main, Some(PanelKind::Hourly)),
            Some(PanelKind::Hourly)
        );
        assert_eq!(content_kind(WindowRole::Alert, None), None);
        assert_eq!(content_kind(WindowRole::Settings, None), None);
    }

    #[test]
    fn config_text_masks_api_keys() {
        let cfg = Config {
            accu_weather_api_key: Some("sekrit".into()),
            ..Config::default()
        };
        let t = config_text(&cfg);
        assert!(!t.contains("sekrit"));
        assert!(t.contains("(set)"));
        assert!(t.contains("libreWxrHost"));
    }

    #[test]
    fn radar_windows_are_numbered_and_titled() {
        let mut wm = WindowManager::default();
        assert_eq!(wm.next_radar_number(), 1);
        assert_eq!(wm.next_radar_number(), 2);
        assert_eq!(
            window_title(WindowRole::Radar, None, 2),
            "Silver Skies — Radar #2"
        );
        assert_eq!(
            window_title(WindowRole::Main, Some(PanelKind::Hourly), 0),
            "Silver Skies — HOURLY"
        );
    }

    fn popout(kind: PanelKind) -> ChildWindow {
        let mut w = ChildWindow::new(WindowRole::Main, 0);
        w.panel = Some(kind);
        w.is_primary_popout = true;
        w
    }

    #[test]
    fn radar_requests_follow_a_popped_out_radar() {
        let mut main = PanelRequests {
            map_zoom: Some(6.0),
            map_recenter: true,
            selected_alert_id: Some("keep".into()),
            ..PanelRequests::default()
        };
        let mut wm = WindowManager::default();
        wm.windows.push(popout(PanelKind::Radar));
        wm.route_radar_requests(&mut main);
        assert_eq!(main.map_zoom, None);
        assert!(!main.map_recenter);
        assert_eq!(main.selected_alert_id.as_deref(), Some("keep"));
        assert_eq!(wm.windows[0].req.map_zoom, Some(6.0));
        assert!(wm.windows[0].req.map_recenter);
    }

    #[test]
    fn radar_requests_from_other_popouts_land_in_main_when_radar_is_docked() {
        let mut main = PanelRequests::default();
        let mut wm = WindowManager::default();
        let mut log = popout(PanelKind::AuditLog);
        log.req.pending_focus = Some(ss_core::BBox::new(-1.0, -1.0, 1.0, 1.0));
        wm.windows.push(log);
        wm.route_radar_requests(&mut main);
        assert!(main.pending_focus.is_some());
        assert!(wm.windows[0].req.pending_focus.is_none());
    }
}
