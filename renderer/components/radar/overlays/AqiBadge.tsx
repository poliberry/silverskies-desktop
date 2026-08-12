"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchAirQuality, aqiLabel, type OwmAqi } from "@/lib/overlays/openweathermap";

export interface AqiBadgeProps {
  lat: number;
  lon: number;
  apiKey: string;
}

const AQI_COLORS: Record<OwmAqi, string> = {
  1: "#4ade80",
  2: "#a3e635",
  3: "#facc15",
  4: "#fb923c",
  5: "#f87171",
};

/** Air quality at the radar's active location — styled like the existing
 * "LIVE" pill in LeafletRadarMap. Not a full-map overlay: OpenWeatherMap
 * doesn't publish an AQI raster tile layer on the accessible tiers, only
 * this point/grid API, so a badge is the honest equivalent here. */
export function AqiBadge({ lat, lon, apiKey }: AqiBadgeProps) {
  const { data } = useQuery({
    queryKey: ["owm-air-quality", lat, lon, apiKey],
    queryFn: () => fetchAirQuality(lat, lon, apiKey),
    refetchInterval: 30 * 60_000,
    enabled: Boolean(apiKey),
  });

  if (!data) return null;
  const color = AQI_COLORS[data.aqi] ?? "var(--text2)";

  return (
    <div
      className="glass-card flex items-center gap-1.5 px-2.5 py-1.5 font-mono text-[0.65rem] tracking-wider"
      style={{ color }}
      title="Air quality index at the current location (OpenWeatherMap)"
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      AQI {aqiLabel(data.aqi).toUpperCase()}
    </div>
  );
}
