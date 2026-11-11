//! The top ambient glow bar, its sweep highlight and the severe-alert
//! background pulse. Pure drawing and maths: no app state.

use egui::epaint::{Mesh, Vertex};
use egui::{pos2, Color32, Painter, Rect};

pub struct GlowParams {
    pub color: [u8; 3],
    pub pulsing: bool,
    pub dark: bool,
}

const BAR_H: f32 = 4.0;
const SWEEP_LOOP: f64 = 5.0;
const SWEEP_W: f32 = 0.4;

/// Left edge of the sweep as a fraction of the width (-0.4 .. 1.0).
pub fn sweep_left(phase: f32) -> f32 {
    let e = 0.5 - 0.5 * (std::f32::consts::PI * phase).cos();
    -SWEEP_W + e * (1.0 + SWEEP_W)
}

/// Sweep opacity: fades in over the first 15 % and out over the last 15 %.
pub fn sweep_opacity(phase: f32) -> f32 {
    let o = if phase < 0.15 {
        phase / 0.15
    } else if phase > 0.85 {
        (1.0 - phase) / 0.15
    } else {
        1.0
    };
    o.clamp(0.0, 1.0)
}

/// Alpha multiplier for the severe pulse (2 s loop, 0.75 .. 1.0).
pub fn pulse_alpha(t: f64) -> f32 {
    0.75 + 0.25 * (0.5 - 0.5 * (std::f64::consts::TAU * t / 2.0).cos() as f32)
}

/// Window background mixed toward the pulse colour (3 s loop).
pub fn pulse_bg(bg: [u8; 3], pulse: Option<[u8; 3]>, dark: bool, t: f64) -> [u8; 3] {
    let Some(c) = pulse else { return bg };
    let k = if dark { 0.22 } else { 0.10 };
    let m = k * (0.5 - 0.5 * (std::f64::consts::TAU * t / 3.0).cos() as f32);
    [0, 1, 2].map(|i| (bg[i] as f32 + (c[i] as f32 - bg[i] as f32) * m).round() as u8)
}

fn col(c: [u8; 3], a: f32) -> Color32 {
    Color32::from_rgba_unmultiplied(c[0], c[1], c[2], (a.clamp(0.0, 1.0) * 255.0).round() as u8)
}

fn vert(x: f32, y: f32, c: Color32) -> Vertex {
    Vertex {
        pos: pos2(x, y),
        uv: egui::epaint::WHITE_UV,
        color: c,
    }
}

/// Quad with a vertical gradient: `top` colour at `y0`, `bottom` at `y1`.
fn vgrad(painter: &Painter, x: (f32, f32), y: (f32, f32), top: Color32, bottom: Color32) {
    let mut m = Mesh::default();
    m.vertices.push(vert(x.0, y.0, top));
    m.vertices.push(vert(x.1, y.0, top));
    m.vertices.push(vert(x.1, y.1, bottom));
    m.vertices.push(vert(x.0, y.1, bottom));
    m.indices.extend_from_slice(&[0, 1, 2, 0, 2, 3]);
    painter.add(m);
}

/// Horizontal sweep gradient over `x` between `y`.
fn sweep_quad(painter: &Painter, x: (f32, f32), y: (f32, f32), color: [u8; 3], a: f32) {
    let white = [0, 1, 2].map(|i| (255.0 * 0.7 + color[i] as f32 * 0.3).round() as u8);
    let stops = [
        (0.0, col(color, 0.0)),
        (0.3, col(color, 0.9 * a)),
        (0.5, col(white, a)),
        (0.7, col(color, 0.9 * a)),
        (1.0, col(color, 0.0)),
    ];
    let mut m = Mesh::default();
    for (f, c) in stops {
        let px = x.0 + (x.1 - x.0) * f;
        m.vertices.push(vert(px, y.0, c));
        m.vertices.push(vert(px, y.1, c));
    }
    for i in 0..4u32 {
        let b = i * 2;
        m.indices
            .extend_from_slice(&[b, b + 1, b + 3, b, b + 3, b + 2]);
    }
    painter.add(m);
}

pub fn draw_top_glow(painter: &Painter, rect_top: Rect, params: &GlowParams, t: f64) {
    let c = params.color;
    let (x0, x1, y0) = (rect_top.left(), rect_top.right(), rect_top.top());
    let w = x1 - x0;
    let k = if params.pulsing { pulse_alpha(t) } else { 1.0 };
    let by = y0 + BAR_H;
    let gk = if params.dark { 1.0 } else { 0.8 };
    vgrad(
        painter,
        (x0, x1),
        (by, by + 26.0),
        col(c, 0.28 * k * gk),
        col(c, 0.0),
    );
    vgrad(
        painter,
        (x0, x1),
        (by, by + 8.0),
        col(c, 0.5 * k * gk),
        col(c, 0.0),
    );
    painter.rect_filled(
        Rect::from_min_max(pos2(x0, y0), pos2(x1, by)),
        0.0,
        col(c, k),
    );

    let phase = ((t % SWEEP_LOOP) / SWEEP_LOOP) as f32;
    let op = sweep_opacity(phase) * k;
    if op > 0.0 {
        let sx0 = x0 + sweep_left(phase) * w;
        let sx1 = sx0 + SWEEP_W * w;
        sweep_quad(painter, (sx0, sx1), (y0, by), c, op);
        let mid = y0 + BAR_H / 2.0;
        sweep_quad(painter, (sx0, sx1), (mid - 7.0, mid + 7.0), c, op * 0.35);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sweep_edges() {
        assert!((sweep_left(0.0) + 0.4).abs() < 1e-6);
        assert!((sweep_left(1.0) - 1.0).abs() < 1e-5);
        assert_eq!(sweep_opacity(0.0), 0.0);
        assert_eq!(sweep_opacity(0.5), 1.0);
        assert!(sweep_opacity(1.0).abs() < 1e-6);
        assert!((sweep_opacity(0.075) - 0.5).abs() < 1e-5);
    }

    #[test]
    fn pulse_alpha_range() {
        assert!((pulse_alpha(0.0) - 0.75).abs() < 1e-6);
        assert!((pulse_alpha(1.0) - 1.0).abs() < 1e-6);
        for i in 0..200 {
            let a = pulse_alpha(i as f64 * 0.037);
            assert!((0.75 - 1e-6..=1.0 + 1e-6).contains(&a));
        }
    }

    #[test]
    fn pulse_bg_mixes() {
        let bg = [10, 20, 30];
        let p = Some([200, 0, 0]);
        assert_eq!(pulse_bg(bg, p, true, 0.0), bg);
        assert_eq!(pulse_bg(bg, None, true, 1.5), bg);
        assert_eq!(pulse_bg(bg, p, true, 1.5), [52, 16, 23]);
        assert_eq!(pulse_bg(bg, p, false, 1.5), [29, 18, 27]);
    }

    #[test]
    fn draws_headless() {
        let ctx = egui::Context::default();
        let mut out = ctx.run_ui(egui::RawInput::default(), |ui| {
            let p = ui.painter().clone();
            let r = Rect::from_min_max(pos2(0.0, 0.0), pos2(800.0, 600.0));
            for t in [0.0, 1.0, 2.5, 4.9] {
                let params = GlowParams {
                    color: [255, 0, 0],
                    pulsing: true,
                    dark: true,
                };
                draw_top_glow(&p, r, &params, t);
            }
        });
        out.textures_delta.clear();
    }
}
