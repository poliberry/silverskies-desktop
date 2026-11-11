//! Geometry helpers and Web Mercator math.

use crate::{BBox, Geometry, LonLat};
use std::f64::consts::PI;

pub const MAX_LAT: f64 = 85.051_128_779_806_59;
const EARTH_RADIUS_KM: f64 = 6371.0088;
const EARTH_CIRCUMFERENCE_M: f64 = 40_075_016.685_578_5;

/// Ray-cast point-in-ring (even-odd). `ring` is `[lon, lat]` points; closing
/// point optional.
pub fn point_in_ring(ring: &[LonLat], lat: f64, lon: f64) -> bool {
    let n = ring.len();
    if n < 3 {
        return false;
    }
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = (ring[i][0], ring[i][1]);
        let (xj, yj) = (ring[j][0], ring[j][1]);
        if (yi > lat) != (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// Polygon with holes: first ring is the outer boundary, the rest are holes.
pub fn point_in_polygon(rings: &[Vec<LonLat>], lat: f64, lon: f64) -> bool {
    let Some(outer) = rings.first() else {
        return false;
    };
    if !point_in_ring(outer, lat, lon) {
        return false;
    }
    !rings[1..].iter().any(|h| point_in_ring(h, lat, lon))
}

pub fn geometry_contains(g: &Geometry, lat: f64, lon: f64) -> bool {
    match g {
        Geometry::Polygon(rings) => point_in_polygon(rings, lat, lon),
        Geometry::MultiPolygon(polys) => polys.iter().any(|p| point_in_polygon(p, lat, lon)),
        _ => false,
    }
}

fn extend(b: &mut Option<BBox>, p: &LonLat) {
    match b {
        None => *b = Some(BBox::new(p[0], p[1], p[0], p[1])),
        Some(bb) => {
            bb.west = bb.west.min(p[0]);
            bb.east = bb.east.max(p[0]);
            bb.south = bb.south.min(p[1]);
            bb.north = bb.north.max(p[1]);
        }
    }
}

pub fn geometry_bbox(g: &Geometry) -> Option<BBox> {
    let mut b = None;
    match g {
        Geometry::Point(p) => extend(&mut b, p),
        Geometry::LineString(r) => r.iter().for_each(|p| extend(&mut b, p)),
        Geometry::Polygon(rings) => rings.iter().flatten().for_each(|p| extend(&mut b, p)),
        Geometry::MultiPolygon(polys) => polys
            .iter()
            .flatten()
            .flatten()
            .for_each(|p| extend(&mut b, p)),
        Geometry::Other => {}
    }
    b
}

pub fn bbox_intersects(a: &BBox, b: &BBox) -> bool {
    a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south
}

pub fn haversine_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let dphi = (lat2 - lat1).to_radians();
    let dl = (lon2 - lon1).to_radians();
    let a = (dphi / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_KM * a.sqrt().min(1.0).asin()
}

/// Area-weighted centroid of a ring; falls back to the vertex mean for
/// degenerate (zero-area) rings.
pub fn polygon_centroid(ring: &[LonLat]) -> LonLat {
    let mut pts: Vec<LonLat> = ring.to_vec();
    if pts.len() > 1 && pts.first() == pts.last() {
        pts.pop();
    }
    if pts.is_empty() {
        return [0.0, 0.0];
    }
    let n = pts.len();
    let (mut a2, mut cx, mut cy) = (0.0, 0.0, 0.0);
    for i in 0..n {
        let (p, q) = (pts[i], pts[(i + 1) % n]);
        let cross = p[0] * q[1] - q[0] * p[1];
        a2 += cross;
        cx += (p[0] + q[0]) * cross;
        cy += (p[1] + q[1]) * cross;
    }
    if a2.abs() < 1e-12 {
        let m = n as f64;
        return [
            pts.iter().map(|p| p[0]).sum::<f64>() / m,
            pts.iter().map(|p| p[1]).sum::<f64>() / m,
        ];
    }
    [cx / (3.0 * a2), cy / (3.0 * a2)]
}

fn world_size(zoom: f64) -> f64 {
    256.0 * 2f64.powf(zoom)
}

/// Lon/lat to world pixel coordinates at `zoom` (origin top-left, y down).
pub fn lonlat_to_world(lon: f64, lat: f64, zoom: f64) -> (f64, f64) {
    let size = world_size(zoom);
    let lat = lat.clamp(-MAX_LAT, MAX_LAT);
    let x = (lon + 180.0) / 360.0 * size;
    let s = lat.to_radians().sin();
    let y = (0.5 - ((1.0 + s) / (1.0 - s)).ln() / (4.0 * PI)) * size;
    (x, y)
}

/// Inverse of [`lonlat_to_world`]; returns `(lon, lat)`.
pub fn world_to_lonlat(x: f64, y: f64, zoom: f64) -> (f64, f64) {
    let size = world_size(zoom);
    let lon = x / size * 360.0 - 180.0;
    let n = PI * (1.0 - 2.0 * y / size);
    let lat = n.sinh().atan().to_degrees();
    (lon, lat)
}

pub fn tile_for(lon: f64, lat: f64, z: u8) -> (u32, u32) {
    let n = 1u32 << z;
    let (x, y) = lonlat_to_world(lon, lat, z as f64);
    let clamp = |v: f64| (v / 256.0).floor().clamp(0.0, (n - 1) as f64) as u32;
    (clamp(x), clamp(y))
}

pub fn tile_bounds(x: u32, y: u32, z: u8) -> BBox {
    let zf = z as f64;
    let (west, north) = world_to_lonlat(x as f64 * 256.0, y as f64 * 256.0, zf);
    let (east, south) = world_to_lonlat((x + 1) as f64 * 256.0, (y + 1) as f64 * 256.0, zf);
    BBox::new(west, south, east, north)
}

pub fn meters_per_pixel(lat: f64, zoom: f64) -> f64 {
    EARTH_CIRCUMFERENCE_M * lat.to_radians().cos() / world_size(zoom)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square() -> Vec<LonLat> {
        vec![
            [0.0, 0.0],
            [10.0, 0.0],
            [10.0, 10.0],
            [0.0, 10.0],
            [0.0, 0.0],
        ]
    }

    #[test]
    fn ring_and_holes() {
        assert!(point_in_ring(&square(), 5.0, 5.0));
        assert!(!point_in_ring(&square(), 15.0, 5.0));
        assert!(!point_in_ring(&[[0.0, 0.0], [1.0, 1.0]], 0.5, 0.5));
        let hole = vec![[4.0, 4.0], [6.0, 4.0], [6.0, 6.0], [4.0, 6.0]];
        let rings = vec![square(), hole];
        assert!(point_in_polygon(&rings, 1.0, 1.0));
        assert!(!point_in_polygon(&rings, 5.0, 5.0));
        assert!(!point_in_polygon(&[], 5.0, 5.0));
    }

    #[test]
    fn geometry_queries() {
        let poly = Geometry::Polygon(vec![square()]);
        assert!(geometry_contains(&poly, 5.0, 5.0));
        let multi = Geometry::MultiPolygon(vec![
            vec![square()],
            vec![vec![[20.0, 20.0], [30.0, 20.0], [30.0, 30.0], [20.0, 30.0]]],
        ]);
        assert!(geometry_contains(&multi, 25.0, 25.0));
        assert!(!geometry_contains(&multi, 15.0, 15.0));
        assert!(!geometry_contains(&Geometry::Point([1.0, 1.0]), 1.0, 1.0));
        assert!(!geometry_contains(&Geometry::Other, 1.0, 1.0));
    }

    #[test]
    fn bboxes() {
        let b = geometry_bbox(&Geometry::Polygon(vec![square()])).unwrap();
        assert_eq!(b, BBox::new(0.0, 0.0, 10.0, 10.0));
        assert_eq!(geometry_bbox(&Geometry::Other), None);
        assert_eq!(
            geometry_bbox(&Geometry::Point([3.0, 4.0])),
            Some(BBox::new(3.0, 4.0, 3.0, 4.0))
        );
        let multi = Geometry::MultiPolygon(vec![
            vec![square()],
            vec![vec![[20.0, -5.0], [30.0, 0.0], [25.0, 3.0]]],
        ]);
        assert_eq!(
            geometry_bbox(&multi),
            Some(BBox::new(0.0, -5.0, 30.0, 10.0))
        );
        assert!(bbox_intersects(
            &BBox::new(0.0, 0.0, 10.0, 10.0),
            &BBox::new(5.0, 5.0, 15.0, 15.0)
        ));
        assert!(bbox_intersects(
            &BBox::new(0.0, 0.0, 10.0, 10.0),
            &BBox::new(10.0, 10.0, 15.0, 15.0)
        ));
        assert!(!bbox_intersects(
            &BBox::new(0.0, 0.0, 10.0, 10.0),
            &BBox::new(11.0, 0.0, 15.0, 15.0)
        ));
    }

    #[test]
    fn haversine() {
        assert!(haversine_km(10.0, 10.0, 10.0, 10.0).abs() < 1e-9);
        // 1 degree of latitude is about 111.2 km
        assert!((haversine_km(0.0, 0.0, 1.0, 0.0) - 111.19).abs() < 0.1);
        // London -> Paris is about 344 km
        let d = haversine_km(51.5074, -0.1278, 48.8566, 2.3522);
        assert!((d - 343.5).abs() < 3.0, "{d}");
    }

    #[test]
    fn centroid() {
        let c = polygon_centroid(&square());
        assert!((c[0] - 5.0).abs() < 1e-9 && (c[1] - 5.0).abs() < 1e-9);
        let line = polygon_centroid(&[[0.0, 0.0], [2.0, 2.0], [4.0, 4.0]]);
        assert!((line[0] - 2.0).abs() < 1e-9 && (line[1] - 2.0).abs() < 1e-9);
        assert_eq!(polygon_centroid(&[]), [0.0, 0.0]);
    }

    #[test]
    fn mercator_known_values() {
        let (x, y) = lonlat_to_world(0.0, 0.0, 0.0);
        assert!((x - 128.0).abs() < 1e-9 && (y - 128.0).abs() < 1e-9);
        let (x, y) = lonlat_to_world(-180.0, MAX_LAT, 0.0);
        assert!(x.abs() < 1e-9 && y.abs() < 1e-6);
        let (x, y) = lonlat_to_world(180.0, -MAX_LAT, 0.0);
        assert!((x - 256.0).abs() < 1e-9 && (y - 256.0).abs() < 1e-6);
        // clamping beyond the pole
        let (_, y1) = lonlat_to_world(0.0, 89.9, 0.0);
        assert!(y1.abs() < 1e-6);
        let (x, _) = lonlat_to_world(0.0, 0.0, 3.0);
        assert!((x - 1024.0).abs() < 1e-9);
    }

    #[test]
    fn mercator_roundtrip() {
        for (lon, lat, z) in [(-109.71, 32.83, 7.0), (151.2, -33.9, 10.5), (0.0, 0.0, 2.0)] {
            let (x, y) = lonlat_to_world(lon, lat, z);
            let (lo, la) = world_to_lonlat(x, y, z);
            assert!((lo - lon).abs() < 1e-9 && (la - lat).abs() < 1e-9);
        }
    }

    #[test]
    fn tiles() {
        assert_eq!(tile_for(0.0, 0.0, 0), (0, 0));
        assert_eq!(tile_for(-179.9, 80.0, 1), (0, 0));
        assert_eq!(tile_for(179.9, -80.0, 1), (1, 1));
        assert_eq!(tile_for(180.0, 0.0, 2), (3, 2)); // edge clamped
                                                     // Known: London at z10 -> 511, 340
        assert_eq!(tile_for(-0.1278, 51.5074, 10), (511, 340));
        let b = tile_bounds(0, 0, 0);
        assert!((b.west + 180.0).abs() < 1e-9 && (b.east - 180.0).abs() < 1e-9);
        assert!((b.north - MAX_LAT).abs() < 1e-6 && (b.south + MAX_LAT).abs() < 1e-6);
        let b = tile_bounds(1, 1, 1);
        assert!(b.west.abs() < 1e-9 && b.north.abs() < 1e-9);
    }

    #[test]
    fn resolution() {
        let m = meters_per_pixel(0.0, 0.0);
        assert!((m - 156_543.03).abs() < 0.1);
        assert!((meters_per_pixel(0.0, 1.0) - m / 2.0).abs() < 1e-6);
        assert!((meters_per_pixel(60.0, 0.0) - m / 2.0).abs() < 0.1);
    }
}
