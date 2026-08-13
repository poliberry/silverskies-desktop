"use client";

import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, WMSTileLayer, Marker, Circle } from "react-leaflet";
import L from "leaflet";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRadarStations } from "@/hooks/useRadarStations";
import { useSettings } from "@/hooks/useSettings";
import { hasSails, isStationLive, vcpLabel } from "@/lib/radar-stations";
import { RADAR_PRODUCTS, stationLayerName, stationLegendUrl, stationWmsUrl } from "@/lib/radar-station-products";
import { CARTO_DARK, CARTO_LIGHT, CARTO_ATTRIB } from "@/lib/basemap-tiles";
import { openMeteoProvider } from "@/lib/providers/open-meteo";
import { fmtWind, windDirLabel, windSpeedUnit } from "@/lib/units";
import { WindCompass } from "./WindCompass";

export interface StationRadarDialogProps {
  stationId: string | null;
  onClose: () => void;
  theme: "light" | "dark";
}

// The classic WSR-88D "short range" coverage (124 nautical miles) — drawn as
// a reference ring; the WMS image itself only ever paints real data, so
// nothing outside the radar's actual range shows regardless of this ring.
const RANGE_RING_METERS = 229_664;
// Roughly matches typical NEXRAD volume-scan cadence, so the image doesn't
// visibly go stale while the dialog is left open.
const IMAGE_REFRESH_MS = 2 * 60_000;

// Leaflet path colors need real values, not CSS custom properties (Leaflet
// sets them as raw SVG/canvas style attributes, not through a stylesheet) —
// these mirror --text3's actual light/dark values in app/globals.css.
const RING_COLOR = { light: "rgba(15, 14, 26, 0.38)", dark: "rgba(240, 238, 255, 0.3)" };

function centerIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="width:10px;height:10px;border-radius:50%;background:rgb(var(--a0));box-shadow:0 0 0 3px rgba(var(--a0),0.25),0 0 10px rgba(var(--a0),0.8);"></div>`,
    iconSize: [10, 10],
  });
}

/**
 * The "click a station, get its own radar" panel: a dedicated mini-map with
 * NOAA/NCEP's real single-site WMS products, a product picker, a decorative
 * sweep animation (screen-space, not geo-synced — purely cosmetic, per the
 * "simulate radar scanning" ask), scan/VCP/FastScan metadata from the NWS
 * radar-stations API, and the station's current wind.
 */
export function StationRadarDialog({ stationId, onClose, theme }: StationRadarDialogProps) {
  const { config } = useSettings();
  const unit = config?.units ?? "F";
  const { data: stations } = useRadarStations(Boolean(stationId));
  const station = useMemo(() => stations?.find((s) => s.id === stationId) ?? null, [stations, stationId]);

  const [productId, setProductId] = useState(RADAR_PRODUCTS[0].id);
  const product = RADAR_PRODUCTS.find((p) => p.id === productId) ?? RADAR_PRODUCTS[0];

  // Bumped on a timer to force WMSTileLayer to remount and pull a fresh
  // image — GeoServer always serves whatever its latest mosaic is regardless
  // of query params, so a plain re-render wouldn't otherwise ask again.
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    if (!stationId) return;
    const id = setInterval(() => setRefreshTick((t) => t + 1), IMAGE_REFRESH_MS);
    return () => clearInterval(id);
  }, [stationId]);

  const windQuery = useQuery({
    queryKey: ["station-wind", station?.id],
    queryFn: () => openMeteoProvider.fetchWeather({ lat: station!.lat, lon: station!.lon }),
    enabled: Boolean(station),
    refetchInterval: 5 * 60_000,
  });

  if (!station) return null;

  const live = isStationLive(station.lastReceivedTime);
  const scanTime = station.lastReceivedTime
    ? new Date(station.lastReceivedTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

  return (
    <Dialog
      open={Boolean(stationId)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] w-full overflow-y-auto thin-scroll rounded-none sm:max-w-2xl" initialFocus={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono normal-case">
            {station.id}
            <span className="text-sm font-normal" style={{ color: "var(--text2)" }}>
              {station.name}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 font-mono text-xs" style={{ color: "var(--text2)" }}>
            <span>
              Scan: {scanTime} {live ? <span style={{ color: "var(--danger)" }}>Live</span> : <span style={{ color: "var(--text3)" }}>Delayed</span>}
            </span>
            <span>
              VCP: {station.vcp ?? "—"} ({vcpLabel(station.vcp)})
            </span>
            {hasSails(station.vcp) && (
              <span
                className="rounded-full px-2 py-0.5"
                style={{ background: "var(--accent-glow)", color: "var(--accent2)" }}
                title="This VCP includes supplemental low-level scans (SAILS/MESO-SAILS) for faster updates between full volume scans."
              >
                FastScan
              </span>
            )}
            {station.operabilityStatus && <span style={{ color: "var(--text3)" }}>{station.operabilityStatus}</span>}
          </div>

          <div className="relative overflow-hidden" style={{ height: 360, background: "var(--bg)" }}>
            <MapContainer
              center={[station.lat, station.lon]}
              zoom={7}
              zoomControl={false}
              dragging={false}
              scrollWheelZoom={false}
              doubleClickZoom={false}
              className="h-full w-full"
              attributionControl={false}
            >
              <TileLayer url={theme === "light" ? CARTO_LIGHT : CARTO_DARK} attribution={CARTO_ATTRIB} />
              <WMSTileLayer
                key={`${station.id}-${product.id}-${refreshTick}`}
                url={stationWmsUrl(station.id)}
                layers={stationLayerName(station.id, product)}
                styles={product.styleName}
                format="image/png"
                transparent
                version="1.1.1"
                opacity={0.85}
              />
              <Circle
                center={[station.lat, station.lon]}
                radius={RANGE_RING_METERS}
                pathOptions={{ color: RING_COLOR[theme], weight: 1, fill: false, dashArray: "4 4" }}
              />
              <Marker position={[station.lat, station.lon]} icon={centerIcon()} />
            </MapContainer>
            {/* Decorative only — a fixed screen-space sweep, not tied to the
                map's real geographic scale or the radar's actual antenna
                azimuth (no free feed exposes that). */}
            <div className="radar-sweep" aria-hidden="true" />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {RADAR_PRODUCTS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`radar-product-btn ${p.id === productId ? "active" : ""}`}
                onClick={() => setProductId(p.id)}
                title={p.description}
              >
                <img src={stationLegendUrl(station.id, p)} alt="" className="radar-product-legend" />
                <span>{p.label}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-xs" style={{ color: "var(--text2)" }}>
            <div className="flex items-center gap-2">
              <WindCompass directionDeg={windQuery.data?.current.windDirectionDeg ?? 0} loading={windQuery.isLoading} />
              <span>
                {windQuery.data
                  ? `${fmtWind(windQuery.data.current.windSpeedKmh, unit)} ${windSpeedUnit(unit)} ${windDirLabel(windQuery.data.current.windDirectionDeg)}`
                  : "Wind —"}
              </span>
            </div>
            <span style={{ color: "var(--text3)" }}>Products: NOAA/NCEP RIDGE II · Station data: NWS</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
