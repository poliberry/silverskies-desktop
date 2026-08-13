// Shared CARTO basemap tile URLs — used by the main radar map and the
// station radar dialog's own mini-map, so both stay in sync if the tile
// source ever changes.
export const CARTO_DARK = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
// "light_all" (CARTO's muted Positron style), not the bare "voyager" path —
// voyager 404s unless served under "/rastertiles/voyager/…", and being
// flat/low-contrast like dark_all, it's also the better basemap to put a
// semi-transparent radar overlay on top of.
export const CARTO_LIGHT = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
export const CARTO_ATTRIB =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
