"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, GeoJSON, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { Feature, FeatureCollection } from "geojson";
import { useQuery } from "@tanstack/react-query";
import {
  fetchWeatherMaps,
  fetchLibreWxrAlerts,
  radarTileUrl,
  type BBox,
  type LibreWxrFrame,
} from "@/lib/alerts/librewxr";
import { resolveAlertColor } from "@/lib/alerts/color.client";
import { preloadRadarFrame } from "@/lib/radar-preload";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { RadarMapProps } from "./RadarMap";
import { RadarControls } from "./RadarControls";
import { RadarLegend } from "./RadarLegend";
import { RadarTileCrossfade } from "./RadarTileCrossfade";

// Fixed zoom level used for background tile preloading (saved locations,
// the ring around the active one) — independent of whatever zoom the user
// is actually looking at, since it's just meant to warm the HTTP cache
// before they switch there.
const PRELOAD_ZOOM = 7;

const CARTO_DARK = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const CARTO_LIGHT = "https://{s}.basemaps.cartocdn.com/voyager/{z}/{x}/{y}{r}.png";
const CARTO_ATTRIB =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function boundsToBBox(bounds: L.LatLngBounds): BBox {
  return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
}

/** Keeps the map centered on the active location when it changes (search,
 * saved-location click, GPS fix) without fighting the user's own panning. */
function RecenterOnLocationChange({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  const lastRef = useRef<string>("");
  useEffect(() => {
    const key = `${lat},${lon}`;
    if (lastRef.current === key) return;
    lastRef.current = key;
    map.flyTo([lat, lon], Math.max(map.getZoom(), 7), { duration: 0.8 });
  }, [lat, lon, map]);
  return null;
}

function AlertPolygonsLayer({ host }: { host: string }) {
  const map = useMap();
  const [bbox, setBbox] = useState<BBox>(() => boundsToBBox(map.getBounds()));

  useMapEvents({
    moveend: () => {
      const b = map.getBounds();
      // Round so panning by a few pixels doesn't spam refetches.
      setBbox(boundsToBBox(b).map((v) => Math.round(v * 20) / 20) as BBox);
    },
  });

  const { data } = useQuery({
    queryKey: ["librewxr-alerts", host, ...bbox],
    queryFn: () => fetchLibreWxrAlerts(host, bbox),
    refetchInterval: 5 * 60_000,
  });

  const alerts = (data ?? []).filter((a) => a.geometry);
  const featureKey = alerts.map((a) => a.id).join(",");

  if (!alerts.length) return null;

  const featureCollection: FeatureCollection = {
    type: "FeatureCollection",
    features: alerts.map(
      (a): Feature => ({
        type: "Feature",
        // GeoJSON typing wants a real geometry union; alert geometries are
        // sourced from LibreWXR's own GeoJSON responses so this cast is safe.
        geometry: a.geometry as Feature["geometry"],
        properties: { id: a.id, event: a.displayEvent, description: a.description, cssClass: a.cssClass, url: a.url },
      }),
    ),
  };

  return (
    <GeoJSON
      key={featureKey}
      data={featureCollection}
      style={(feature) => {
        const color = resolveAlertColor(feature?.properties?.cssClass ?? "alert-unknown");
        return { color, weight: 1.5, fillColor: color, fillOpacity: 0.18 };
      }}
      onEachFeature={(feature, layer) => {
        const p = feature.properties ?? {};
        const desc = p.description ? `<p style="margin-top:6px;opacity:.85;">${escapeHtml(String(p.description)).slice(0, 280)}${String(p.description).length > 280 ? "…" : ""}</p>` : "";
        layer.bindPopup(
          `<div style="font-family:var(--mono);min-width:180px;">
            <strong style="text-transform:uppercase;letter-spacing:.05em;font-size:.8rem;">${escapeHtml(String(p.event ?? "Alert"))}</strong>
            ${desc}
          </div>`,
          // autoPan is on by default, which pans the map to keep the popup in
          // view — for a polygon near the edge of the current view (i.e. not
          // near the active location) that pan fires a `moveend`, which the
          // bbox-alerts query above is subscribed to, causing an unwanted
          // "the radar just refreshed" refetch/flicker on simple clicks.
          { autoPan: false },
        );
      }}
    />
  );
}

export function LeafletRadarMap({ lat, lon, label, libreWxrHost, theme, preloadLocations }: RadarMapProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [colorScheme, setColorScheme] = useState(1);
  const [showArrows, setShowArrows] = useState(false);
  const [showCells, setShowCells] = useState(false);

  const { data: weatherMaps } = useQuery({
    queryKey: ["librewxr-weather-maps", libreWxrHost],
    queryFn: () => fetchWeatherMaps(libreWxrHost),
    // LibreWXR's own tiles are cached at the edge for 5 minutes, but new
    // nowcast frames land roughly every 10 minutes — poll faster than
    // either so a new frame shows up within ~2 minutes of being available.
    refetchInterval: 2 * 60_000,
    refetchIntervalInBackground: true,
  });

  const frames: LibreWxrFrame[] = useMemo(() => {
    if (!weatherMaps) return [];
    return [...weatherMaps.radar.past, ...weatherMaps.radar.nowcast];
  }, [weatherMaps]);
  const nowcastStartIndex = weatherMaps?.radar.past.length ?? 0;
  const latestObservedIndex = Math.max(nowcastStartIndex - 1, 0);
  const isLive = frames.length > 0 && selectedIndex === latestObservedIndex;

  // Keeps the view "live": as long as the user hasn't manually scrubbed
  // away from the latest observed frame, jump to the new latest frame
  // whenever a fresh one arrives (detected by timestamp, since LibreWXR
  // keeps a fixed-size rolling window — the frame *count* doesn't change
  // when an old one ages out and a new one is appended).
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;
  const latestFrameTime = weatherMaps?.radar.past.at(-1)?.time;
  const prevLatestRef = useRef<{ time: number; index: number } | null>(null);
  useEffect(() => {
    if (latestFrameTime === undefined) return;
    const prev = prevLatestRef.current;
    const wasTrackingLive = prev === null || selectedIndexRef.current === prev.index;
    if (prev === null || (prev.time !== latestFrameTime && wasTrackingLive)) {
      setSelectedIndex(latestObservedIndex);
    }
    prevLatestRef.current = { time: latestFrameTime, index: latestObservedIndex };
  }, [latestFrameTime, latestObservedIndex]);

  useEffect(() => {
    if (!isPlaying || frames.length < 2) return;
    const id = setInterval(() => {
      setSelectedIndex((i) => (i + 1) % frames.length);
    }, 800);
    return () => clearInterval(id);
  }, [isPlaying, frames.length]);

  const currentFrame = frames[selectedIndex];
  const tileOpts = useMemo(
    () => ({
      color: colorScheme,
      arrows: showArrows ? (theme === "light" ? ("dark" as const) : ("light" as const)) : null,
      cells: showCells ? (theme === "light" ? ("dark" as const) : ("light" as const)) : null,
    }),
    [colorScheme, showArrows, showCells, theme],
  );
  const radarUrl = useMemo(() => {
    if (!currentFrame) return null;
    return radarTileUrl(libreWxrHost, currentFrame.path, tileOpts);
  }, [currentFrame, libreWxrHost, tileOpts]);
  // Coalesces rapid scrubber drags into one tile request per pause instead
  // of one per intermediate frame — the slider/time label above still track
  // `selectedIndex` immediately, only the actual tile fetch is debounced.
  const debouncedRadarUrl = useDebouncedValue(radarUrl, 90);

  // Preload background: the ring around the active location (so panning
  // near "home" is instant) plus the very next frame in the timeline (so
  // stepping forward/playing rarely has to wait on the network), and a
  // light preload of every saved location's current frame (so switching
  // between saved locations doesn't start from a blank map either).
  useEffect(() => {
    if (!currentFrame) return;
    preloadRadarFrame(libreWxrHost, currentFrame.path, lat, lon, tileOpts, PRELOAD_ZOOM, 2);
    const next = frames[selectedIndex + 1];
    if (next) preloadRadarFrame(libreWxrHost, next.path, lat, lon, tileOpts, PRELOAD_ZOOM, 1);
  }, [currentFrame, frames, selectedIndex, lat, lon, libreWxrHost, tileOpts]);

  useEffect(() => {
    if (!currentFrame || !preloadLocations?.length) return;
    for (const loc of preloadLocations.slice(0, 12)) {
      preloadRadarFrame(libreWxrHost, currentFrame.path, loc.lat, loc.lon, tileOpts, PRELOAD_ZOOM, 1);
    }
  }, [currentFrame, preloadLocations, libreWxrHost, tileOpts]);

  const locationIcon = useMemo(
    () =>
      L.divIcon({
        className: "",
        html: `<div style="width:14px;height:14px;border-radius:50%;background:rgb(var(--a0));box-shadow:0 0 0 4px rgba(var(--a0),0.25),0 0 14px rgba(var(--a0),0.8);"></div>`,
        iconSize: [14, 14],
      }),
    [],
  );

  return (
    <div className="flex h-full w-full flex-col gap-2">
      {/* `isolate` traps Leaflet's own internal z-indices (panes/popups run
          400-700+, controls 1000) inside this box's own stacking context —
          without it, those numbers compete directly against the rest of the
          page's z-index values and render on top of any dialog/modal. */}
      <div className="relative min-h-0 flex-1 isolate overflow-hidden">
        <MapContainer
          center={[lat, lon]}
          zoom={7}
          zoomControl={false}
          className="h-full w-full"
          style={{ background: "var(--bg)" }}
          attributionControl
        >
          <TileLayer url={theme === "light" ? CARTO_LIGHT : CARTO_DARK} attribution={CARTO_ATTRIB} />
          <RadarTileCrossfade url={debouncedRadarUrl} targetOpacity={0.75} zIndex={5} />
          <AlertPolygonsLayer host={libreWxrHost} />
          <Marker position={[lat, lon]} icon={locationIcon} />
          <RecenterOnLocationChange lat={lat} lon={lon} />
        </MapContainer>

        {/* Explicit z-index needed here: this overlay and the map are both
            inside the `isolate`d wrapper above, so — now that Leaflet's own
            panes/popups/controls (z-index 400-1000) are scoped to that local
            stacking context instead of leaking onto the whole page — this
            sibling has to out-rank them explicitly or it renders *under* the
            map despite coming later in the DOM. */}
        <div className="pointer-events-none absolute inset-3 z-[1000] flex items-start justify-between gap-2">
          <div className="glass-card px-3 py-1.5 font-mono text-xs pointer-events-auto" style={{ color: "var(--text2)" }}>
            {label}
          </div>
          <div className="pointer-events-auto flex flex-col items-end gap-2">
            {isLive && (
              <div
                className="glass-card flex items-center gap-1.5 px-2.5 py-1.5 font-mono text-[0.65rem] tracking-wider"
                style={{ color: "var(--danger)" }}
                title="Tracking the latest radar frame — new frames appear automatically."
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: "var(--danger)", boxShadow: "0 0 6px var(--danger)", animation: "pulse 1.6s ease infinite" }}
                />
                LIVE
              </div>
            )}
            <RadarLegend colorScheme={colorScheme} colorSchemes={weatherMaps?.radar.colorSchemes ?? []} />
          </div>
        </div>
      </div>

      {frames.length > 0 && (
        <RadarControls
          frames={frames}
          nowcastStartIndex={nowcastStartIndex}
          selectedIndex={selectedIndex}
          onSelectIndex={setSelectedIndex}
          isPlaying={isPlaying}
          onTogglePlay={() => setIsPlaying((v) => !v)}
          colorSchemes={weatherMaps?.radar.colorSchemes ?? []}
          colorScheme={colorScheme}
          onColorSchemeChange={setColorScheme}
          showArrows={showArrows}
          onToggleArrows={() => setShowArrows((v) => !v)}
          showCells={showCells}
          onToggleCells={() => setShowCells((v) => !v)}
          isLive={isLive}
          onJumpToLive={() => setSelectedIndex(latestObservedIndex)}
        />
      )}
    </div>
  );
}
