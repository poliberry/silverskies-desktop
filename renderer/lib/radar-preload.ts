import { radarTileUrl, type RadarTileOptions } from "@/lib/alerts/librewxr";

/** Standard slippy-map lat/lon → tile x/y at a given zoom (Web Mercator). */
export function latLonToTile(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const latRad = (lat * Math.PI) / 180;
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

/** The tile itself plus a `radius`-tile ring around it (radius 1 = 3×3, 2 = 5×5). */
export function tilesAround(lat: number, lon: number, zoom: number, radius: number): { x: number; y: number; z: number }[] {
  const { x: cx, y: cy } = latLonToTile(lat, lon, zoom);
  const max = 2 ** zoom;
  const tiles: { x: number; y: number; z: number }[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const x = ((cx + dx) % max + max) % max; // wrap horizontally at the antimeridian
      const y = cy + dy;
      if (y < 0 || y >= max) continue;
      tiles.push({ x, y, z: zoom });
    }
  }
  return tiles;
}

const inFlight = new Set<string>();

/** Fire-and-forget image preload — relies on the browser's HTTP cache (and
 * LibreWXR's `Cache-Control: max-age=300` on tiles) to make the *real*
 * TileLayer request an instant cache hit later. De-dupes in-flight/complete
 * requests within this module's lifetime so re-renders don't re-fetch. */
function preloadTileImage(url: string) {
  if (inFlight.has(url)) return;
  inFlight.add(url);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
}

/** Preloads one radar frame's tiles around a point at a given zoom/radius. */
export function preloadRadarFrame(
  host: string,
  framePath: string,
  lat: number,
  lon: number,
  opts: RadarTileOptions,
  zoom: number,
  radius: number,
) {
  const template = radarTileUrl(host, framePath, opts);
  for (const t of tilesAround(lat, lon, zoom, radius)) {
    preloadTileImage(template.replace("{z}", String(t.z)).replace("{x}", String(t.x)).replace("{y}", String(t.y)));
  }
}
