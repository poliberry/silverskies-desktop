//! Pixel Weather SVG icons and the app logo: recoloured to the active
//! palette, rasterized with resvg and cached as egui textures.

use egui::{ColorImage, Context, Id, TextureHandle, TextureOptions};
use ss_core::theme::Palette;
use ss_core::weather::icons::PixelIcon;

const LOGO: &str = include_str!("../assets/logo.svg");
/// Logo viewBox aspect ratio (width / height).
const LOGO_ASPECT: f32 = 903.0 / 197.0;

fn svg_source(icon: PixelIcon) -> &'static str {
    match icon {
        PixelIcon::Sunny => include_str!("../assets/pixel-weather/sunny.svg"),
        PixelIcon::ClearNight => include_str!("../assets/pixel-weather/clear_night.svg"),
        PixelIcon::MostlySunny => include_str!("../assets/pixel-weather/mostly_sunny.svg"),
        PixelIcon::MostlyClearNight => {
            include_str!("../assets/pixel-weather/mostly_clear_night.svg")
        }
        PixelIcon::PartlyCloudy => include_str!("../assets/pixel-weather/partly_cloudy.svg"),
        PixelIcon::PartlyCloudyNight => {
            include_str!("../assets/pixel-weather/partly_cloudy_night.svg")
        }
        PixelIcon::Cloudy => include_str!("../assets/pixel-weather/cloudy.svg"),
        PixelIcon::Drizzle => include_str!("../assets/pixel-weather/drizzle.svg"),
        PixelIcon::WintryMix => include_str!("../assets/pixel-weather/wintry_mix.svg"),
        PixelIcon::SleetHail => include_str!("../assets/pixel-weather/sleet_hail.svg"),
        PixelIcon::HeavyRain => include_str!("../assets/pixel-weather/heavy_rain.svg"),
        PixelIcon::Flurries => include_str!("../assets/pixel-weather/flurries.svg"),
        PixelIcon::HeavySnow => include_str!("../assets/pixel-weather/heavy_snow.svg"),
        PixelIcon::StrongThunderstorms => {
            include_str!("../assets/pixel-weather/strong_thunderstorms.svg")
        }
    }
}

fn hex(c: [u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2])
}

pub(crate) fn lighten(c: [u8; 3], t: f32) -> [u8; 3] {
    c.map(|v| (v as f32 + (255.0 - v as f32) * t).round() as u8)
}

/// Alpha-blend an RGBA colour onto an opaque background.
pub(crate) fn over(fg: [u8; 4], bg: [u8; 3]) -> [u8; 3] {
    let a = fg[3] as f32 / 255.0;
    [0, 1, 2].map(|i| (fg[i] as f32 * a + bg[i] as f32 * (1.0 - a)).round() as u8)
}

/// Recolour the Pixel Weather source palette to the app palette.
pub fn reskin(svg: &str, p: &Palette) -> String {
    let sun = hex(p.a0);
    let precip_light = hex(lighten(p.a0, 0.35));
    let cloud = hex(over(p.text2, p.bg));
    let light = hex(p.text);

    let mut out = String::with_capacity(svg.len());
    let mut rest = svg;
    while let Some(i) = rest.find('#') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        let n = after.bytes().take_while(|b| b.is_ascii_hexdigit()).count();
        let token = after[..n].to_ascii_lowercase();
        // The whole hex run is compared, so "#fff" never touches longer
        // colours such as "#fffa00".
        let repl = match token.as_str() {
            "fcbd00" | "619dff" => Some(&sun),
            "8ab4f8" => Some(&precip_light),
            "bdc1c6" => Some(&cloud),
            "e8eaed" | "fff" | "ffffff" => Some(&light),
            _ => None,
        };
        match repl {
            Some(r) => out.push_str(r),
            None => {
                out.push('#');
                out.push_str(&after[..n]);
            }
        }
        rest = &after[n..];
    }
    out.push_str(rest);
    out
}

/// Render an SVG to fit `width_px` x `height_px` (uniform scale, centred).
pub fn rasterize(svg: &str, width_px: u32, height_px: u32) -> Option<ColorImage> {
    use resvg::{tiny_skia, usvg};
    if width_px == 0 || height_px == 0 {
        return None;
    }
    let tree = usvg::Tree::from_data(svg.as_bytes(), &usvg::Options::default()).ok()?;
    let size = tree.size();
    let scale = (width_px as f32 / size.width()).min(height_px as f32 / size.height());
    let dx = (width_px as f32 - size.width() * scale) / 2.0;
    let dy = (height_px as f32 - size.height() * scale) / 2.0;
    let mut pixmap = tiny_skia::Pixmap::new(width_px, height_px)?;
    resvg::render(
        &tree,
        tiny_skia::Transform::from_scale(scale, scale).post_translate(dx, dy),
        &mut pixmap.as_mut(),
    );
    Some(ColorImage::from_rgba_premultiplied(
        [width_px as usize, height_px as usize],
        pixmap.data(),
    ))
}

fn device_px(ctx: &Context, px: u32) -> u32 {
    ((px as f32 * ctx.pixels_per_point()).round() as u32).max(1)
}

/// Cached texture for a weather icon, displayed at `px` points square.
pub fn weather_texture(ctx: &Context, icon: PixelIcon, p: &Palette, px: u32) -> TextureHandle {
    let raster = device_px(ctx, px);
    let id = Id::unique(("pw", icon.name(), px, raster, p.a0, p.text, p.bg, p.text2));
    if let Some(t) = ctx.data_mut(|d| d.get_temp::<TextureHandle>(id)) {
        return t;
    }
    let image = rasterize(&reskin(svg_source(icon), p), raster, raster)
        .unwrap_or_else(|| ColorImage::filled([1, 1], egui::Color32::TRANSPARENT));
    let tex = ctx.load_texture(
        format!("pw-{}-{px}", icon.name()),
        image,
        TextureOptions::LINEAR,
    );
    ctx.data_mut(|d| d.insert_temp(id, tex.clone()));
    tex
}

/// Cached logo texture; `color` is opaque RGB (pre-blended by the caller).
pub fn logo_texture(ctx: &Context, color: [u8; 3], height_px: u32) -> TextureHandle {
    let h = device_px(ctx, height_px);
    let id = Id::unique(("logo", color, height_px, h));
    if let Some(t) = ctx.data_mut(|d| d.get_temp::<TextureHandle>(id)) {
        return t;
    }
    let w = (h as f32 * LOGO_ASPECT).round() as u32;
    let image = rasterize(&LOGO.replace("currentColor", &hex(color)), w, h)
        .unwrap_or_else(|| ColorImage::filled([1, 1], egui::Color32::TRANSPARENT));
    let tex = ctx.load_texture(format!("logo-{height_px}"), image, TextureOptions::LINEAR);
    ctx.data_mut(|d| d.insert_temp(id, tex.clone()));
    tex
}

/// Ready-to-add weather icon image, `px` points square.
pub fn weather_image(ctx: &Context, icon: PixelIcon, p: &Palette, px: u32) -> egui::Image<'static> {
    let tex = weather_texture(ctx, icon, p, px);
    egui::Image::from_texture(&tex).fit_to_exact_size(egui::vec2(px as f32, px as f32))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ss_core::theme::dark_base;

    const SOURCES: [&str; 6] = [
        "#fcbd00", "#bdc1c6", "#e8eaed", "#fff", "#8ab4f8", "#619dff",
    ];

    fn has_pixels(img: &ColorImage) -> bool {
        img.pixels.iter().any(|c| c.a() > 0)
    }

    #[test]
    fn reskin_replaces_all_source_colours() {
        let p = dark_base();
        for icon in PixelIcon::ALL {
            let out = reskin(svg_source(icon), &p).to_ascii_lowercase();
            for s in SOURCES {
                assert!(!out.contains(s), "{} still has {s}", icon.name());
            }
        }
    }

    #[test]
    fn reskin_keeps_none_and_longer_hex() {
        let p = dark_base();
        let out = reskin(r##"<a fill="none" b="#fff" c="#ffffff" d="#fffa00"/>"##, &p);
        assert!(out.contains(r#"fill="none""#));
        assert!(out.contains(r##"d="#fffa00""##));
        assert!(!out.contains(r##""#fff""##));
        assert!(!out.contains("#ffffff"));
    }

    #[test]
    fn icons_rasterize() {
        let p = dark_base();
        for icon in PixelIcon::ALL {
            let img = rasterize(&reskin(svg_source(icon), &p), 48, 48)
                .unwrap_or_else(|| panic!("{} failed to rasterize", icon.name()));
            assert_eq!(img.size, [48, 48]);
            assert!(has_pixels(&img), "{} is empty", icon.name());
        }
    }

    #[test]
    fn logo_rasterizes() {
        let w = (20.0 * LOGO_ASPECT).round() as u32;
        let img = rasterize(&LOGO.replace("currentColor", "#ffffff"), w, 20).unwrap();
        assert_eq!(img.size, [w as usize, 20]);
        assert!(has_pixels(&img));
    }
}

const ICON_DARK: &[u8] = include_bytes!("../../../assets/icon-dark.png");
const ICON_LIGHT: &[u8] = include_bytes!("../../../assets/icon-light.png");

/// Window icon for the given system theme (dark theme uses the dark icon).
pub fn app_icon(dark: bool) -> std::sync::Arc<egui::IconData> {
    let bytes = if dark { ICON_DARK } else { ICON_LIGHT };
    let img = image::load_from_memory(bytes)
        .map(|i| i.to_rgba8())
        .unwrap_or_else(|_| image::RgbaImage::new(1, 1));
    let (width, height) = img.dimensions();
    std::sync::Arc::new(egui::IconData {
        rgba: img.into_raw(),
        width,
        height,
    })
}

#[cfg(test)]
mod icon_tests {
    use super::*;

    #[test]
    fn app_icons_decode() {
        for dark in [true, false] {
            let i = app_icon(dark);
            assert!(i.width > 1 && i.height > 1);
            assert_eq!(i.rgba.len(), (i.width * i.height * 4) as usize);
        }
    }
}
