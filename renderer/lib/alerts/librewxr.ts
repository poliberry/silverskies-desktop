import type { NormalizedAlert } from "@/types/alerts";
import { alertClass, getDisplayEvent } from "./classify";

export interface LibreWxrFrame {
  time: number;
  path: string;
}

export interface LibreWxrColorScheme {
  id: number;
  name: string;
}

export interface LibreWxrWeatherMaps {
  version: string;
  generated: number;
  host: string;
  radar: {
    past: LibreWxrFrame[];
    nowcast: LibreWxrFrame[];
    colorSchemes: LibreWxrColorScheme[];
  };
  satellite: {
    infrared: LibreWxrFrame[];
  };
}

/** RainViewer-v2-compatible metadata: available radar/nowcast/satellite
 * frame timestamps + color schemes, from a LibreWXR instance (defaults to
 * the public `api.librewxr.net`, overridable in Settings). */
export async function fetchWeatherMaps(host: string): Promise<LibreWxrWeatherMaps> {
  const r = await fetch(`${host}/public/weather-maps.json`);
  if (!r.ok) throw new Error(`LibreWXR error ${r.status}`);
  return r.json();
}

export interface RadarTileOptions {
  size?: 256 | 512;
  /** 0-11 named scheme, or 255 for raw dBZ. */
  color?: number;
  smooth?: 0 | 1;
  snow?: 0 | 1;
  ext?: "png" | "webp";
  arrows?: "light" | "dark" | null;
  cells?: "light" | "dark" | null;
}

export function radarTileUrl(host: string, framePath: string, opts: RadarTileOptions = {}): string {
  const { size = 256, color = 1, smooth = 1, snow = 0, ext = "png", arrows, cells } = opts;
  let url = `${host}${framePath}/${size}/{z}/{x}/{y}/${color}/${smooth}_${snow}.${ext}`;
  const params: string[] = [];
  if (arrows) params.push(`arrows=${arrows}`);
  if (cells) params.push(`cells=${cells}`);
  if (params.length) url += `?${params.join("&")}`;
  return url;
}

export function satelliteTileUrl(
  host: string,
  framePath: string,
  opts: { size?: 256 | 512; ext?: "png" | "webp" } = {},
): string {
  const { size = 256, ext = "png" } = opts;
  return `${host}${framePath}/${size}/{z}/{x}/{y}/0/0_0.${ext}`;
}

export type BBox = [west: number, south: number, east: number, north: number];

interface LibreWxrAlertFeature {
  type: "Feature";
  geometry: { type: string; coordinates: unknown } | null;
  properties: {
    title?: string;
    event?: string;
    severity?: string;
    time?: number;
    expires?: number;
    description?: string;
    regions?: string[];
    uri?: string;
  };
}

/** Global WMO CAP + MeteoAlarm + NWS-zone alerts, queried by bounding box —
 * the source for both the radar map's alert polygons and (for regions
 * outside NWS/ECCC coverage) the audit log. */

/**
 * Leaflet's `map.getBounds()` isn't clamped to valid Earth coordinates —
 * zoomed out enough (or panned near the antimeridian, since the map wraps
 * horizontally by default) it can return longitudes well outside ±180°.
 * LibreWXR's `/v2/alerts` endpoint 400s on an out-of-range bbox, and that
 * error was being swallowed into an empty result — i.e. polygons silently
 * vanishing the moment you zoomed out far enough to wrap. Clamping here
 * keeps the request valid; a view that wraps past the antimeridian loses a
 * sliver of coverage on one side rather than the whole request failing.
 */
function clampBBox([west, south, east, north]: BBox): BBox {
  const clampLon = (v: number) => Math.max(-180, Math.min(180, v));
  const clampLat = (v: number) => Math.max(-85, Math.min(85, v));
  return [clampLon(west), clampLat(south), clampLon(east), clampLat(north)];
}

export async function fetchLibreWxrAlerts(host: string, rawBbox: BBox): Promise<NormalizedAlert[]> {
  const bbox = clampBBox(rawBbox);
  try {
    const r = await fetch(`${host}/v2/alerts?bbox=${bbox.join(",")}`);
    if (!r.ok) return [];
    const geojson = await r.json();
    const features: LibreWxrAlertFeature[] = geojson.features ?? [];
    return features.map((f, i): NormalizedAlert => {
      const p = f.properties;
      const event = p.title ?? p.event ?? "Weather Alert";
      const cls = alertClass(event, p.severity, p.title, p.description);
      return {
        id: `librewxr:${p.uri ?? i}`,
        source: "librewxr",
        event,
        displayEvent: getDisplayEvent(event, cls),
        cssClass: cls,
        description: p.description,
        severity: p.severity,
        areaDesc: p.regions?.join(", "),
        onset: p.time ? new Date(p.time * 1000).toISOString() : undefined,
        sent: p.time ? new Date(p.time * 1000).toISOString() : undefined,
        expires: p.expires ? new Date(p.expires * 1000).toISOString() : undefined,
        issuingOffice: "WMO",
        url: p.uri,
        geometry: f.geometry,
      };
    });
  } catch {
    return [];
  }
}
