//! The three-column dockable panel area.

use std::collections::HashMap;

use egui::{
    pos2, vec2, Align, Align2, Color32, FontId, Id, LayerId, Order, Rect, Sense, Stroke,
    StrokeKind, Ui, UiBuilder,
};
use ss_core::command::Command;
use ss_core::{Column, Layout, PanelKind, SavedLocation};

use crate::panels::{Panel, PanelCx};
use crate::state::{PanelRequests, Shared, WindowTarget};
use crate::tasks::Tasks;
use crate::theme::{c32, c32a};

pub const TITLE_H: f32 = 22.0;
const MARGIN: f32 = 12.0;
const GAP: f32 = 8.0;
const MIN_SIDE_W: f32 = 240.0;
const CARD_ALPHA: u8 = 232;
/// Height of the radar backdrop's floating controls slot (bottom-left).
/// Sized for the two-row transport + layers box plus the dBZ legend.
pub const CONTROLS_H: f32 = 120.0;
const COLUMNS: [Column; 3] = [Column::Left, Column::Center, Column::Right];

#[derive(Default)]
pub struct LayoutState {
    dragging: Option<PanelKind>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum LayoutAction {
    Place {
        panel: PanelKind,
        col: Column,
        index: Option<usize>,
    },
    Hide(PanelKind),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dir {
    Left,
    Right,
    Up,
    Down,
}

pub fn apply_action(layout: &mut Layout, action: LayoutAction) {
    match action {
        LayoutAction::Place { panel, col, index } => layout.place(panel, col, index),
        LayoutAction::Hide(p) => layout.hide(p),
    }
}

/// The action a title-bar glyph button performs, or `None` when the move is
/// impossible (already at the edge).
pub fn neighbor_move(layout: &Layout, panel: PanelKind, dir: Dir) -> Option<LayoutAction> {
    let (col, idx) = layout.find(panel)?;
    let col_i = COLUMNS.iter().position(|c| *c == col)?;
    match dir {
        Dir::Left | Dir::Right => {
            let next = match dir {
                Dir::Left => col_i.checked_sub(1)?,
                _ => (col_i + 1 < COLUMNS.len()).then_some(col_i + 1)?,
            };
            Some(LayoutAction::Place {
                panel,
                col: COLUMNS[next],
                index: None,
            })
        }
        Dir::Up => (idx > 0).then(|| LayoutAction::Place {
            panel,
            col,
            index: Some(idx - 1),
        }),
        Dir::Down => (idx + 1 < layout.column(col).len()).then(|| LayoutAction::Place {
            panel,
            col,
            index: Some(idx + 1),
        }),
    }
}

/// Column widths `[left, center, right]`. Empty columns collapse; the centre
/// takes the remainder. With `force_all` every column gets its nominal width
/// (used for drag-and-drop targets).
pub fn column_widths(total: f32, layout: &Layout, force_all: bool) -> [f32; 3] {
    let has = |c: Column| force_all || !layout.column(c).is_empty();
    let mut l = if has(Column::Left) {
        layout.left_width_frac.clamp(0.05, 0.6) * total
    } else {
        0.0
    };
    let mut r = if has(Column::Right) {
        layout.right_width_frac.clamp(0.05, 0.6) * total
    } else {
        0.0
    };
    if has(Column::Center) {
        let c = (total - l - r).max(0.0);
        [l, c, r]
    } else {
        // No centre: stretch the side columns to fill.
        let sum = l + r;
        if sum > 0.0 {
            l = l / sum * total;
            r = r / sum * total;
        }
        [l, 0.0, r]
    }
}

/// Insertion index for a drop at height `y` among the other panels' rects.
pub fn drop_index(others: &[Rect], y: f32) -> usize {
    others.iter().filter(|r| r.center().y < y).count()
}

/// A single full-size framed panel (as used by child windows): surface fill,
/// border, a [`TITLE_H`] title bar showing `title`, and a padded body.
pub fn panel_frame(
    ui: &mut Ui,
    p: &ss_core::theme::Palette,
    title: &str,
    add: impl FnOnce(&mut Ui),
) {
    let area = ui.available_rect_before_wrap();
    ui.allocate_rect(area, Sense::hover());
    ui.painter().rect_filled(area, 0.0, c32(p.surface));
    ui.painter().rect_stroke(
        area,
        0.0,
        Stroke::new(1.0, c32a(p.border)),
        StrokeKind::Inside,
    );
    let bar = Rect::from_min_size(area.min, vec2(area.width(), TITLE_H));
    ui.painter().text(
        pos2(bar.left() + 6.0, bar.center().y),
        Align2::LEFT_CENTER,
        format!("▸ {title}"),
        FontId::monospace(11.0),
        c32a(p.text2),
    );
    ui.painter().line_segment(
        [bar.left_bottom(), bar.right_bottom()],
        Stroke::new(1.0, c32a(p.border)),
    );
    let body = Rect::from_min_max(
        pos2(area.left() + 6.0, bar.bottom() + 4.0),
        pos2(area.right() - 6.0, area.bottom() - 4.0),
    );
    if body.width() > 8.0 && body.height() > 8.0 {
        let mut child = ui.new_child(
            UiBuilder::new()
                .id_salt("window_body")
                .max_rect(body)
                .layout(egui::Layout::top_down(Align::Min)),
        );
        child.set_clip_rect(body.intersect(ui.clip_rect()));
        add(&mut child);
    }
}

/// Translucent fill used by the floating cards.
pub fn card_fill(p: &ss_core::theme::Palette) -> Color32 {
    Color32::from_rgba_unmultiplied(p.surface[0], p.surface[1], p.surface[2], CARD_ALPHA)
}

/// Preferred height of a floating card. The radar is the backdrop, never a card.
pub fn card_height(kind: PanelKind) -> f32 {
    match kind {
        PanelKind::Locations => 340.0,
        PanelKind::Conditions => 330.0,
        PanelKind::Hourly => 128.0,
        PanelKind::Forecast => 250.0,
        PanelKind::AuditLog => 220.0,
        PanelKind::Radio => 200.0,
        PanelKind::Radar => 0.0,
    }
}

/// Card heights for one stack, scaled down uniformly to fit `avail`.
pub fn stack_heights(kinds: &[PanelKind], avail: f32) -> Vec<f32> {
    let mut hs: Vec<f32> = kinds.iter().map(|k| card_height(*k)).collect();
    if hs.is_empty() {
        return hs;
    }
    let gaps = GAP * (hs.len() as f32 - 1.0);
    let sum = hs.iter().sum::<f32>();
    let total = sum + gaps;
    if total > avail {
        let f = ((avail - gaps) / sum).max(0.0);
        for h in &mut hs {
            *h = (*h * f).max(TITLE_H + 4.0);
        }
    }
    hs
}

/// The layout with the radar removed (it is the backdrop, not a stacked card).
fn without_radar(layout: &Layout) -> Layout {
    let mut l = layout.clone();
    for v in [&mut l.left, &mut l.center, &mut l.right] {
        v.retain(|k| *k != PanelKind::Radar);
    }
    l
}

/// X-ranges `[left, centre, right]` for the card stacks. Shared by [`show`]
/// and [`cmdbar_rect`] so they agree.
fn card_x_ranges(area: Rect, layout: &Layout) -> [(f32, f32); 3] {
    let nr = without_radar(layout);
    // Nominal widths: side stacks never stretch to fill an empty centre.
    let [mut l, _, mut r] = column_widths(area.width(), &nr, true);
    if nr.left.is_empty() {
        l = 0.0;
    }
    if nr.right.is_empty() {
        r = 0.0;
    }
    if area.width() >= 600.0 {
        if l >= 1.0 {
            l = l.max(MIN_SIDE_W);
        }
        if r >= 1.0 {
            r = r.max(MIN_SIDE_W);
        }
    }
    let left = (area.left() + MARGIN, area.left() + l - GAP / 2.0);
    let right = (area.right() - r + GAP / 2.0, area.right() - MARGIN);
    let cl = if l < 1.0 {
        area.left() + MARGIN
    } else {
        area.left() + l + GAP / 2.0
    };
    let cr = if r < 1.0 {
        area.right() - MARGIN
    } else {
        area.right() - r - GAP / 2.0
    };
    [left, (cl, cr.max(cl)), right]
}

/// Where the radar backdrop draws its floating transport/legend box: the
/// bottom of the left card column (or a 500 px box at the left edge when
/// that column is empty), aligned with the command bar's bottom edge.
pub fn controls_slot(area: Rect, layout: &Layout) -> Rect {
    let (x0, x1) = card_x_ranges(area, layout)[0];
    let (x0, x1) = if x1 - x0 < 1.0 {
        let l = area.left() + MARGIN;
        (l, (l + 500.0).min(area.right() - MARGIN))
    } else {
        (x0, x1)
    };
    Rect::from_min_max(
        pos2(x0, area.bottom() - MARGIN - CONTROLS_H),
        pos2(x1, area.bottom() - MARGIN),
    )
}

/// The floating command bar: bottom-centre, spanning the centre-card range.
pub fn cmdbar_rect(area: Rect, layout: &Layout, height: f32) -> Rect {
    let (x0, x1) = card_x_ranges(area, layout)[1];
    Rect::from_min_max(
        pos2(x0, area.bottom() - MARGIN - height),
        pos2(x1, area.bottom() - MARGIN),
    )
}

#[allow(clippy::too_many_arguments)]
fn run_panel(
    ui: &mut Ui,
    panels: &mut HashMap<PanelKind, Box<dyn Panel>>,
    kind: PanelKind,
    shared: &mut Shared,
    tasks: &Tasks,
    emit: &mut Vec<Command>,
    req: &mut PanelRequests,
    location: Option<&SavedLocation>,
    overlay: Option<Rect>,
) {
    if let Some(panel) = panels.get_mut(&kind) {
        let mut cx = PanelCx {
            palette: shared.palette,
            shared,
            tasks,
            emit,
            req,
            location: location.cloned(),
            window: WindowTarget::Main,
            overlay,
        };
        panel.ui(ui, &mut cx);
    }
}

#[allow(clippy::too_many_arguments)]
pub fn show(
    ui: &mut Ui,
    state: &mut LayoutState,
    shared: &mut Shared,
    panels: &mut HashMap<PanelKind, Box<dyn Panel>>,
    tasks: &Tasks,
    emit: &mut Vec<Command>,
    req: &mut PanelRequests,
    location: Option<&SavedLocation>,
    bottom_reserve: f32,
) {
    let area = ui.available_rect_before_wrap();
    ui.allocate_rect(area, Sense::hover());
    let layout = shared.layout.clone();
    let p = shared.palette;

    // --- radar backdrop ---
    if layout.find(PanelKind::Radar).is_some() {
        let mut child = ui.new_child(
            UiBuilder::new()
                .id_salt("radar_backdrop")
                .max_rect(area)
                .layout(egui::Layout::top_down(Align::Min)),
        );
        child.set_clip_rect(area.intersect(ui.clip_rect()));
        run_panel(
            &mut child,
            panels,
            PanelKind::Radar,
            shared,
            tasks,
            emit,
            req,
            location,
            Some(controls_slot(area, &layout)),
        );
    }

    let xr = card_x_ranges(area, &layout);
    let virtual_widths = column_widths(area.width(), &layout, true);
    let col_rect = |w: &[f32; 3], i: usize| {
        let x0 = area.left() + w[..i].iter().sum::<f32>();
        Rect::from_min_max(pos2(x0, area.top()), pos2(x0 + w[i], area.bottom()))
    };
    let avail = area.height() - 2.0 * MARGIN - bottom_reserve - GAP;
    let radar_docked = layout.find(PanelKind::Radar).is_some();

    let mut actions: Vec<LayoutAction> = Vec::new();
    // (panel, column, rect) as drawn this frame, for drop targeting.
    let mut drawn: Vec<(PanelKind, Column, Rect)> = Vec::new();
    let mut drop: Option<(PanelKind, egui::Pos2)> = None;

    for (ci, col) in COLUMNS.iter().enumerate() {
        let kinds: Vec<PanelKind> = layout
            .column(*col)
            .iter()
            .copied()
            .filter(|k| *k != PanelKind::Radar)
            .collect();
        let (x0, x1) = xr[ci];
        if kinds.is_empty() || x1 - x0 < 1.0 {
            continue;
        }
        let col_avail = if *col == Column::Left && radar_docked {
            avail - CONTROLS_H - GAP
        } else {
            avail
        };
        let heights = stack_heights(&kinds, col_avail);
        let total = heights.iter().sum::<f32>() + GAP * (heights.len() as f32 - 1.0);
        let mut y = if *col == Column::Center {
            area.bottom() - MARGIN - bottom_reserve - GAP - total
        } else {
            area.top() + MARGIN
        };
        for (kind, h) in kinds.iter().zip(heights) {
            let prect = Rect::from_min_size(pos2(x0, y), vec2(x1 - x0, h));
            y += h + GAP;
            drawn.push((*kind, *col, prect));

            // --- frame ---
            ui.painter().rect_filled(prect, 0.0, card_fill(&p));
            ui.painter().rect_stroke(
                prect,
                0.0,
                Stroke::new(1.0, c32a(p.border)),
                StrokeKind::Inside,
            );
            // Empty card space must block the map underneath.
            ui.interact(
                prect,
                Id::unique(("card", kind.id())),
                Sense::click_and_drag(),
            );

            // --- title bar ---
            let title = Rect::from_min_size(prect.min, vec2(prect.width(), TITLE_H));
            let tid = Id::unique(("panel_title", kind.id()));
            let tresp = ui.interact(title, tid, Sense::click_and_drag());
            let hot = ui.rect_contains_pointer(title) || state.dragging == Some(*kind);
            let tcol = if hot { c32(p.a0) } else { c32a(p.text2) };
            ui.painter().text(
                pos2(title.left() + 6.0, title.center().y),
                Align2::LEFT_CENTER,
                format!("▸ {}", kind.title()),
                FontId::monospace(11.0),
                tcol,
            );
            ui.painter().line_segment(
                [title.left_bottom(), title.right_bottom()],
                Stroke::new(1.0, c32a(p.border)),
            );

            if tresp.drag_started() {
                state.dragging = Some(*kind);
            }
            if tresp.drag_stopped() {
                state.dragging = None;
                if let Some(pos) = ui.input(|i| i.pointer.latest_pos()) {
                    drop = Some((*kind, pos));
                }
            }

            if hot && state.dragging.is_none() {
                let buttons: [(&str, Option<LayoutAction>); 5] = [
                    ("×", Some(LayoutAction::Hide(*kind))),
                    ("▾", neighbor_move(&layout, *kind, Dir::Down)),
                    ("▴", neighbor_move(&layout, *kind, Dir::Up)),
                    ("▸", neighbor_move(&layout, *kind, Dir::Right)),
                    ("◂", neighbor_move(&layout, *kind, Dir::Left)),
                ];
                let mut x = title.right() - 4.0;
                for (glyph, action) in buttons {
                    let Some(action) = action else { continue };
                    let b = Rect::from_min_size(pos2(x - 18.0, title.top()), vec2(18.0, TITLE_H));
                    x -= 18.0;
                    let bresp = ui.interact(b, tid.with(glyph), Sense::click());
                    let col = if bresp.hovered() {
                        if glyph == "×" {
                            c32(p.danger)
                        } else {
                            c32(p.a0)
                        }
                    } else {
                        c32a(p.text2)
                    };
                    ui.painter().text(
                        b.center(),
                        Align2::CENTER_CENTER,
                        glyph,
                        FontId::monospace(13.0),
                        col,
                    );
                    if bresp.clicked() {
                        actions.push(action);
                    }
                }
            }

            // --- body ---
            let body = Rect::from_min_max(
                pos2(prect.left() + 6.0, title.bottom() + 4.0),
                pos2(prect.right() - 6.0, prect.bottom() - 4.0),
            );
            if body.width() > 8.0 && body.height() > 8.0 {
                let mut child = ui.new_child(
                    UiBuilder::new()
                        .id_salt(("panel_body", kind.id()))
                        .max_rect(body)
                        .layout(egui::Layout::top_down(Align::Min)),
                );
                child.set_clip_rect(body.intersect(ui.clip_rect()));
                run_panel(
                    &mut child, panels, *kind, shared, tasks, emit, req, location, None,
                );
            }
        }
    }

    // --- drag feedback ---
    if let Some(kind) = state.dragging {
        if let Some(pos) = ui.input(|i| i.pointer.latest_pos()) {
            let painter = ui
                .ctx()
                .layer_painter(LayerId::new(Order::Tooltip, Id::unique("panel_drag")));
            for ci in 0..3 {
                let r = col_rect(&virtual_widths, ci);
                let over = pos.x >= r.left() && pos.x < r.right();
                let a = if over { 40 } else { 14 };
                painter.rect_filled(
                    r,
                    0.0,
                    Color32::from_rgba_unmultiplied(p.a0[0], p.a0[1], p.a0[2], a),
                );
                painter.rect_stroke(
                    r,
                    0.0,
                    Stroke::new(1.0, c32a([p.a0[0], p.a0[1], p.a0[2], 90])),
                    StrokeKind::Inside,
                );
            }
            painter.text(
                pos + vec2(12.0, 12.0),
                Align2::LEFT_TOP,
                format!("▸ {}", kind.title()),
                FontId::monospace(12.0),
                c32(p.a0),
            );
            ui.ctx().request_repaint();
        }
    }

    // --- resolve a drop ---
    if let Some((kind, pos)) = drop {
        let ci = (0..3)
            .find(|i| {
                let r = col_rect(&virtual_widths, *i);
                pos.x >= r.left() && pos.x < r.right()
            })
            .unwrap_or(if pos.x < area.left() { 0 } else { 2 });
        let col = COLUMNS[ci];
        let others: Vec<Rect> = drawn
            .iter()
            .filter(|(k, c, _)| *c == col && *k != kind)
            .map(|(_, _, r)| *r)
            .collect();
        let index = drop_index(&others, pos.y);
        if layout.find(kind) != Some((col, index)) {
            actions.push(LayoutAction::Place {
                panel: kind,
                col,
                index: Some(index),
            });
        }
    }

    if !actions.is_empty() {
        for a in actions {
            apply_action(&mut shared.layout, a);
        }
        shared.dirty_session = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layout() -> Layout {
        Layout::default()
    }

    #[test]
    fn widths_sum_to_total_and_collapse_empty_columns() {
        let mut l = layout();
        let w = column_widths(1000.0, &l, false);
        assert!((w.iter().sum::<f32>() - 1000.0).abs() < 0.01);
        assert!(w[0] > 0.0 && w[2] > 0.0);
        l.left.clear();
        let w = column_widths(1000.0, &l, false);
        assert_eq!(w[0], 0.0);
        assert!((w.iter().sum::<f32>() - 1000.0).abs() < 0.01);
    }

    #[test]
    fn widths_stretch_sides_when_centre_empty() {
        let mut l = layout();
        l.center.clear();
        let w = column_widths(1000.0, &l, false);
        assert_eq!(w[1], 0.0);
        assert!((w[0] + w[2] - 1000.0).abs() < 0.01);
        // Forced (drop targets) keeps the nominal centre.
        assert!(column_widths(1000.0, &l, true)[1] > 0.0);
    }

    #[test]
    fn neighbor_moves_respect_edges() {
        let l = layout();
        // Locations is alone in the left column.
        assert_eq!(neighbor_move(&l, PanelKind::Locations, Dir::Left), None);
        assert_eq!(neighbor_move(&l, PanelKind::Locations, Dir::Up), None);
        assert_eq!(
            neighbor_move(&l, PanelKind::Locations, Dir::Right),
            Some(LayoutAction::Place {
                panel: PanelKind::Locations,
                col: Column::Center,
                index: None
            })
        );
        // Radar is first in centre; AuditLog is last.
        assert_eq!(neighbor_move(&l, PanelKind::Radar, Dir::Up), None);
        assert!(neighbor_move(&l, PanelKind::Radar, Dir::Down).is_some());
        assert_eq!(neighbor_move(&l, PanelKind::AuditLog, Dir::Down), None);
    }

    #[test]
    fn applying_actions_updates_layout() {
        let mut l = layout();
        let a = neighbor_move(&l, PanelKind::Radar, Dir::Down).unwrap();
        apply_action(&mut l, a);
        assert_eq!(l.center, vec![PanelKind::AuditLog, PanelKind::Radar]);
        apply_action(&mut l, LayoutAction::Hide(PanelKind::Radar));
        assert!(!l.is_docked(PanelKind::Radar));
        assert!(l.hidden.contains(&PanelKind::Radar));
    }

    #[test]
    fn drop_index_counts_panels_above_pointer() {
        let rects = [
            Rect::from_min_max(pos2(0.0, 0.0), pos2(10.0, 100.0)),
            Rect::from_min_max(pos2(0.0, 100.0), pos2(10.0, 200.0)),
        ];
        assert_eq!(drop_index(&rects, 10.0), 0);
        assert_eq!(drop_index(&rects, 120.0), 1);
        assert_eq!(drop_index(&rects, 500.0), 2);
        assert_eq!(drop_index(&[], 5.0), 0);
    }

    #[test]
    fn stack_heights_scale_to_fit_and_respect_minimum() {
        let kinds = [
            PanelKind::Locations,
            PanelKind::Conditions,
            PanelKind::Forecast,
        ];
        let natural = stack_heights(&kinds, 10_000.0);
        assert_eq!(natural, vec![340.0, 330.0, 250.0]);
        let avail = 500.0;
        let hs = stack_heights(&kinds, avail);
        let total = hs.iter().sum::<f32>() + GAP * 2.0;
        assert!((total - avail).abs() < 0.01);
        let f = hs[0] / 340.0;
        assert!((hs[1] / 330.0 - f).abs() < 0.001);
        let tiny = stack_heights(&kinds, 10.0);
        assert!(tiny.iter().all(|h| *h >= TITLE_H + 4.0));
        assert!(stack_heights(&[], 100.0).is_empty());
    }

    #[test]
    fn cmdbar_sits_inside_area_between_side_columns() {
        let area = Rect::from_min_max(pos2(0.0, 40.0), pos2(1200.0, 800.0));
        let l = layout();
        let r = cmdbar_rect(area, &l, 60.0);
        assert!(area.contains_rect(r));
        assert!((r.bottom() - (area.bottom() - MARGIN)).abs() < 0.01);
        let xr = card_x_ranges(area, &l);
        assert!(r.left() >= xr[0].1 && r.right() <= xr[2].0);
        // Empty side columns: MARGIN from the edges.
        let mut e = layout();
        e.left.clear();
        e.right.clear();
        let r = cmdbar_rect(area, &e, 60.0);
        assert!((r.left() - (area.left() + MARGIN)).abs() < 0.01);
        assert!((r.right() - (area.right() - MARGIN)).abs() < 0.01);
    }

    #[test]
    fn controls_slot_aligns_with_left_column_and_cmdbar() {
        let area = Rect::from_min_max(pos2(0.0, 40.0), pos2(1200.0, 800.0));
        let l = layout();
        let s = controls_slot(area, &l);
        let xr = card_x_ranges(area, &l);
        assert!((s.left() - xr[0].0).abs() < 0.01 && (s.right() - xr[0].1).abs() < 0.01);
        assert!((s.bottom() - cmdbar_rect(area, &l, 60.0).bottom()).abs() < 0.01);
        assert!((s.height() - CONTROLS_H).abs() < 0.01);
        let mut e = layout();
        e.left.clear();
        let s = controls_slot(area, &e);
        assert!((s.left() - (area.left() + MARGIN)).abs() < 0.01);
        assert!((s.width() - 500.0).abs() < 0.01);
    }

    #[test]
    fn card_height_zero_only_for_radar() {
        for k in PanelKind::ALL {
            assert_eq!(card_height(k) == 0.0, k == PanelKind::Radar);
        }
    }
}
