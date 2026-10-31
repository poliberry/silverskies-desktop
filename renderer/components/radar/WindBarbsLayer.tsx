"use client";

import { useMemo, useState } from "react";
import { Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { BBox } from "@/lib/alerts/librewxr";
import { useMetarStations } from "@/hooks/useMetarStations";
import { useMetarObservations, type MetarStationObservation } from "@/hooks/useMetarObservations";

const ICON_SIZE = 34;

/** Standard meteorological wind-barb glyph: a shaft pointing toward the
 * direction the wind is coming from (windDirection's own convention — same
 * as METAR/aviation reports, so no conversion needed, just a CSS rotation of
 * a shaft drawn pointing "up"/north by default), with pennants (50kt),
 * full barbs (10kt) and a half barb (5kt) stacked near the tip. Calm
 * (<2kt) draws a bare circle instead of a shaft, per convention. */
function windBarbIcon(directionDeg: number, speedKt: number): L.DivIcon {
  const cx = ICON_SIZE / 2;
  const shaftTopY = 4;
  const shaftBottomY = ICON_SIZE - 4;

  let html: string;
  if (speedKt < 2) {
    html = `<svg width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">
      <circle cx="${cx}" cy="${cx}" r="4" fill="none" stroke="var(--text2)" stroke-width="1.5" />
    </svg>`;
  } else {
    let remaining = Math.round(speedKt / 5) * 5;
    const pennants = Math.floor(remaining / 50);
    remaining -= pennants * 50;
    const fullBarbs = Math.floor(remaining / 10);
    remaining -= fullBarbs * 10;
    const halfBarb = remaining >= 5;

    const parts: string[] = [
      `<line x1="${cx}" y1="${shaftBottomY}" x2="${cx}" y2="${shaftTopY}" stroke="var(--text2)" stroke-width="1.5" />`,
      `<circle cx="${cx}" cy="${shaftBottomY}" r="2" fill="var(--text2)" />`,
    ];
    let y = shaftTopY;
    const step = 4;
    for (let i = 0; i < pennants; i++) {
      parts.push(`<path d="M ${cx} ${y} L ${cx + 9} ${y + 3} L ${cx} ${y + 6} Z" fill="var(--text2)" />`);
      y += step + 2;
    }
    for (let i = 0; i < fullBarbs; i++) {
      parts.push(`<line x1="${cx}" y1="${y}" x2="${cx + 9}" y2="${y - 3}" stroke="var(--text2)" stroke-width="1.5" />`);
      y += step;
    }
    if (halfBarb) {
      parts.push(`<line x1="${cx}" y1="${y}" x2="${cx + 5}" y2="${y - 1.5}" stroke="var(--text2)" stroke-width="1.5" />`);
    }
    html = `<svg width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}" style="transform: rotate(${directionDeg}deg); transform-origin: ${cx}px ${cx}px;">${parts.join("")}</svg>`;
  }

  return L.divIcon({ className: "", html, iconSize: [ICON_SIZE, ICON_SIZE], iconAnchor: [cx, cx] });
}

function boundsToBBox(bounds: L.LatLngBounds): BBox {
  return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
}

/** Live METAR/ASOS wind speed + direction across the visible map, toggled
 * via RadarSettingsDropdowns' "Wind Barbs" item — mirrors RadarStationsLayer's
 * shape (a memoized `<Marker>` per station built from a query's data), but
 * additionally scopes its own data fetch to the current viewport/zoom (see
 * useMetarObservations) since this station network is far larger than the
 * 159 WSR-88D sites. */
export function WindBarbsLayer() {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  const [viewportBbox, setViewportBbox] = useState<BBox>(() => boundsToBBox(map.getBounds()));

  useMapEvents({
    moveend: () => {
      // Rounded so panning by a few pixels doesn't spam refetches — same
      // tolerance AlertPolygonsLayer's own bbox tracking uses.
      setViewportBbox(boundsToBBox(map.getBounds()).map((v) => Math.round(v * 20) / 20) as BBox);
      setZoom(map.getZoom());
    },
  });

  const { data: stations } = useMetarStations(true);
  const observations = useMetarObservations(stations, viewportBbox, zoom, true);

  const markers = useMemo(
    () =>
      observations.map(({ station, observation }: MetarStationObservation) => (
        <Marker
          key={station.id}
          position={[station.lat, station.lon]}
          icon={windBarbIcon(observation.windDirectionDeg ?? 0, observation.windSpeedKt ?? 0)}
        >
          <Popup>
            <div className="font-mono text-xs">
              <strong>{station.id}</strong> — {station.name}
              <br />
              {observation.windSpeedKt != null ? `${Math.round(observation.windSpeedKt)} kt` : "Calm/unknown"}
              {observation.windGustKt != null && ` (gusting ${Math.round(observation.windGustKt)} kt)`}
              {observation.windDirectionDeg != null && ` from ${Math.round(observation.windDirectionDeg)}°`}
            </div>
          </Popup>
        </Marker>
      )),
    [observations],
  );

  return <>{markers}</>;
}
