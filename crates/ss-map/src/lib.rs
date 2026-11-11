//! Silver Skies map engine for egui.
//!
//! Web Mercator viewport, async tile cache, and a stack of layers (raster tiles,
//! WMS images, polygons, markers, wind barbs, range rings, selection) drawn by [`MapWidget`].

pub mod layers;
pub mod legend;
pub mod map;
pub mod tiles;
pub mod viewport;

pub use layers::{
    barb_components, bbox_intersects, carto_basemap, esri_basemap, geometry_bbox, lonlat_from_3857,
    lonlat_to_3857, point_in_polygon, triangulate, Barb, DrawCtx, Layer, LayerStack, Marker,
    MarkerKind, MarkerLayer, PolyItem, PolygonLayer, RangeRingLayer, RasterTileLayer,
    SelectionLayer, TriData, WindBarbLayer, WmsImageLayer,
};
pub use legend::{draw_color_legend, radar_dbz_stops};
pub use map::{MapResponse, MapWidget, BACKGROUND};
pub use tiles::{TileCache, TileKey, TileState, TileStats};
pub use viewport::{FlyAnim, TileId, Units, Viewport};
