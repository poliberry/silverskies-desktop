import type { RadarProductDef } from "@/types/radar-stations";

// NOAA/NCEP's public GeoServer WMS (opengeo.ncep.noaa.gov) publishes real,
// individually-georeferenced NEXRAD Level 3 "RIDGE II" products per site —
// confirmed against its own GetCapabilities response, which lists exactly
// these five layers per station workspace (e.g. "kama:kama_sr_bref"), each
// with its own WMS bounding box and a time dimension. No key required, and
// CORS is wide open (Access-Control-Allow-Origin: *).
export const RADAR_PRODUCTS: RadarProductDef[] = [
  {
    id: "sr_bref",
    label: "Reflectivity",
    styleName: "radar_reflectivity",
    description: "Super-resolution base reflectivity — precipitation intensity.",
  },
  {
    id: "sr_bvel",
    label: "Velocity",
    styleName: "radar_velocity",
    description: "Super-resolution base radial velocity — motion toward/away from the radar.",
  },
  {
    id: "bdhc",
    label: "Hydrometeor Class.",
    styleName: "radar_bdhc",
    description: "Dual-pol digital hydrometeor classification — rain, hail, snow, and more.",
  },
  {
    id: "bdsa",
    label: "Storm Total Precip",
    styleName: "radar_bdsa",
    description: "Dual-pol digital storm total precipitation.",
  },
  {
    id: "boha",
    label: "1-Hr Accumulation",
    styleName: "radar_boha",
    description: "Surface rainfall accumulation, running one-hour total.",
  },
];

const WMS_BASE = "https://opengeo.ncep.noaa.gov/geoserver";

export function stationWmsUrl(stationId: string): string {
  return `${WMS_BASE}/${stationId.toLowerCase()}/wms`;
}

export function stationLayerName(stationId: string, product: RadarProductDef): string {
  const site = stationId.toLowerCase();
  return `${site}:${site}_${product.id}`;
}

export function stationLegendUrl(stationId: string, product: RadarProductDef): string {
  const params = new URLSearchParams({
    service: "WMS",
    version: "1.3.0",
    request: "GetLegendGraphic",
    format: "image/png",
    layer: stationLayerName(stationId, product),
  });
  return `${stationWmsUrl(stationId)}?${params}`;
}
