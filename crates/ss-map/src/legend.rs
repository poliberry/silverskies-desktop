//! Color legends for radar / overlay layers.

use egui::epaint::{Vertex, WHITE_UV};
use egui::{vec2, Align2, Color32, FontId, Mesh, Rect, Sense, Shape, Stroke, StrokeKind, Ui};

/// Horizontal gradient bar with monospace labels. Stops with an empty label get no text.
pub fn draw_color_legend(ui: &mut Ui, title: &str, stops: &[(Color32, &str)]) {
    if stops.is_empty() {
        return;
    }
    let width = ui.available_width().clamp(120.0, 340.0);
    let (title_h, bar_h, label_h) = (14.0, 10.0, 12.0);
    let (rect, _) = ui.allocate_exact_size(vec2(width, title_h + bar_h + label_h), Sense::hover());
    let painter = ui.painter_at(rect);
    let fg = ui.visuals().text_color();
    painter.text(
        rect.left_top(),
        Align2::LEFT_TOP,
        title,
        FontId::monospace(11.0),
        fg,
    );

    let bar = Rect::from_min_size(rect.min + vec2(0.0, title_h), vec2(width, bar_h));
    let n = stops.len();
    let x_at = |i: usize| {
        if n == 1 {
            bar.left()
        } else {
            bar.left() + bar.width() * i as f32 / (n - 1) as f32
        }
    };
    let mut mesh = Mesh::default();
    for (i, (c, _)) in stops.iter().enumerate() {
        let x = x_at(i);
        mesh.vertices.push(Vertex {
            pos: egui::pos2(x, bar.top()),
            uv: WHITE_UV,
            color: *c,
        });
        mesh.vertices.push(Vertex {
            pos: egui::pos2(x, bar.bottom()),
            uv: WHITE_UV,
            color: *c,
        });
        if i > 0 {
            let b = (i as u32 - 1) * 2;
            mesh.indices
                .extend_from_slice(&[b, b + 1, b + 2, b + 1, b + 3, b + 2]);
        }
    }
    if n > 1 {
        painter.add(Shape::mesh(mesh));
    } else {
        painter.rect_filled(bar, 0.0, stops[0].0);
    }
    painter.rect_stroke(
        bar,
        0.0,
        Stroke::new(1.0, fg.gamma_multiply(0.4)),
        StrokeKind::Outside,
    );
    for (i, (_, label)) in stops.iter().enumerate() {
        if label.is_empty() {
            continue;
        }
        let align = if i == 0 {
            Align2::LEFT_TOP
        } else if i == n - 1 {
            Align2::RIGHT_TOP
        } else {
            Align2::CENTER_TOP
        };
        painter.text(
            egui::pos2(x_at(i), bar.bottom() + 2.0),
            align,
            label,
            FontId::monospace(9.0),
            fg.gamma_multiply(0.85),
        );
    }
}

const fn c(r: u8, g: u8, b: u8) -> Color32 {
    Color32::from_rgb(r, g, b)
}

/// Approximate RainViewer color-scheme ramps (dBZ). Unknown ids get a generic ramp.
/// 1 = Original, 2 = Universal Blue, 6 = NEXRAD Level III.
pub fn radar_dbz_stops(scheme_id: u8) -> Vec<(Color32, &'static str)> {
    match scheme_id {
        1 => vec![
            (c(48, 48, 60), "-30"),
            (c(70, 70, 92), ""),
            (c(100, 100, 130), "-10"),
            (c(136, 136, 170), ""),
            (c(4, 233, 231), "5"),
            (c(1, 159, 244), ""),
            (c(3, 0, 244), "15"),
            (c(2, 253, 2), ""),
            (c(1, 197, 1), "25"),
            (c(0, 142, 0), ""),
            (c(253, 248, 2), "35"),
            (c(229, 188, 0), ""),
            (c(253, 149, 0), "45"),
            (c(253, 0, 0), ""),
            (c(212, 0, 0), "55"),
            (c(188, 0, 0), ""),
            (c(248, 0, 253), "65"),
            (c(152, 84, 198), ""),
            (c(255, 255, 255), "75"),
        ],
        2 => vec![
            (c(200, 220, 240), "0"),
            (c(150, 190, 235), "10"),
            (c(90, 140, 225), "20"),
            (c(40, 90, 210), "30"),
            (c(20, 50, 170), "40"),
            (c(250, 220, 60), "50"),
            (c(240, 120, 30), "60"),
            (c(200, 20, 20), "70"),
            (c(255, 255, 255), "75"),
        ],
        6 => vec![
            (c(4, 233, 231), "5"),
            (c(3, 0, 244), "15"),
            (c(2, 253, 2), "20"),
            (c(0, 142, 0), "30"),
            (c(253, 248, 2), "35"),
            (c(253, 149, 0), "45"),
            (c(253, 0, 0), "50"),
            (c(188, 0, 0), "60"),
            (c(248, 0, 253), "65"),
            (c(255, 255, 255), "75"),
        ],
        _ => vec![
            (c(60, 80, 140), "0"),
            (c(40, 160, 220), "10"),
            (c(40, 200, 90), "25"),
            (c(240, 230, 50), "35"),
            (c(250, 150, 30), "45"),
            (c(230, 40, 40), "55"),
            (c(190, 40, 200), "65"),
            (c(255, 255, 255), "75"),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scheme_one_spans_range() {
        let s = radar_dbz_stops(1);
        assert_eq!(s.first().unwrap().1, "-30");
        assert_eq!(s.last().unwrap().1, "75");
    }

    #[test]
    fn unknown_scheme_falls_back() {
        assert!(!radar_dbz_stops(200).is_empty());
    }
}
