//! Palette -> egui visuals, fonts and spacing for the terminal look.

use std::sync::Arc;

use egui::{
    epaint::Shadow, style::ScrollStyle, Color32, Context, CornerRadius, FontData, FontDefinitions,
    FontFamily, FontId, Margin, Stroke, TextStyle, Theme, Vec2, Visuals,
};
use ss_core::theme::{brightness, Palette};

pub fn c32(rgb: [u8; 3]) -> Color32 {
    Color32::from_rgb(rgb[0], rgb[1], rgb[2])
}

pub fn c32a(c: [u8; 4]) -> Color32 {
    Color32::from_rgba_unmultiplied(c[0], c[1], c[2], c[3])
}

pub fn visuals_for(p: &Palette) -> Visuals {
    let dark = brightness(p.bg) < 128.0;
    let mut v = if dark {
        Visuals::dark()
    } else {
        Visuals::light()
    };
    let a0 = c32(p.a0);
    let border = Stroke::new(1.0, c32a(p.border));
    let sq = CornerRadius::ZERO;

    v.override_text_color = Some(c32(p.text));
    v.panel_fill = c32(p.bg);
    v.window_fill = c32(p.bg);
    v.extreme_bg_color = c32(p.surface);
    v.faint_bg_color = c32(p.surface);
    v.code_bg_color = c32(p.surface3);
    v.selection.bg_fill = Color32::from_rgba_unmultiplied(p.a0[0], p.a0[1], p.a0[2], 70);
    v.selection.stroke = Stroke::new(1.0, a0);
    v.hyperlink_color = a0;
    v.warn_fg_color = c32(p.a0);
    v.error_fg_color = c32(p.danger);
    v.window_stroke = border;
    v.window_corner_radius = sq;
    v.menu_corner_radius = sq;
    v.window_shadow = Shadow::NONE;
    v.popup_shadow = Shadow::NONE;
    v.striped = false;

    let w = &mut v.widgets;
    w.noninteractive.bg_fill = c32(p.bg);
    w.noninteractive.weak_bg_fill = c32(p.bg);
    w.noninteractive.bg_stroke = border;
    w.noninteractive.fg_stroke = Stroke::new(1.0, c32a(p.text2));

    w.inactive.bg_fill = c32(p.surface);
    w.inactive.weak_bg_fill = Color32::TRANSPARENT;
    w.inactive.bg_stroke = Stroke::NONE;
    w.inactive.fg_stroke = Stroke::new(1.0, c32(p.text));

    for s in [&mut w.hovered, &mut w.active, &mut w.open] {
        s.bg_fill = c32(p.surface3);
        s.weak_bg_fill = c32(p.surface3);
        s.fg_stroke = Stroke::new(1.0, c32(p.text));
    }
    w.hovered.bg_stroke = Stroke::new(
        1.0,
        Color32::from_rgba_unmultiplied(p.a0[0], p.a0[1], p.a0[2], 120),
    );
    w.active.bg_stroke = Stroke::new(1.0, a0);
    w.open.bg_stroke = border;

    for s in [
        &mut w.noninteractive,
        &mut w.inactive,
        &mut w.hovered,
        &mut w.active,
        &mut w.open,
    ] {
        s.corner_radius = sq;
        s.expansion = 0.0;
    }
    v
}

pub fn apply_palette(ctx: &Context, p: &Palette) {
    let v = visuals_for(p);
    // Both themes get the same visuals so the system theme can never override us.
    ctx.set_visuals_of(Theme::Dark, v.clone());
    ctx.set_visuals_of(Theme::Light, v);
}

/// Monospace everywhere, tight spacing. Call once at startup.
///
/// DejaVu Sans Mono is the primary face (full box-drawing, arrows and
/// weather-symbol coverage); DejaVu Sans is the last-resort fallback for any
/// glyph the mono face lacks. Both are Bitstream-Vera licensed (see
/// `assets/fonts/LICENSE`).
pub fn install_fonts(ctx: &Context) {
    ctx.set_fonts(font_definitions());
    apply_text_styles(ctx);
}

/// egui default fonts plus the bundled DejaVu faces.
pub fn font_definitions() -> FontDefinitions {
    let mut fonts = FontDefinitions::default();
    fonts.font_data.insert(
        "DejaVuSansMono".to_owned(),
        Arc::new(FontData::from_static(include_bytes!(
            "../assets/fonts/DejaVuSansMono.ttf"
        ))),
    );
    fonts.font_data.insert(
        "DejaVuSans".to_owned(),
        Arc::new(FontData::from_static(include_bytes!(
            "../assets/fonts/DejaVuSans.ttf"
        ))),
    );
    if let Some(mono) = fonts.families.get_mut(&FontFamily::Monospace) {
        mono.insert(0, "DejaVuSansMono".to_owned());
        mono.push("DejaVuSans".to_owned());
    }
    // Let the proportional family fall back to the monospace font first, so any
    // widget that explicitly asks for Proportional still looks terminal-like.
    if let Some(mono) = fonts.families.get(&FontFamily::Monospace).cloned() {
        fonts.families.insert(FontFamily::Proportional, mono);
    }
    fonts
}

fn apply_text_styles(ctx: &Context) {
    ctx.all_styles_mut(|s| {
        let mono = |size: f32| FontId::new(size, FontFamily::Monospace);
        s.text_styles.insert(TextStyle::Body, mono(13.0));
        s.text_styles.insert(TextStyle::Button, mono(13.0));
        s.text_styles.insert(TextStyle::Heading, mono(16.0));
        s.text_styles.insert(TextStyle::Small, mono(10.5));
        s.text_styles.insert(TextStyle::Monospace, mono(13.0));
        s.spacing.item_spacing = Vec2::new(4.0, 4.0);
        s.spacing.window_margin = Margin::same(6);
        s.spacing.button_padding = Vec2::new(4.0, 1.0);
        s.spacing.interact_size.y = 18.0;
        s.spacing.scroll = ScrollStyle {
            bar_width: 6.0,
            ..ScrollStyle::solid()
        };
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every glyph the UI paints must exist in the bundled fonts, otherwise
    /// egui renders a box and logs `No font has "…"` at startup.
    #[test]
    fn bundled_fonts_cover_all_ui_glyphs() {
        let mut fonts = egui::epaint::text::Fonts::new(
            egui::epaint::text::TextOptions::default(),
            font_definitions(),
        );
        let text = String::from("▸▾▴◂×●○⊕…·≋°→←↑↓│─┌┐└┘├┤┬┴┼█▓▒░");
        let mono = FontId::new(13.0, FontFamily::Monospace);
        let missing: Vec<char> = text
            .chars()
            .filter(|c| !fonts.has_glyph(&mono, *c))
            .collect();
        assert!(missing.is_empty(), "missing glyphs: {missing:?}");
    }
}
