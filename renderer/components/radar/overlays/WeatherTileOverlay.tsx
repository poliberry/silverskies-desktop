"use client";

import { TileLayer } from "react-leaflet";
import { owmTileUrl, type OwmOverlayLayer } from "@/lib/overlays/openweathermap";

export interface WeatherTileOverlayProps {
  layer: OwmOverlayLayer;
  apiKey: string;
  zIndex?: number;
  opacity?: number;
}

/** Thin TileLayer wrapper around one of OpenWeatherMap's wind/temp/
 * precipitation raster layers — stacked above the radar crossfade
 * (zIndex 5) at a lower opacity so both remain legible together. */
export function WeatherTileOverlay({ layer, apiKey, zIndex = 6, opacity = 0.55 }: WeatherTileOverlayProps) {
  return <TileLayer url={owmTileUrl(layer, apiKey)} opacity={opacity} zIndex={zIndex} />;
}
