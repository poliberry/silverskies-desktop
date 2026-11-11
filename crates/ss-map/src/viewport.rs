//! Web Mercator viewport math (256 px tiles, fractional zoom, fly-to animation).

use egui::{pos2, vec2, Pos2, Rect, Vec2};
use ss_core::types::BBox;

pub const TILE_SIZE: f64 = 256.0;
pub const MAX_LAT: f64 = 85.0511;
pub const MAX_ZOOM: f64 = 18.0;
const EARTH_CIRCUMFERENCE_M: f64 = 40_075_016.685_578_5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct TileId {
    pub z: u8,
    pub x: u32,
    pub y: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Units {
    #[default]
    Metric,
    Imperial,
}

/// Smooth camera animation. `t0` is NaN until the first `tick`.
#[derive(Debug, Clone, Copy)]
pub struct FlyAnim {
    pub from: (f64, f64, f64),
    pub to: (f64, f64, f64),
    pub t0: f64,
    pub duration: f64,
}

#[derive(Debug, Clone)]
pub struct Viewport {
    pub center_lon: f64,
    pub center_lat: f64,
    pub zoom: f64,
    pub size: Vec2,
    pub fly: Option<FlyAnim>,
}

pub fn wrap_lon(lon: f64) -> f64 {
    if (-180.0..=180.0).contains(&lon) {
        lon
    } else {
        (lon + 180.0).rem_euclid(360.0) - 180.0
    }
}

pub fn clamp_lat(lat: f64) -> f64 {
    lat.clamp(-MAX_LAT, MAX_LAT)
}

/// World pixel coordinates at an arbitrary (fractional) zoom.
pub fn world_px_at(lon: f64, lat: f64, zoom: f64) -> (f64, f64) {
    let s = TILE_SIZE * 2f64.powf(zoom);
    let lat = clamp_lat(lat).to_radians();
    let x = (lon + 180.0) / 360.0 * s;
    let y = (1.0 - (lat.tan() + 1.0 / lat.cos()).ln() / std::f64::consts::PI) / 2.0 * s;
    (x, y)
}

pub fn lonlat_from_world_px(x: f64, y: f64, zoom: f64) -> (f64, f64) {
    let s = TILE_SIZE * 2f64.powf(zoom);
    let lon = x / s * 360.0 - 180.0;
    let n = std::f64::consts::PI * (1.0 - 2.0 * y / s);
    let lat = n.sinh().atan().to_degrees();
    (lon, lat)
}

/// Nearest "nice" 1/2/5 x 10^n value that is <= `x`.
pub fn nice_number(x: f64) -> f64 {
    if x <= 0.0 || !x.is_finite() {
        return 1.0;
    }
    let p = 10f64.powf(x.log10().floor());
    let m = x / p;
    let n = if m >= 5.0 {
        5.0
    } else if m >= 2.0 {
        2.0
    } else {
        1.0
    };
    n * p
}

impl Default for Viewport {
    fn default() -> Self {
        Self::new(-98.5, 39.8, 4.0, vec2(800.0, 600.0))
    }
}

impl Viewport {
    pub fn new(lon: f64, lat: f64, zoom: f64, size: Vec2) -> Self {
        Self {
            center_lon: wrap_lon(lon),
            center_lat: clamp_lat(lat),
            zoom: zoom.clamp(0.0, MAX_ZOOM),
            size,
            fly: None,
        }
    }

    pub fn world_px(&self, lon: f64, lat: f64) -> (f64, f64) {
        world_px_at(lon, lat, self.zoom)
    }

    /// Screen position of a lon/lat; the viewport center maps to `rect.center()`.
    pub fn screen_from_lonlat(&self, lon: f64, lat: f64, rect: Rect) -> Pos2 {
        let (cx, cy) = self.world_px(self.center_lon, self.center_lat);
        let (x, y) = self.world_px(lon, lat);
        let c = rect.center();
        pos2(c.x + (x - cx) as f32, c.y + (y - cy) as f32)
    }

    pub fn lonlat_from_screen(&self, pos: Pos2, rect: Rect) -> (f64, f64) {
        let (cx, cy) = self.world_px(self.center_lon, self.center_lat);
        let c = rect.center();
        let x = cx + (pos.x - c.x) as f64;
        let y = cy + (pos.y - c.y) as f64;
        let (lon, lat) = lonlat_from_world_px(x, y, self.zoom);
        (wrap_lon(lon), clamp_lat(lat))
    }

    pub fn visible_bbox(&self, rect: Rect) -> BBox {
        let (w, n) = self.lonlat_from_screen_unwrapped(rect.left_top(), rect);
        let (e, s) = self.lonlat_from_screen_unwrapped(rect.right_bottom(), rect);
        BBox::new(w.max(-180.0), clamp_lat(s), e.min(180.0), clamp_lat(n))
    }

    pub fn lonlat_from_screen_unwrapped(&self, pos: Pos2, rect: Rect) -> (f64, f64) {
        let (cx, cy) = self.world_px(self.center_lon, self.center_lat);
        let c = rect.center();
        lonlat_from_world_px(
            cx + (pos.x - c.x) as f64,
            cy + (pos.y - c.y) as f64,
            self.zoom,
        )
    }

    pub fn set_center(&mut self, lon: f64, lat: f64) {
        self.center_lon = wrap_lon(lon);
        self.center_lat = clamp_lat(lat);
    }

    fn set_center_world(&mut self, x: f64, y: f64) {
        let (lon, lat) = lonlat_from_world_px(x, y, self.zoom);
        self.set_center(lon, lat);
    }

    /// Drag the map content by `delta` screen pixels.
    pub fn pan_px(&mut self, delta: Vec2) {
        self.fly = None;
        let (cx, cy) = self.world_px(self.center_lon, self.center_lat);
        self.set_center_world(cx - delta.x as f64, cy - delta.y as f64);
    }

    /// Change zoom keeping the lon/lat under `screen_pos` fixed.
    pub fn zoom_about(&mut self, screen_pos: Pos2, rect: Rect, delta_zoom: f64) {
        self.fly = None;
        let (lon, lat) = self.lonlat_from_screen_unwrapped(screen_pos, rect);
        self.zoom = (self.zoom + delta_zoom).clamp(0.0, MAX_ZOOM);
        let (wx, wy) = self.world_px(lon, lat);
        let c = rect.center();
        self.set_center_world(
            wx - (screen_pos.x - c.x) as f64,
            wy - (screen_pos.y - c.y) as f64,
        );
    }

    pub fn fly_to(&mut self, lon: f64, lat: f64, zoom: f64) {
        self.fly = Some(FlyAnim {
            from: (self.center_lon, self.center_lat, self.zoom),
            to: (wrap_lon(lon), clamp_lat(lat), zoom.clamp(0.0, MAX_ZOOM)),
            t0: f64::NAN,
            duration: 0.6,
        });
    }

    /// Advance the animation. Returns true while still animating.
    pub fn tick(&mut self, now: f64) -> bool {
        let Some(mut a) = self.fly else { return false };
        if a.t0.is_nan() {
            a.t0 = now;
        }
        let t = ((now - a.t0) / a.duration).clamp(0.0, 1.0);
        let e = 1.0 - (1.0 - t).powi(3);
        let mut dlon = a.to.0 - a.from.0;
        if dlon > 180.0 {
            dlon -= 360.0;
        } else if dlon < -180.0 {
            dlon += 360.0;
        }
        self.set_center(a.from.0 + dlon * e, a.from.1 + (a.to.1 - a.from.1) * e);
        self.zoom = a.from.2 + (a.to.2 - a.from.2) * e;
        if t >= 1.0 {
            self.fly = None;
            false
        } else {
            self.fly = Some(a);
            true
        }
    }

    pub fn is_animating(&self) -> bool {
        self.fly.is_some()
    }

    /// Integer zoom level used for tile fetching.
    pub fn tile_zoom(&self, max_zoom: u8) -> u8 {
        (self.zoom.round().max(0.0) as u8).min(max_zoom)
    }

    /// Visible tiles (x wrapped) with their screen rects, at `z = round(zoom)`.
    pub fn visible_tiles_with_rects(&self, rect: Rect, max_zoom: u8) -> Vec<(TileId, Rect)> {
        let z = self.tile_zoom(max_zoom);
        let n = 1i64 << z;
        let scale = 2f64.powf(self.zoom - z as f64);
        let (cx, cy) = world_px_at(self.center_lon, self.center_lat, z as f64);
        let hw = rect.width() as f64 / 2.0 / scale;
        let hh = rect.height() as f64 / 2.0 / scale;
        let x0 = ((cx - hw) / TILE_SIZE).floor() as i64;
        let x1 = ((cx + hw) / TILE_SIZE).ceil() as i64 - 1;
        let y0 = (((cy - hh) / TILE_SIZE).floor() as i64).max(0);
        let y1 = (((cy + hh) / TILE_SIZE).ceil() as i64 - 1).min(n - 1);
        let mut out = Vec::new();
        for ty in y0..=y1 {
            for tx in x0..=x1 {
                let id = TileId {
                    z,
                    x: tx.rem_euclid(n) as u32,
                    y: ty as u32,
                };
                let min = rect.center()
                    + vec2(
                        ((tx as f64 * TILE_SIZE - cx) * scale) as f32,
                        ((ty as f64 * TILE_SIZE - cy) * scale) as f32,
                    );
                let size = (TILE_SIZE * scale) as f32;
                out.push((id, Rect::from_min_size(min, vec2(size, size))));
            }
        }
        out
    }

    pub fn visible_tiles(&self, rect: Rect, max_zoom: u8) -> Vec<TileId> {
        self.visible_tiles_with_rects(rect, max_zoom)
            .into_iter()
            .map(|(t, _)| t)
            .collect()
    }

    /// Screen rect of a tile (nearest world copy to the viewport center).
    pub fn tile_rect(&self, tile: TileId, rect: Rect) -> Rect {
        let z = tile.z as f64;
        let n = (1u64 << tile.z) as f64;
        let scale = 2f64.powf(self.zoom - z);
        let (cx, cy) = world_px_at(self.center_lon, self.center_lat, z);
        let mut tx = tile.x as f64 * TILE_SIZE;
        let world = n * TILE_SIZE;
        let mid = tx + TILE_SIZE / 2.0;
        tx -= ((mid - cx) / world).round() * world;
        let min = rect.center()
            + vec2(
                ((tx - cx) * scale) as f32,
                ((tile.y as f64 * TILE_SIZE - cy) * scale) as f32,
            );
        let size = (TILE_SIZE * scale) as f32;
        Rect::from_min_size(min, vec2(size, size))
    }

    pub fn meters_per_px_at(&self, lat: f64) -> f64 {
        EARTH_CIRCUMFERENCE_M * clamp_lat(lat).to_radians().cos()
            / (TILE_SIZE * 2f64.powf(self.zoom))
    }

    pub fn meters_per_px(&self, lat: f64) -> f64 {
        self.meters_per_px_at(lat)
    }

    /// Pixel length and label of a round-number scale bar (max ~110 px).
    pub fn scale_bar(&self, _rect: Rect, units: Units) -> (f32, String) {
        let mpp = self.meters_per_px(self.center_lat);
        let max_px = 110.0;
        let max_m = mpp * max_px;
        match units {
            Units::Metric => {
                if max_m >= 1000.0 {
                    let km = nice_number(max_m / 1000.0);
                    ((km * 1000.0 / mpp) as f32, format!("{} km", fmt_num(km)))
                } else {
                    let m = nice_number(max_m);
                    ((m / mpp) as f32, format!("{} m", fmt_num(m)))
                }
            }
            Units::Imperial => {
                let max_ft = max_m * 3.280_84;
                if max_ft >= 5280.0 {
                    let mi = nice_number(max_ft / 5280.0);
                    (
                        (mi * 5280.0 / 3.280_84 / mpp) as f32,
                        format!("{} mi", fmt_num(mi)),
                    )
                } else {
                    let ft = nice_number(max_ft);
                    ((ft / 3.280_84 / mpp) as f32, format!("{} ft", fmt_num(ft)))
                }
            }
        }
    }
}

fn fmt_num(v: f64) -> String {
    if v.fract().abs() < 1e-9 {
        format!("{}", v as i64)
    } else {
        format!("{v}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(w: f32, h: f32) -> Rect {
        Rect::from_min_size(pos2(0.0, 0.0), vec2(w, h))
    }

    #[test]
    fn world_px_zoom0_origin() {
        let vp = Viewport::new(0.0, 0.0, 0.0, vec2(256.0, 256.0));
        let (x, y) = vp.world_px(0.0, 0.0);
        assert!((x - 128.0).abs() < 1e-9 && (y - 128.0).abs() < 1e-9);
    }

    #[test]
    fn screen_roundtrip() {
        let vp = Viewport::new(-112.0, 34.0, 7.3, vec2(800.0, 600.0));
        let r = rect(800.0, 600.0);
        let p = vp.screen_from_lonlat(-111.0, 35.0, r);
        let (lon, lat) = vp.lonlat_from_screen(p, r);
        assert!((lon + 111.0).abs() < 1e-4 && (lat - 35.0).abs() < 1e-4);
        let c = vp.screen_from_lonlat(-112.0, 34.0, r);
        assert!((c - r.center()).length() < 1e-3);
    }

    #[test]
    fn zoom_about_keeps_point_fixed() {
        let mut vp = Viewport::new(-100.0, 40.0, 5.0, vec2(800.0, 600.0));
        let r = rect(800.0, 600.0);
        let p = pos2(600.0, 150.0);
        let before = vp.lonlat_from_screen(p, r);
        vp.zoom_about(p, r, 1.5);
        let after = vp.lonlat_from_screen(p, r);
        assert!((before.0 - after.0).abs() < 1e-6 && (before.1 - after.1).abs() < 1e-6);
        assert!((vp.zoom - 6.5).abs() < 1e-12);
    }

    #[test]
    fn clamps_and_wraps() {
        let mut vp = Viewport::default();
        vp.set_center(190.0, 99.0);
        assert!((vp.center_lon + 170.0).abs() < 1e-9);
        assert!((vp.center_lat - MAX_LAT).abs() < 1e-9);
    }

    #[test]
    fn visible_tiles_zoom2_512() {
        let vp = Viewport::new(0.0, 0.0, 2.0, vec2(512.0, 512.0));
        let tiles = vp.visible_tiles(rect(512.0, 512.0), 18);
        assert_eq!(tiles.len(), 4);
        assert!(tiles.iter().all(|t| t.z == 2));
        let r = vp.tile_rect(TileId { z: 2, x: 1, y: 1 }, rect(512.0, 512.0));
        assert!((r.min - pos2(0.0, 0.0)).length() < 1e-3);
        assert!((r.width() - 256.0).abs() < 1e-3);
    }

    #[test]
    fn visible_tiles_wrap_and_fractional() {
        let vp = Viewport::new(179.0, 0.0, 2.4, vec2(600.0, 400.0));
        let tiles = vp.visible_tiles_with_rects(rect(600.0, 400.0), 18);
        assert!(tiles.iter().any(|(t, _)| t.x == 0));
        assert!(tiles.iter().any(|(t, _)| t.x == 3));
        let (id, r) = tiles[0];
        assert!((r.width() - 256.0 * 2f32.powf(0.4)).abs() < 0.01);
        assert_eq!(
            vp.tile_rect(id, rect(600.0, 400.0)).min.x.round(),
            r.min.x.round()
        );
    }

    #[test]
    fn visible_bbox_contains_center() {
        let vp = Viewport::new(-98.0, 39.0, 5.0, vec2(800.0, 600.0));
        let b = vp.visible_bbox(rect(800.0, 600.0));
        assert!(b.contains(39.0, -98.0));
        assert!(b.west < -98.0 && b.east > -98.0 && b.south < 39.0 && b.north > 39.0);
    }

    #[test]
    fn nice_numbers() {
        assert_eq!(nice_number(0.7), 0.5);
        assert_eq!(nice_number(1.0), 1.0);
        assert_eq!(nice_number(3.9), 2.0);
        assert_eq!(nice_number(77.0), 50.0);
        assert_eq!(nice_number(999.0), 500.0);
    }

    #[test]
    fn scale_bar_labels() {
        let vp = Viewport::new(0.0, 0.0, 5.0, vec2(800.0, 600.0));
        let (px, label) = vp.scale_bar(rect(800.0, 600.0), Units::Metric);
        assert!(px > 0.0 && px <= 110.0 + 0.5);
        assert!(label.ends_with("km"), "{label}");
        let (_, l2) = vp.scale_bar(rect(800.0, 600.0), Units::Imperial);
        assert!(l2.ends_with("mi"), "{l2}");
        let hi = Viewport::new(0.0, 0.0, 17.0, vec2(800.0, 600.0));
        assert!(hi
            .scale_bar(rect(800.0, 600.0), Units::Metric)
            .1
            .ends_with(" m"));
    }

    #[test]
    fn fly_animation_completes() {
        let mut vp = Viewport::new(0.0, 0.0, 3.0, vec2(800.0, 600.0));
        vp.fly_to(10.0, 20.0, 6.0);
        assert!(vp.tick(1.0));
        assert!(vp.tick(1.3));
        assert!(!vp.tick(2.0));
        assert!((vp.center_lon - 10.0).abs() < 1e-9 && (vp.zoom - 6.0).abs() < 1e-9);
    }
}
