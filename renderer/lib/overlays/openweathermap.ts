// OpenWeatherMap-backed overlays: wind/temperature/precipitation as real
// map tile layers (OWM's documented "Weather Maps 1.0" tile set), and air
// quality as a point reading — OWM has no public raster tile layer for AQI
// on the accessible tiers, only the point/grid "Air Pollution API", so that
// one surfaces as a badge (AqiBadge.tsx) rather than a TileLayer.

export type OwmOverlayLayer = "wind_new" | "temp_new" | "precipitation_new";

export function owmTileUrl(layer: OwmOverlayLayer, apiKey: string): string {
  return `https://tile.openweathermap.org/map/${layer}/{z}/{x}/{y}.png?appid=${apiKey}`;
}

/** OWM's own 1-5 Air Quality Index scale (not the US EPA 0-500 AQI scale). */
export type OwmAqi = 1 | 2 | 3 | 4 | 5;

export interface AirQualityReading {
  aqi: OwmAqi;
  components: {
    pm2_5: number;
    pm10: number;
    o3: number;
    no2: number;
  };
}

const AQI_LABELS: Record<OwmAqi, string> = {
  1: "Good",
  2: "Fair",
  3: "Moderate",
  4: "Poor",
  5: "Very Poor",
};

export function aqiLabel(aqi: OwmAqi): string {
  return AQI_LABELS[aqi] ?? "Unknown";
}

export async function fetchAirQuality(lat: number, lon: number, apiKey: string): Promise<AirQualityReading | null> {
  const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const data = await r.json();
  const item = data?.list?.[0];
  if (!item?.main?.aqi) return null;
  return { aqi: item.main.aqi, components: item.components };
}
