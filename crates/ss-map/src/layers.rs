//! Map layers: raster tiles, WMS images, polygons, markers, wind barbs, range rings, selection.

use std::any::Any;
use std::collections::HashMap;
use std::time::Duration;

use egui::epaint::{Vertex, WHITE_UV};
use egui::{
    pos2, vec2, Align2, Color32, FontId, Mesh, Painter, Pos2, Rect, Shape, Stroke, StrokeKind,
    TextureHandle,
};
use ss_core::types::{BBox, Geometry};

use crate::tiles::{TileCache, TileKey};
use crate::viewport::{TileId, Viewport};

pub struct DrawCtx<'a> {
    pub viewport: &'a Viewport,
    pub rect: Rect,
    pub cache: &'a mut TileCache,
    /// Seconds (monotonic) for pulse animations / debouncing.
    pub time: f64,
    pub dark: bool,
}

pub trait Layer {
    fn draw(&mut self, ctx: &mut DrawCtx, painter: &Painter);
    fn name(&self) -> &str;
    fn visible(&self) -> bool;
    fn set_visible(&mut self, visible: bool);
    /// For downcasting a layer in the stack back to its concrete type.
    fn as_any_mut(&mut self) -> &mut dyn Any;
}

macro_rules! layer_boilerplate {
    () => {
        fn name(&self) -> &str {
            &self.name
        }
        fn visible(&self) -> bool {
            self.visible
        }
        fn set_visible(&mut self, visible: bool) {
            self.visible = visible;
        }
        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
    };
}

#[derive(Default)]
pub struct LayerStack {
    pub layers: Vec<Box<dyn Layer>>,
}

impl LayerStack {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn push(&mut self, layer: impl Layer + 'static) {
        self.layers.push(Box::new(layer));
    }
    pub fn clear(&mut self) {
        self.layers.clear();
    }
    pub fn len(&self) -> usize {
        self.layers.len()
    }
    pub fn is_empty(&self) -> bool {
        self.layers.is_empty()
    }
    /// Find a layer by name and downcast it.
    pub fn get_mut<T: Layer + 'static>(&mut self, name: &str) -> Option<&mut T> {
        self.layers
            .iter_mut()
            .find(|l| l.name() == name)
            .and_then(|l| l.as_any_mut().downcast_mut::<T>())
    }
    pub fn set_visible(&mut self, name: &str, visible: bool) {
        for l in self.layers.iter_mut().filter(|l| l.name() == name) {
            l.set_visible(visible);
        }
    }
    pub fn remove(&mut self, name: &str) {
        self.layers.retain(|l| l.name() != name);
    }
    /// Draw all visible layers bottom to top, threading one `&mut TileCache` through.
    pub fn draw(
        &mut self,
        viewport: &Viewport,
        rect: Rect,
        cache: &mut TileCache,
        time: f64,
        dark: bool,
        painter: &Painter,
    ) {
        let mut ctx = DrawCtx {
            viewport,
            rect,
            cache,
            time,
            dark,
        };
        for l in self.layers.iter_mut().filter(|l| l.visible()) {
            l.draw(&mut ctx, painter);
        }
    }
}

// ---------------------------------------------------------------------------
// Raster tiles
// ---------------------------------------------------------------------------

pub struct RasterTileLayer {
    pub name: String,
    /// Unique cache key; must change whenever the URL template's output changes.
    pub key: String,
    pub url_template: Box<dyn Fn(TileId) -> String + Send>,
    pub opacity: f32,
    pub max_zoom: u8,
    pub visible: bool,
}

impl RasterTileLayer {
    pub fn new(
        name: impl Into<String>,
        key: impl Into<String>,
        max_zoom: u8,
        url_template: impl Fn(TileId) -> String + Send + 'static,
    ) -> Self {
        Self {
            name: name.into(),
            key: key.into(),
            url_template: Box::new(url_template),
            opacity: 1.0,
            max_zoom,
            visible: true,
        }
    }

    pub fn with_opacity(mut self, o: f32) -> Self {
        self.opacity = o;
        self
    }

    /// Swap the template (e.g. next radar frame) without rebuilding the layer.
    /// `key` must identify the new template so old frames stay cached separately.
    pub fn set_template(
        &mut self,
        key: impl Into<String>,
        f: impl Fn(TileId) -> String + Send + 'static,
    ) {
        self.key = key.into();
        self.url_template = Box::new(f);
    }
}

fn snap(r: Rect) -> Rect {
    Rect::from_min_max(r.min.round(), r.max.round())
}

impl Layer for RasterTileLayer {
    layer_boilerplate!();

    fn draw(&mut self, ctx: &mut DrawCtx, painter: &Painter) {
        let tint = Color32::WHITE.linear_multiply(self.opacity.clamp(0.0, 1.0));
        let full_uv = Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0));
        for (tile, r) in ctx
            .viewport
            .visible_tiles_with_rects(ctx.rect, self.max_zoom)
        {
            let key = TileKey::new(self.key.clone(), tile.z, tile.x, tile.y);
            let url = (self.url_template)(tile);
            if let Some(tex) = ctx.cache.request(&key, url) {
                painter.image(tex.id(), snap(r), full_uv, tint);
                continue;
            }
            // Placeholder: parent tile, one level up.
            if tile.z > 0 {
                let pk = TileKey::new(self.key.clone(), tile.z - 1, tile.x / 2, tile.y / 2);
                if let Some(tex) = ctx.cache.get_ready(&pk) {
                    let (qx, qy) = ((tile.x & 1) as f32 * 0.5, (tile.y & 1) as f32 * 0.5);
                    let uv = Rect::from_min_max(pos2(qx, qy), pos2(qx + 0.5, qy + 0.5));
                    painter.image(tex.id(), snap(r), uv, tint);
                }
            }
        }
    }
}

/// Esri "Canvas" basemap (World_Dark_Gray_Base / World_Light_Gray_Base).
/// Free to use without an API key (attribution required); tiles are served as z/y/x.
pub fn esri_basemap(dark: bool) -> RasterTileLayer {
    let style = if dark {
        "World_Dark_Gray_Base"
    } else {
        "World_Light_Gray_Base"
    };
    RasterTileLayer::new("basemap", format!("esri-{style}"), 16, move |t| {
        format!(
            "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/{style}/MapServer/tile/{}/{}/{}",
            t.z, t.y, t.x
        )
    })
}

/// Backwards-compatible alias for the previous CARTO basemap constructor.
pub fn carto_basemap(dark: bool) -> RasterTileLayer {
    esri_basemap(dark)
}

// ---------------------------------------------------------------------------
// WMS single-image layer
// ---------------------------------------------------------------------------

const EARTH_R: f64 = 6_378_137.0;

pub fn lonlat_to_3857(lon: f64, lat: f64) -> (f64, f64) {
    let lat = lat.clamp(-85.0511, 85.0511).to_radians();
    (
        EARTH_R * lon.to_radians(),
        EARTH_R * (std::f64::consts::FRAC_PI_4 + lat / 2.0).tan().ln(),
    )
}

pub fn lonlat_from_3857(x: f64, y: f64) -> (f64, f64) {
    (
        (x / EARTH_R).to_degrees(),
        (y / EARTH_R).sinh().atan().to_degrees(),
    )
}

struct WmsReq {
    key: String,
    url: String,
    bbox: (f64, f64, f64, f64),
    w: u32,
    h: u32,
    bucket: i64,
}

type WmsUrlBuilder = Box<dyn Fn((f64, f64, f64, f64), u32, u32) -> String + Send>;

pub struct WmsImageLayer {
    pub name: String,
    pub key: String,
    pub url_builder: WmsUrlBuilder,
    pub opacity: f32,
    /// Re-request the same view every N seconds (0 = never).
    pub refresh_secs: f64,
    pub visible: bool,
    /// Wait this long after the last viewport change before requesting.
    pub debounce_secs: f64,
    last_sig: Option<(f64, f64, f64, f32, f32)>,
    changed_at: f64,
    pending: bool,
    req: Option<WmsReq>,
    shown: Option<(TextureHandle, (f64, f64, f64, f64))>,
}

impl WmsImageLayer {
    pub fn new(
        name: impl Into<String>,
        key: impl Into<String>,
        refresh_secs: f64,
        url_builder: impl Fn((f64, f64, f64, f64), u32, u32) -> String + Send + 'static,
    ) -> Self {
        Self {
            name: name.into(),
            key: key.into(),
            url_builder: Box::new(url_builder),
            opacity: 1.0,
            refresh_secs,
            visible: true,
            debounce_secs: 0.3,
            last_sig: None,
            changed_at: 0.0,
            pending: false,
            req: None,
            shown: None,
        }
    }

    pub fn with_opacity(mut self, o: f32) -> Self {
        self.opacity = o;
        self
    }

    /// Forget the current image and request again on the next frame.
    pub fn reset(&mut self) {
        self.last_sig = None;
        self.req = None;
        self.shown = None;
    }

    /// Bounding box in EPSG:3857 meters and pixel size for the visible area.
    pub fn view_request(viewport: &Viewport, rect: Rect) -> ((f64, f64, f64, f64), u32, u32) {
        let tl = viewport.lonlat_from_screen_unwrapped(rect.left_top(), rect);
        let br = viewport.lonlat_from_screen_unwrapped(rect.right_bottom(), rect);
        let (x0, y1) = lonlat_to_3857(tl.0.max(-180.0), tl.1);
        let (x1, y0) = lonlat_to_3857(br.0.min(180.0), br.1);
        let w = (rect.width().ceil() as u32).clamp(16, 2048);
        let h = (rect.height().ceil() as u32).clamp(16, 2048);
        ((x0, y0, x1, y1), w, h)
    }

    fn make_req(&self, bbox: (f64, f64, f64, f64), w: u32, h: u32, bucket: i64) -> WmsReq {
        WmsReq {
            key: format!(
                "{}|{:.1},{:.1},{:.1},{:.1}|{w}x{h}|{bucket}",
                self.key, bbox.0, bbox.1, bbox.2, bbox.3
            ),
            url: (self.url_builder)(bbox, w, h),
            bbox,
            w,
            h,
            bucket,
        }
    }
}

impl Layer for WmsImageLayer {
    layer_boilerplate!();

    fn draw(&mut self, ctx: &mut DrawCtx, painter: &Painter) {
        let vp = ctx.viewport;
        let sig = (
            vp.center_lon,
            vp.center_lat,
            vp.zoom,
            ctx.rect.width(),
            ctx.rect.height(),
        );
        let bucket = if self.refresh_secs > 0.0 {
            (ctx.time / self.refresh_secs).floor() as i64
        } else {
            0
        };
        if self.last_sig != Some(sig) {
            if self.last_sig.is_none() && self.req.is_none() {
                self.changed_at = ctx.time - self.debounce_secs; // first request: no wait
            } else {
                self.changed_at = ctx.time;
            }
            self.last_sig = Some(sig);
            self.pending = true;
        }
        if self.pending {
            if ctx.time - self.changed_at >= self.debounce_secs && !vp.is_animating() {
                let (bbox, w, h) = Self::view_request(vp, ctx.rect);
                self.req = Some(self.make_req(bbox, w, h, bucket));
                self.pending = false;
            } else {
                painter
                    .ctx()
                    .request_repaint_after(Duration::from_millis(60));
            }
        } else if let Some(r) = &self.req {
            if r.bucket != bucket {
                let nr = self.make_req(r.bbox, r.w, r.h, bucket);
                self.req = Some(nr);
            }
        }
        if let Some(r) = &self.req {
            if let Some(tex) = ctx.cache.request_image(&r.key, &r.url) {
                self.shown = Some((tex.clone(), r.bbox));
            }
        }
        if let Some((tex, b)) = &self.shown {
            let (w, s) = lonlat_from_3857(b.0, b.1);
            let (e, n) = lonlat_from_3857(b.2, b.3);
            let a = vp.screen_from_lonlat(w, n, ctx.rect);
            let c = vp.screen_from_lonlat(e, s, ctx.rect);
            let tint = Color32::WHITE.linear_multiply(self.opacity.clamp(0.0, 1.0));
            painter.image(
                tex.id(),
                Rect::from_min_max(a, c),
                Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
                tint,
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Polygons
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct PolyItem {
    pub id: String,
    pub geometry: Geometry,
    pub fill: Color32,
    pub stroke: Color32,
    pub stroke_width: f32,
    pub pulse: bool,
    pub label: Option<String>,
}

/// Triangulated geometry in lon/lat space.
#[derive(Debug, Clone, Default)]
pub struct TriData {
    pub verts: Vec<[f64; 2]>,
    pub indices: Vec<usize>,
    /// (start, len) into `verts` for every ring (closing duplicate removed).
    pub rings: Vec<(usize, usize)>,
}

pub fn geometry_bbox(g: &Geometry) -> Option<BBox> {
    let mut b: Option<BBox> = None;
    let mut add = |p: &[f64; 2]| {
        b = Some(match b {
            None => BBox::new(p[0], p[1], p[0], p[1]),
            Some(o) => BBox::new(
                o.west.min(p[0]),
                o.south.min(p[1]),
                o.east.max(p[0]),
                o.north.max(p[1]),
            ),
        });
    };
    match g {
        Geometry::Point(p) => add(p),
        Geometry::LineString(r) => r.iter().for_each(&mut add),
        Geometry::Polygon(rs) => rs.iter().flatten().for_each(&mut add),
        Geometry::MultiPolygon(ps) => ps.iter().flatten().flatten().for_each(&mut add),
        Geometry::Other => {}
    }
    b
}

pub fn bbox_intersects(a: &BBox, b: &BBox) -> bool {
    a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south
}

fn open_ring(r: &[[f64; 2]]) -> &[[f64; 2]] {
    if r.len() > 1 && r.first() == r.last() {
        &r[..r.len() - 1]
    } else {
        r
    }
}

fn polygons_of(g: &Geometry) -> Vec<&Vec<Vec<[f64; 2]>>> {
    match g {
        Geometry::Polygon(p) => vec![p],
        Geometry::MultiPolygon(ps) => ps.iter().collect(),
        _ => vec![],
    }
}

/// Triangulate polygon / multipolygon geometry with earcut (lon/lat space).
pub fn triangulate(g: &Geometry) -> TriData {
    let mut out = TriData::default();
    for poly in polygons_of(g) {
        let base = out.verts.len();
        let mut flat: Vec<f64> = Vec::new();
        let mut holes: Vec<usize> = Vec::new();
        let mut count = 0usize;
        for (i, ring) in poly.iter().enumerate() {
            let ring = open_ring(ring);
            if ring.len() < 3 {
                if i == 0 {
                    break;
                }
                continue;
            }
            if i > 0 {
                holes.push(count);
            }
            out.rings.push((base + count, ring.len()));
            for p in ring {
                flat.extend_from_slice(p);
            }
            count += ring.len();
        }
        if count < 3 {
            continue;
        }
        match earcutr::earcut(&flat, &holes, 2) {
            Ok(idx) => {
                out.indices.extend(idx.into_iter().map(|i| i + base));
                out.verts.extend(flat.as_chunks::<2>().0.iter().copied());
            }
            Err(e) => {
                tracing::debug!("earcut failed: {e:?}");
                // Keep vertex numbering consistent with the ring table.
                out.verts.extend(flat.as_chunks::<2>().0.iter().copied());
            }
        }
    }
    out
}

fn point_in_ring(p: [f64; 2], ring: &[[f64; 2]]) -> bool {
    let mut inside = false;
    let n = ring.len();
    let mut j = n.wrapping_sub(1);
    for i in 0..n {
        let (a, b) = (ring[i], ring[j]);
        if (a[1] > p[1]) != (b[1] > p[1])
            && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]
        {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// Even-odd point-in-polygon over outer ring + holes.
pub fn point_in_polygon(p: [f64; 2], rings: &[Vec<[f64; 2]>]) -> bool {
    rings.iter().filter(|r| point_in_ring(p, r)).count() % 2 == 1
}

fn dist_to_segment(p: Pos2, a: Pos2, b: Pos2) -> f32 {
    let ab = b - a;
    let l2 = ab.length_sq();
    let t = if l2 <= f32::EPSILON {
        0.0
    } else {
        ((p - a).dot(ab) / l2).clamp(0.0, 1.0)
    };
    (p - (a + ab * t)).length()
}

pub struct PolygonLayer {
    pub name: String,
    pub items: Vec<PolyItem>,
    pub visible: bool,
    tri_cache: HashMap<String, TriData>,
}

impl PolygonLayer {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            items: Vec::new(),
            visible: true,
            tri_cache: HashMap::new(),
        }
    }

    /// Replace all items (clears the triangulation cache).
    pub fn set_items(&mut self, items: Vec<PolyItem>) {
        self.items = items;
        self.tri_cache.clear();
    }

    /// Items whose geometry contains the screen position (polygons) or lie within
    /// 6 px (lines). Topmost (last drawn) first.
    pub fn hit_test(&self, pos: Pos2, viewport: &Viewport, rect: Rect) -> Vec<&PolyItem> {
        let (lon, lat) = viewport.lonlat_from_screen(pos, rect);
        let mut out: Vec<&PolyItem> = self
            .items
            .iter()
            .filter(|it| match &it.geometry {
                Geometry::Polygon(rs) => point_in_polygon([lon, lat], rs),
                Geometry::MultiPolygon(ps) => ps.iter().any(|rs| point_in_polygon([lon, lat], rs)),
                Geometry::LineString(l) => {
                    let pts: Vec<Pos2> = l
                        .iter()
                        .map(|p| viewport.screen_from_lonlat(p[0], p[1], rect))
                        .collect();
                    pts.windows(2)
                        .any(|w| dist_to_segment(pos, w[0], w[1]) <= 6.0)
                }
                _ => false,
            })
            .collect();
        out.reverse();
        out
    }
}

impl Layer for PolygonLayer {
    layer_boilerplate!();

    fn draw(&mut self, ctx: &mut DrawCtx, painter: &Painter) {
        let vp = ctx.viewport;
        let vis = vp.visible_bbox(ctx.rect);
        let pulse = (ctx.time * 4.0).sin() as f32; // -1..1
        let mut any_pulse = false;
        for it in &self.items {
            let Some(bb) = geometry_bbox(&it.geometry) else {
                continue;
            };
            if !bbox_intersects(&bb, &vis) {
                continue;
            }
            let (stroke_w, stroke_c) = if it.pulse {
                any_pulse = true;
                (
                    it.stroke_width * (1.25 + 0.5 * pulse),
                    it.stroke.gamma_multiply(0.75 + 0.25 * pulse),
                )
            } else {
                (it.stroke_width, it.stroke)
            };
            let stroke = Stroke::new(stroke_w, stroke_c);
            match &it.geometry {
                Geometry::Polygon(_) | Geometry::MultiPolygon(_) => {
                    let tri = self
                        .tri_cache
                        .entry(it.id.clone())
                        .or_insert_with(|| triangulate(&it.geometry));
                    let pts: Vec<Pos2> = tri
                        .verts
                        .iter()
                        .map(|v| vp.screen_from_lonlat(v[0], v[1], ctx.rect))
                        .collect();
                    if it.fill.a() > 0 && !tri.indices.is_empty() {
                        let mesh = Mesh {
                            vertices: pts
                                .iter()
                                .map(|&pos| Vertex {
                                    pos,
                                    uv: WHITE_UV,
                                    color: it.fill,
                                })
                                .collect(),
                            indices: tri.indices.iter().map(|&i| i as u32).collect(),
                            ..Default::default()
                        };
                        painter.add(Shape::mesh(mesh));
                    }
                    if stroke_w > 0.0 {
                        for &(s, n) in &tri.rings {
                            painter.add(Shape::closed_line(pts[s..s + n].to_vec(), stroke));
                        }
                    }
                }
                Geometry::LineString(l) => {
                    let pts: Vec<Pos2> = l
                        .iter()
                        .map(|p| vp.screen_from_lonlat(p[0], p[1], ctx.rect))
                        .collect();
                    painter.add(Shape::line(pts, stroke));
                }
                Geometry::Point(p) => {
                    let c = vp.screen_from_lonlat(p[0], p[1], ctx.rect);
                    painter.circle(c, 4.0, it.fill, stroke);
                }
                Geometry::Other => {}
            }
            if let Some(label) = &it.label {
                let c = vp.screen_from_lonlat(
                    (bb.west + bb.east) / 2.0,
                    (bb.south + bb.north) / 2.0,
                    ctx.rect,
                );
                if ctx.rect.contains(c) {
                    painter.text(
                        c,
                        Align2::CENTER_CENTER,
                        label,
                        FontId::monospace(11.0),
                        it.stroke,
                    );
                }
            }
        }
        if any_pulse {
            painter
                .ctx()
                .request_repaint_after(Duration::from_millis(33));
        }
    }
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarkerKind {
    Pin,
    RadarSite { live: bool },
    Crosshair,
    Dot,
}

#[derive(Debug, Clone)]
pub struct Marker {
    pub id: String,
    pub lon: f64,
    pub lat: f64,
    pub kind: MarkerKind,
    pub color: Color32,
    pub label: Option<String>,
}

pub struct MarkerLayer {
    pub name: String,
    pub markers: Vec<Marker>,
    pub visible: bool,
}

impl MarkerLayer {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            markers: Vec::new(),
            visible: true,
        }
    }

    /// Markers within `radius_px` of the position, nearest first.
    pub fn hit_test(
        &self,
        pos: Pos2,
        radius_px: f32,
        viewport: &Viewport,
        rect: Rect,
    ) -> Vec<&Marker> {
        let mut v: Vec<(f32, &Marker)> = self
            .markers
            .iter()
            .filter_map(|m| {
                let d = (viewport.screen_from_lonlat(m.lon, m.lat, rect) - pos).length();
                (d <= radius_px).then_some((d, m))
            })
            .collect();
        v.sort_by(|a, b| a.0.total_cmp(&b.0));
        v.into_iter().map(|(_, m)| m).collect()
    }
}

impl Layer for MarkerLayer {
    layer_boilerplate!();

    fn draw(&mut self, ctx: &mut DrawCtx, painter: &Painter) {
        let outline = if ctx.dark {
            Color32::from_black_alpha(200)
        } else {
            Color32::from_white_alpha(220)
        };
        let text_c = if ctx.dark {
            Color32::from_gray(225)
        } else {
            Color32::from_gray(30)
        };
        let clip = ctx.rect.expand(20.0);
        for m in &self.markers {
            let c = ctx.viewport.screen_from_lonlat(m.lon, m.lat, ctx.rect);
            if !clip.contains(c) {
                continue;
            }
            let mut label_dx = 9.0;
            match m.kind {
                MarkerKind::Pin => {
                    painter.circle_filled(c, 6.5, outline);
                    painter.circle_filled(c, 5.0, m.color);
                    painter.circle_stroke(c, 8.5, Stroke::new(1.0, m.color.gamma_multiply(0.5)));
                    painter.circle_filled(c, 1.8, outline);
                    label_dx = 12.0;
                }
                MarkerKind::RadarSite { live } => {
                    let tri = vec![c + vec2(0.0, -6.0), c + vec2(5.5, 4.0), c + vec2(-5.5, 4.0)];
                    if live {
                        painter.add(Shape::convex_polygon(
                            tri,
                            m.color,
                            Stroke::new(1.0, outline),
                        ));
                    } else {
                        painter.add(Shape::closed_line(tri, Stroke::new(1.5, m.color)));
                    }
                }
                MarkerKind::Crosshair => {
                    let s = Stroke::new(1.5, m.color);
                    painter.circle_stroke(c, 7.0, s);
                    for d in [vec2(1.0, 0.0), vec2(0.0, 1.0)] {
                        painter.line_segment([c - d * 12.0, c - d * 4.0], s);
                        painter.line_segment([c + d * 4.0, c + d * 12.0], s);
                    }
                    label_dx = 14.0;
                }
                MarkerKind::Dot => {
                    painter.circle_filled(c, 3.5, m.color);
                    painter.circle_stroke(c, 3.5, Stroke::new(1.0, outline));
                    label_dx = 7.0;
                }
            }
            if let Some(l) = &m.label {
                let p = c + vec2(label_dx, 0.0);
                painter.text(
                    p + vec2(1.0, 1.0),
                    Align2::LEFT_CENTER,
                    l,
                    FontId::monospace(11.0),
                    outline,
                );
                painter.text(p, Align2::LEFT_CENTER, l, FontId::monospace(11.0), text_c);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Wind barbs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
pub struct Barb {
    pub lon: f64,
    pub lat: f64,
    /// Direction the wind blows FROM, degrees clockwise from north.
    pub dir_deg: f32,
    pub speed_kt: f32,
    pub gust_kt: Option<f32>,
}

/// `(pennants, full barbs, half barbs)` after rounding speed to the nearest 5 kt.
pub fn barb_components(speed_kt: f32) -> (u32, u32, u32) {
    if !speed_kt.is_finite() || speed_kt < 0.0 {
        return (0, 0, 0);
    }
    let n = ((speed_kt / 5.0).round() as u32) * 5;
    (n / 50, (n % 50) / 10, (n % 10) / 5)
}

pub struct WindBarbLayer {
    pub name: String,
    pub barbs: Vec<Barb>,
    pub color: Color32,
    pub visible: bool,
    pub min_zoom: f64,
}

impl WindBarbLayer {
    pub fn new(name: impl Into<String>, color: Color32) -> Self {
        Self {
            name: name.into(),
            barbs: Vec::new(),
            color,
            visible: true,
            min_zoom: 6.0,
        }
    }
}

impl Layer for WindBarbLayer {
    layer_boilerplate!();

    fn draw(&mut self, ctx: &mut DrawCtx, painter: &Painter) {
        if ctx.viewport.zoom < self.min_zoom {
            return;
        }
        let stroke = Stroke::new(1.5, self.color);
        let clip = ctx.rect.expand(40.0);
        for b in &self.barbs {
            let c = ctx.viewport.screen_from_lonlat(b.lon, b.lat, ctx.rect);
            if !clip.contains(c) {
                continue;
            }
            let (pennants, full, half) = barb_components(b.speed_kt);
            if pennants + full + half == 0 {
                painter.circle_stroke(c, 5.0, stroke);
                continue;
            }
            painter.circle_filled(c, 1.8, self.color);
            let d = b.dir_deg.to_radians();
            let u = vec2(d.sin(), -d.cos()); // toward the "from" direction
            let perp = vec2(-u.y, u.x); // clockwise side
            let len = 28.0;
            let tip = c + u * len;
            painter.line_segment([c, tip], stroke);
            let (blen, step, pen_w) = (11.0, 4.5, 5.0);
            let barb_vec = perp * blen * 0.87 + u * blen * 0.4;
            let mut pos = tip;
            for _ in 0..pennants {
                let inner = pos - u * pen_w;
                painter.add(Shape::convex_polygon(
                    vec![pos, pos + barb_vec * 0.9, inner],
                    self.color,
                    Stroke::NONE,
                ));
                pos = inner;
            }
            if pennants > 0 {
                pos -= u * 2.0;
            }
            for _ in 0..full {
                painter.line_segment([pos, pos + barb_vec], stroke);
                pos -= u * step;
            }
            if half > 0 {
                if pennants + full == 0 {
                    pos -= u * step; // lone half barb sits one step in from the tip
                }
                painter.line_segment([pos, pos + barb_vec * 0.5], stroke);
            }
            if let Some(g) = b.gust_kt.filter(|g| *g > b.speed_kt + 4.0) {
                painter.text(
                    tip + u * 8.0,
                    Align2::CENTER_CENTER,
                    format!("G{}", g.round() as i32),
                    FontId::monospace(9.0),
                    self.color.gamma_multiply(0.8),
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Range ring
// ---------------------------------------------------------------------------

pub struct RangeRingLayer {
    pub name: String,
    pub lon: f64,
    pub lat: f64,
    pub radius_m: f64,
    pub color: Color32,
    pub visible: bool,
}

impl RangeRingLayer {
    pub fn new(name: impl Into<String>, lon: f64, lat: f64, radius_m: f64, color: Color32) -> Self {
        Self {
            name: name.into(),
            lon,
            lat,
            radius_m,
            color,
            visible: true,
        }
    }
}

impl Layer for RangeRingLayer {
    layer_boilerplate!();

    fn draw(&mut self, ctx: &mut DrawCtx, painter: &Painter) {
        let c = ctx
            .viewport
            .screen_from_lonlat(self.lon, self.lat, ctx.rect);
        let r = (self.radius_m / ctx.viewport.meters_per_px(self.lat)) as f32;
        if !r.is_finite() || r < 1.0 || r > 20_000.0 {
            return;
        }
        painter.circle(
            c,
            r,
            self.color.gamma_multiply(0.06),
            Stroke::new(1.5, self.color),
        );
    }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

pub struct SelectionLayer {
    pub visible: bool,
    /// In-progress drag rectangle corners (screen).
    pub drag: Option<(Pos2, Pos2)>,
    pub bbox: Option<BBox>,
}

impl Default for SelectionLayer {
    fn default() -> Self {
        Self {
            visible: true,
            drag: None,
            bbox: None,
        }
    }
}

impl SelectionLayer {
    pub fn paint(&self, viewport: &Viewport, rect: Rect, painter: &Painter) {
        let accent = Color32::from_rgb(90, 170, 255);
        if let Some(b) = &self.bbox {
            let a = viewport.screen_from_lonlat(b.west, b.north, rect);
            let c = viewport.screen_from_lonlat(b.east, b.south, rect);
            let r = Rect::from_two_pos(a, c);
            painter.rect_filled(r, 0.0, accent.gamma_multiply(0.08));
            let pts = [
                r.left_top(),
                r.right_top(),
                r.right_bottom(),
                r.left_bottom(),
                r.left_top(),
            ];
            painter.extend(Shape::dashed_line(&pts, Stroke::new(1.5, accent), 6.0, 4.0));
        }
        if let Some((a, b)) = self.drag {
            let r = Rect::from_two_pos(a, b);
            painter.rect_filled(r, 0.0, accent.gamma_multiply(0.15));
            painter.rect_stroke(r, 0.0, Stroke::new(1.0, accent), StrokeKind::Inside);
        }
    }
}

impl Layer for SelectionLayer {
    fn draw(&mut self, ctx: &mut DrawCtx, painter: &Painter) {
        self.paint(ctx.viewport, ctx.rect, painter);
    }
    fn name(&self) -> &str {
        "selection"
    }
    fn visible(&self) -> bool {
        self.visible
    }
    fn set_visible(&mut self, v: bool) {
        self.visible = v;
    }
    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square(x: f64, y: f64, s: f64) -> Vec<[f64; 2]> {
        vec![[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]
    }

    #[test]
    fn earcut_with_hole() {
        let g = Geometry::Polygon(vec![square(0.0, 0.0, 10.0), square(3.0, 3.0, 4.0)]);
        let t = triangulate(&g);
        assert_eq!(t.verts.len(), 8);
        assert_eq!(t.rings, vec![(0, 4), (4, 4)]);
        assert!(!t.indices.is_empty());
        assert_eq!(t.indices.len() % 3, 0);
        assert!(t.indices.iter().all(|&i| i < t.verts.len()));
        // A square with a square hole triangulates into 8 triangles.
        assert_eq!(t.indices.len() / 3, 8);
    }

    #[test]
    fn earcut_multipolygon_offsets() {
        let g = Geometry::MultiPolygon(vec![
            vec![square(0.0, 0.0, 1.0)],
            vec![square(5.0, 5.0, 1.0)],
        ]);
        let t = triangulate(&g);
        assert_eq!(t.verts.len(), 8);
        assert_eq!(t.indices.len(), 12);
        assert!(t.indices[6..].iter().all(|&i| i >= 4));
    }

    #[test]
    fn point_in_polygon_respects_holes() {
        let rings = vec![square(0.0, 0.0, 10.0), square(3.0, 3.0, 4.0)];
        assert!(point_in_polygon([1.0, 1.0], &rings));
        assert!(!point_in_polygon([5.0, 5.0], &rings));
        assert!(!point_in_polygon([20.0, 5.0], &rings));
    }

    #[test]
    fn polygon_hit_test() {
        let mut layer = PolygonLayer::new("p");
        layer.set_items(vec![PolyItem {
            id: "a".into(),
            geometry: Geometry::Polygon(vec![square(-1.0, -1.0, 2.0)]),
            fill: Color32::RED,
            stroke: Color32::RED,
            stroke_width: 1.0,
            pulse: false,
            label: None,
        }]);
        let vp = Viewport::new(0.0, 0.0, 5.0, vec2(400.0, 400.0));
        let rect = Rect::from_min_size(pos2(0.0, 0.0), vec2(400.0, 400.0));
        assert_eq!(layer.hit_test(rect.center(), &vp, rect).len(), 1);
        assert!(layer.hit_test(pos2(5.0, 5.0), &vp, rect).is_empty());
    }

    #[test]
    fn bbox_culling() {
        let g = Geometry::Polygon(vec![square(-112.0, 33.0, 2.0)]);
        let bb = geometry_bbox(&g).unwrap();
        let vp = Viewport::new(-111.0, 34.0, 6.0, vec2(800.0, 600.0));
        let rect = Rect::from_min_size(pos2(0.0, 0.0), vec2(800.0, 600.0));
        assert!(bbox_intersects(&bb, &vp.visible_bbox(rect)));
        let far = Viewport::new(10.0, 50.0, 6.0, vec2(800.0, 600.0));
        assert!(!bbox_intersects(&bb, &far.visible_bbox(rect)));
        assert!(geometry_bbox(&Geometry::Other).is_none());
    }

    #[test]
    fn barb_counts() {
        assert_eq!(barb_components(0.0), (0, 0, 0));
        assert_eq!(barb_components(2.0), (0, 0, 0));
        assert_eq!(barb_components(5.0), (0, 0, 1));
        assert_eq!(barb_components(10.0), (0, 1, 0));
        assert_eq!(barb_components(15.0), (0, 1, 1));
        assert_eq!(barb_components(50.0), (1, 0, 0));
        assert_eq!(barb_components(65.0), (1, 1, 1));
        assert_eq!(barb_components(115.0), (2, 1, 1));
        assert_eq!(barb_components(f32::NAN), (0, 0, 0));
    }

    #[test]
    fn mercator_3857_roundtrip() {
        let (x, y) = lonlat_to_3857(-112.0, 34.0);
        let (lon, lat) = lonlat_from_3857(x, y);
        assert!((lon + 112.0).abs() < 1e-9 && (lat - 34.0).abs() < 1e-9);
        assert!((lonlat_to_3857(180.0, 0.0).0 - 20_037_508.342_789_244).abs() < 1e-3);
    }

    #[test]
    fn esri_url_is_z_y_x() {
        let l = esri_basemap(true);
        assert_eq!(
            (l.url_template)(TileId { z: 3, x: 1, y: 2 }),
            "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/3/2/1"
        );
        assert_eq!(l.max_zoom, 16);
        let light = esri_basemap(false);
        assert!((light.url_template)(TileId { z: 1, x: 0, y: 0 }).contains("World_Light_Gray_Base"));
    }
}
