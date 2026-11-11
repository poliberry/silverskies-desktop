//! Palettes, builtin themes and color parsing.

use crate::{Config, ThemeColors, ThemeDefinition, ThemePref};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Palette {
    /// Accent.
    pub a0: [u8; 3],
    pub bg: [u8; 3],
    pub surface: [u8; 3],
    pub surface3: [u8; 3],
    pub border: [u8; 4],
    pub text: [u8; 3],
    pub text2: [u8; 4],
    pub text3: [u8; 4],
    pub danger: [u8; 3],
    pub safe: [u8; 3],
}

/// Parse `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(r, g, b)`, `rgba(r, g, b, a)`
/// (a in 0..=1) or a bare `"r, g, b"` triple.
pub fn parse_color(s: &str) -> Option<[u8; 4]> {
    let s = s.trim();
    if let Some(h) = s.strip_prefix('#') {
        if !h.is_ascii() {
            return None;
        }
        let nib = |c: char| c.to_digit(16).map(|v| v as u8);
        let byte = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok();
        return match h.len() {
            3 | 4 => {
                let v: Option<Vec<u8>> = h.chars().map(|c| nib(c).map(|n| n * 17)).collect();
                let v = v?;
                Some([v[0], v[1], v[2], *v.get(3).unwrap_or(&255)])
            }
            6 => Some([byte(0)?, byte(2)?, byte(4)?, 255]),
            8 => Some([byte(0)?, byte(2)?, byte(4)?, byte(6)?]),
            _ => None,
        };
    }
    let lower = s.to_ascii_lowercase();
    let inner = if let Some(rest) = lower
        .strip_prefix("rgba(")
        .or_else(|| lower.strip_prefix("rgb("))
    {
        rest.strip_suffix(')')?.to_string()
    } else {
        lower
    };
    let parts: Vec<&str> = inner.split(',').map(str::trim).collect();
    if parts.len() != 3 && parts.len() != 4 {
        return None;
    }
    let ch = |p: &str| -> Option<u8> {
        let v: f64 = p.parse().ok()?;
        (0.0..=255.0).contains(&v).then(|| v.round() as u8)
    };
    let a = match parts.get(3) {
        Some(p) => {
            let v: f64 = p.parse().ok()?;
            if !(0.0..=1.0).contains(&v) {
                return None;
            }
            (v * 255.0).round() as u8
        }
        None => 255,
    };
    Some([ch(parts[0])?, ch(parts[1])?, ch(parts[2])?, a])
}

pub fn with_alpha(c: [u8; 3], a: f32) -> [u8; 4] {
    [c[0], c[1], c[2], (a.clamp(0.0, 1.0) * 255.0).round() as u8]
}

/// Perceived brightness, 0-255.
pub fn brightness(c: [u8; 3]) -> f32 {
    0.299 * c[0] as f32 + 0.587 * c[1] as f32 + 0.114 * c[2] as f32
}

fn rgb(c: [u8; 4]) -> [u8; 3] {
    [c[0], c[1], c[2]]
}

pub fn dark_base() -> Palette {
    Palette {
        a0: [138, 100, 255],
        bg: [0x0d, 0x0d, 0x0f],
        surface: [0x14, 0x14, 0x18],
        surface3: [0x1c, 0x1c, 0x22],
        border: with_alpha([255, 255, 255], 0.08),
        text: [0xf2, 0xf2, 0xf5],
        text2: with_alpha([0xf2, 0xf2, 0xf5], 0.62),
        text3: with_alpha([0xf2, 0xf2, 0xf5], 0.32),
        danger: [0xff, 0x4d, 0x6d],
        safe: [0x5d, 0xff, 0xb0],
    }
}

pub fn light_base() -> Palette {
    Palette {
        a0: [138, 100, 255],
        bg: [0xf4, 0xf4, 0xf7],
        surface: [0xff, 0xff, 0xff],
        surface3: [0xec, 0xec, 0xf1],
        border: with_alpha([0, 0, 0], 0.1),
        text: [0x15, 0x15, 0x1a],
        text2: with_alpha([0x15, 0x15, 0x1a], 0.65),
        text3: with_alpha([0x15, 0x15, 0x1a], 0.4),
        danger: [0xd9, 0x2b, 0x4b],
        safe: [0x0f, 0x9d, 0x62],
    }
}

#[allow(clippy::too_many_arguments)]
fn theme(
    id: &str,
    name: &str,
    a0: &str,
    bg: &str,
    surface: &str,
    surface3: &str,
    border: &str,
    text: &str,
    text2: &str,
    text3: &str,
    danger: &str,
    safe: &str,
) -> ThemeDefinition {
    let s = |v: &str| Some(v.to_string());
    ThemeDefinition {
        id: id.into(),
        name: name.into(),
        colors: ThemeColors {
            a0: s(a0),
            bg: s(bg),
            surface: s(surface),
            surface3: s(surface3),
            border: s(border),
            text: s(text),
            text2: s(text2),
            text3: s(text3),
            danger: s(danger),
            safe: s(safe),
        },
    }
}

pub fn builtin_themes() -> Vec<ThemeDefinition> {
    vec![
        theme(
            "pink-fuchsia",
            "Pink Fuchsia",
            "255, 45, 155",
            "#180510",
            "#210a18",
            "#2c0f22",
            "rgba(255, 255, 255, 0.08)",
            "#ffeef7",
            "rgba(255, 238, 247, 0.62)",
            "rgba(255, 238, 247, 0.32)",
            "#ff4d6d",
            "#5dffb0",
        ),
        theme(
            "wintergreen",
            "Wintergreen",
            "60, 210, 160",
            "#07120f",
            "#0d1e19",
            "#122922",
            "rgba(255, 255, 255, 0.07)",
            "#eafff5",
            "rgba(234, 255, 245, 0.6)",
            "rgba(234, 255, 245, 0.3)",
            "#ff6b6b",
            "#7dffb8",
        ),
        theme(
            "nord-blue",
            "Nord Blue",
            "136, 192, 208",
            "#2e3440",
            "#3b4252",
            "#434c5e",
            "rgba(236, 239, 244, 0.08)",
            "#eceff4",
            "rgba(236, 239, 244, 0.65)",
            "rgba(236, 239, 244, 0.35)",
            "#bf616a",
            "#a3be8c",
        ),
        theme(
            "purple-violet",
            "Purple Violet",
            "170, 90, 255",
            "#120a1f",
            "#1a1029",
            "#241536",
            "rgba(255, 255, 255, 0.08)",
            "#f3ecff",
            "rgba(243, 236, 255, 0.62)",
            "rgba(243, 236, 255, 0.32)",
            "#ff6b8a",
            "#7dffc8",
        ),
        theme(
            "amber-term",
            "Amber Terminal",
            "255, 176, 0",
            "#0b0a06",
            "#14120a",
            "#1d1a0e",
            "rgba(255, 233, 176, 0.10)",
            "#ffe9b0",
            "rgba(255, 233, 176, 0.62)",
            "rgba(255, 233, 176, 0.32)",
            "#ff5533",
            "#b8ff66",
        ),
        theme(
            "green-term",
            "Green Terminal",
            "51, 255, 102",
            "#050a06",
            "#0a140c",
            "#0f1d12",
            "rgba(216, 255, 224, 0.10)",
            "#d8ffe0",
            "rgba(216, 255, 224, 0.62)",
            "rgba(216, 255, 224, 0.32)",
            "#ff5566",
            "#33ff66",
        ),
    ]
}

/// Overlay a theme's slots on a base palette; unparseable slots keep the base.
fn apply(base: Palette, c: &ThemeColors) -> Palette {
    let get = |v: &Option<String>| v.as_deref().and_then(parse_color);
    let mut p = base;
    if let Some(v) = get(&c.a0) {
        p.a0 = rgb(v);
    }
    if let Some(v) = get(&c.bg) {
        p.bg = rgb(v);
    }
    if let Some(v) = get(&c.surface) {
        p.surface = rgb(v);
    }
    if let Some(v) = get(&c.surface3) {
        p.surface3 = rgb(v);
    }
    if let Some(v) = get(&c.border) {
        p.border = v;
    }
    if let Some(v) = get(&c.text) {
        p.text = rgb(v);
    }
    if let Some(v) = get(&c.text2) {
        p.text2 = v;
    }
    if let Some(v) = get(&c.text3) {
        p.text3 = v;
    }
    if let Some(v) = get(&c.danger) {
        p.danger = rgb(v);
    }
    if let Some(v) = get(&c.safe) {
        p.safe = rgb(v);
    }
    p
}

pub fn resolve_palette(cfg: &Config, condition_accent: [u8; 3], system_dark: bool) -> Palette {
    match cfg.theme_id.as_str() {
        "custom" => {
            if let Some(t) = &cfg.custom_theme {
                return apply(dark_base(), &t.colors);
            }
        }
        id => {
            if let Some(t) = builtin_themes().into_iter().find(|t| t.id == id) {
                return apply(dark_base(), &t.colors);
            }
        }
    }
    let light = match cfg.theme {
        ThemePref::Light => true,
        ThemePref::Dark => false,
        ThemePref::System => !system_dark,
    };
    let mut p = if light { light_base() } else { dark_base() };
    let mut a0 = condition_accent;
    if light {
        let b = brightness(a0);
        if b > 160.0 {
            let k = 140.0 / b;
            a0 = [0, 1, 2].map(|i| (a0[i] as f32 * k).round().clamp(0.0, 255.0) as u8);
        }
    }
    p.a0 = a0;
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_forms() {
        assert_eq!(parse_color("#fff"), Some([255, 255, 255, 255]));
        assert_eq!(parse_color("#180510"), Some([0x18, 0x05, 0x10, 255]));
        assert_eq!(parse_color("#18051080"), Some([0x18, 0x05, 0x10, 0x80]));
        assert_eq!(parse_color("rgb(1, 2, 3)"), Some([1, 2, 3, 255]));
        assert_eq!(
            parse_color("rgba(255, 255, 255, 0.08)"),
            Some([255, 255, 255, 20])
        );
        assert_eq!(parse_color("RGBA(0,0,0,1)"), Some([0, 0, 0, 255]));
        assert_eq!(parse_color("255, 45, 155"), Some([255, 45, 155, 255]));
        assert_eq!(parse_color("  60,210,160 "), Some([60, 210, 160, 255]));
    }

    #[test]
    fn parse_rejects() {
        assert_eq!(parse_color(""), None);
        assert_eq!(parse_color("#12"), None);
        assert_eq!(parse_color("#zzzzzz"), None);
        assert_eq!(parse_color("rgb(1, 2)"), None);
        assert_eq!(parse_color("rgb(300, 2, 3)"), None);
        assert_eq!(parse_color("rgba(1, 2, 3, 2)"), None);
        assert_eq!(parse_color("red"), None);
        assert_eq!(parse_color("#é12345"), None);
    }

    #[test]
    fn builtins_parse_fully() {
        let t = builtin_themes();
        assert_eq!(t.len(), 6);
        let ids: Vec<_> = t.iter().map(|x| x.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "pink-fuchsia",
                "wintergreen",
                "nord-blue",
                "purple-violet",
                "amber-term",
                "green-term"
            ]
        );
        for th in &t {
            let c = &th.colors;
            for v in [
                &c.a0,
                &c.bg,
                &c.surface,
                &c.surface3,
                &c.border,
                &c.text,
                &c.text2,
                &c.text3,
                &c.danger,
                &c.safe,
            ] {
                assert!(parse_color(v.as_deref().unwrap()).is_some(), "{}", th.id);
            }
        }
    }

    #[test]
    fn default_theme_uses_condition_accent() {
        let cfg = Config {
            theme: ThemePref::Dark,
            ..Config::default()
        };
        let p = resolve_palette(&cfg, [1, 2, 3], false);
        assert_eq!(p.a0, [1, 2, 3]);
        assert_eq!(p.bg, [0x0d, 0x0d, 0x0f]);
    }

    #[test]
    fn system_pref_follows_system() {
        let cfg = Config::default();
        assert_eq!(resolve_palette(&cfg, [0, 0, 0], true).bg, dark_base().bg);
        assert_eq!(resolve_palette(&cfg, [0, 0, 0], false).bg, light_base().bg);
        let light = Config {
            theme: ThemePref::Light,
            ..Config::default()
        };
        assert_eq!(resolve_palette(&light, [0, 0, 0], true).bg, light_base().bg);
    }

    #[test]
    fn light_mode_dims_bright_accent() {
        let cfg = Config {
            theme: ThemePref::Light,
            ..Config::default()
        };
        let p = resolve_palette(&cfg, [255, 200, 60], true);
        assert!(
            (brightness(p.a0) - 140.0).abs() < 2.0,
            "{}",
            brightness(p.a0)
        );
        let dim = resolve_palette(&cfg, [40, 100, 180], true);
        assert_eq!(dim.a0, [40, 100, 180]);
    }

    #[test]
    fn builtin_overrides_base_and_accent() {
        let cfg = Config {
            theme_id: "nord-blue".into(),
            theme: ThemePref::Light,
            ..Config::default()
        };
        let p = resolve_palette(&cfg, [1, 2, 3], false);
        assert_eq!(p.a0, [136, 192, 208]);
        assert_eq!(p.bg, [0x2e, 0x34, 0x40]);
        assert_eq!(p.text2, [236, 239, 244, 166]);
    }

    #[test]
    fn custom_partial_falls_back_to_dark_base() {
        let custom = ThemeDefinition {
            id: String::new(),
            name: "mine".into(),
            colors: ThemeColors {
                bg: Some("#101010".into()),
                surface: Some("nonsense".into()),
                ..Default::default()
            },
        };
        let cfg = Config {
            theme_id: "custom".into(),
            custom_theme: Some(custom),
            ..Config::default()
        };
        let p = resolve_palette(&cfg, [1, 2, 3], false);
        assert_eq!(p.bg, [16, 16, 16]);
        assert_eq!(p.surface, dark_base().surface);
        assert_eq!(p.a0, dark_base().a0);
    }

    #[test]
    fn custom_without_definition_and_unknown_id_fall_back() {
        let cfg = Config {
            theme_id: "custom".into(),
            theme: ThemePref::Dark,
            ..Config::default()
        };
        assert_eq!(resolve_palette(&cfg, [9, 9, 9], true).a0, [9, 9, 9]);
        let cfg = Config {
            theme_id: "bogus".into(),
            theme: ThemePref::Dark,
            ..Config::default()
        };
        assert_eq!(resolve_palette(&cfg, [9, 9, 9], true).a0, [9, 9, 9]);
    }

    #[test]
    fn alpha_and_brightness() {
        assert_eq!(with_alpha([1, 2, 3], 0.5), [1, 2, 3, 128]);
        assert_eq!(with_alpha([1, 2, 3], 2.0), [1, 2, 3, 255]);
        assert!((brightness([255, 255, 255]) - 255.0).abs() < 0.01);
        assert_eq!(brightness([0, 0, 0]), 0.0);
    }
}
