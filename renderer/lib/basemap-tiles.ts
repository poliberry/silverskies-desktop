// Shared basemap tile URL — used by the main radar map and the
// station radar dialog's own mini-map, so both stay in sync if the tile
// source ever changes.
//
// OpenStreetMap's standard raster tiles: fully open (ODbL data, CC-BY-SA
// tiles), no API key, no account. Previously this was CARTO's
// basemaps.cartocdn.com, which started requiring an API key and renders
// "API KEY REQUIRED" watermarks without one.
//
// OSM only publishes a light style, so dark mode is handled client-side:
// the TileLayer gets OSM_DARK_CLASS (see globals.css), a standard
// invert + hue-rotate that turns the light tiles into a dark basemap
// suitable for sitting under a semi-transparent radar overlay.
//
// Note: tile.openstreetmap.org is a shared resource with a usage policy
// (https://operations.osmfoundation.org/policies/tiles/). Per-user traffic
// from a desktop app is normally fine, but if usage grows substantially,
// consider switching to a tile provider or self-hosted tiles.
export const OSM_STANDARD = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSM_ATTRIB =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
// CSS class applied to OSM tile images when the app is in dark mode.
export const OSM_DARK_CLASS = "osm-dark-tiles";
