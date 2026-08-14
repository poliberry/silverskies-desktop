"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, WMSTileLayer, Marker, GeoJSON, SVGOverlay, Rectangle, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import type { Feature, FeatureCollection } from "geojson";
import { useQuery } from "@tanstack/react-query";
import {
  fetchWeatherMaps,
  fetchLibreWxrAlerts,
  radarTileUrl,
  type BBox,
  type LibreWxrFrame,
} from "@/lib/alerts/librewxr";
import { fetchSpcMdAlerts } from "@/lib/alerts/spc-md";
import { fetchMergedAlerts, dedupeKey } from "@/lib/alerts/merge";
import { fillMissingGeometry } from "@/lib/alerts/zone-geometry";
import { resolveAlertColorWithOverrides } from "@/lib/alerts/color.client";
import { preloadRadarFrame } from "@/lib/radar-preload";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useSpcOutlook } from "@/hooks/useSpcOutlook";
import { useSettings } from "@/hooks/useSettings";
import { useRadarStations } from "@/hooks/useRadarStations";
import { openMeteoProvider } from "@/lib/providers/open-meteo";
import { RADAR_PRODUCTS, stationLayerName, stationWmsUrl } from "@/lib/radar-station-products";
import type { RadarMapProps } from "./RadarMap";
import { RadarControls } from "./RadarControls";
import { RadarPlaybackBar } from "./RadarPlaybackBar";
import { RadarLegend } from "./RadarLegend";
import { RadarTileCrossfade } from "./RadarTileCrossfade";
import { WeatherTileOverlay } from "./overlays/WeatherTileOverlay";
import { AqiBadge } from "./overlays/AqiBadge";
import { RadarStationsLayer } from "./RadarStationsLayer";
import { StationInfoPanel } from "./StationInfoPanel";
import { CARTO_DARK, CARTO_LIGHT, CARTO_ATTRIB } from "@/lib/basemap-tiles";

// Fixed zoom level used for background tile preloading (saved locations,
// the ring around the active one) — independent of whatever zoom the user
// is actually looking at, since it's just meant to warm the HTTP cache
// before they switch there.
const PRELOAD_ZOOM = 7;

// Roughly matches typical NEXRAD volume-scan cadence, so a selected
// station's image doesn't visibly go stale while it's left open.
const STATION_IMAGE_REFRESH_MS = 2 * 60_000;

// The classic WSR-88D "short range" coverage (124 nautical miles) — this is
// the actual real-world diameter both the sweep and the boundary ring below
// are sized to; the WMS image itself only ever paints real data, so nothing
// outside the radar's actual range shows regardless of this ring.
const STATION_RANGE_METERS = 229_664;
// Meters-per-degree of latitude is ~constant; longitude isn't (it shrinks
// toward the poles), so the box has to be corrected by cos(latitude) to
// stay square in real-world meters — otherwise the circle drawn inside it
// would come out visibly egg-shaped away from the equator.
const METERS_PER_DEGREE_LAT = 111_320;

function stationRangeBounds(lat: number, lon: number, radiusMeters: number): LatLngBoundsExpression {
  const dLat = radiusMeters / METERS_PER_DEGREE_LAT;
  const dLon = radiusMeters / (METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180));
  return [
    [lat - dLat, lon - dLon],
    [lat + dLat, lon + dLon],
  ];
}

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

/** Leaflet caches its container's pixel size at init time and never re-reads
 * it on its own — a flex-driven resize (e.g. the radar's own container
 * growing to fill the column when the audit log pops out, or shrinking back
 * when it redocks) doesn't fire a window `resize` event, so without this the
 * map keeps rendering tiles/controls sized to whatever the container
 * happened to be when it first became visible, leaving the newly revealed
 * area blank until something else (a manual window resize) forces a
 * recalculation. */
function InvalidateSizeOnResize() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);
  return null;
}

const MIN_SELECTION_DRAG_PX = 8;

/** Feeds the parent's `onBoundsChange` — the audit log's alerts query — with
 * whatever bbox should currently drive it: a user's shift-drag rectangle
 * selection when one is active, otherwise the map's own viewport. Also owns
 * the shift+drag gesture itself and the persistent/live selection rectangle
 * overlays.
 *
 * Shift+drag is repurposed from Leaflet's default `boxZoom` behavior (zoom
 * to the dragged rectangle) — see `boxZoom={false}` on MapContainer below —
 * so the same gesture now draws a selection instead. `map.dragging` is
 * suspended for the duration of the drag so it doesn't also pan the map. A
 * plain click (no shift) or the Escape key clears an active selection; so
 * does a fresh shift-drag (replacing it) or the active location changing
 * (an old box drawn over a previous search shouldn't keep silently
 * filtering the log after a new one). */
function AlertsBoundsController({
  lat,
  lon,
  onBoundsChange,
}: {
  lat: number;
  lon: number;
  onBoundsChange?: (bbox: BBox) => void;
}) {
  const map = useMap();
  const [viewportBbox, setViewportBbox] = useState<BBox>(() => boundsToBBox(map.getBounds()));
  const [selection, setSelection] = useState<L.LatLngBounds | null>(null);
  const [dragStart, setDragStart] = useState<L.LatLng | null>(null);
  const [dragCurrent, setDragCurrent] = useState<L.LatLng | null>(null);

  useEffect(() => setSelection(null), [lat, lon]);

  // Escape clears an active selection (or cancels one still mid-drag)
  // regardless of whether the map itself has focus — the same global-ish
  // reach as the "×" close on any of this app's own dialogs.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (dragStart) {
        map.dragging.enable();
        setDragStart(null);
        setDragCurrent(null);
      }
      setSelection(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [map, dragStart]);

  useMapEvents({
    moveend: () => {
      // Round so panning by a few pixels doesn't spam refetches — same
      // tolerance AlertPolygonsLayer's own bbox tracking uses.
      setViewportBbox(boundsToBBox(map.getBounds()).map((v) => Math.round(v * 20) / 20) as BBox);
    },
    mousedown: (e) => {
      if (!e.originalEvent.shiftKey) return;
      map.dragging.disable();
      setSelection(null);
      setDragStart(e.latlng);
      setDragCurrent(e.latlng);
    },
    mousemove: (e) => {
      if (!dragStart) return;
      setDragCurrent(e.latlng);
    },
    mouseup: (e) => {
      if (!dragStart) return;
      map.dragging.enable();
      const bounds = L.latLngBounds(dragStart, e.latlng);
      const sw = map.latLngToContainerPoint(bounds.getSouthWest());
      const ne = map.latLngToContainerPoint(bounds.getNorthEast());
      setDragStart(null);
      setDragCurrent(null);
      // A shift+click with no real drag shouldn't "select" a zero-size box.
      if (Math.abs(sw.x - ne.x) < MIN_SELECTION_DRAG_PX || Math.abs(sw.y - ne.y) < MIN_SELECTION_DRAG_PX) return;
      setSelection(bounds);
    },
    click: (e) => {
      if (!e.originalEvent.shiftKey && selection) setSelection(null);
    },
  });

  const effectiveBbox = selection ? boundsToBBox(selection) : viewportBbox;
  useEffect(() => {
    onBoundsChange?.(effectiveBbox);
    // `effectiveBbox` is a fresh array/tuple every render — keying off its
    // joined string instead avoids re-firing (and the parent state update
    // that would trigger) on every render that doesn't actually change it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBbox.join(",")]);

  const dragBounds = dragStart && dragCurrent ? L.latLngBounds(dragStart, dragCurrent) : null;

  return (
    <>
      {dragBounds && (
        <Rectangle
          bounds={dragBounds}
          pathOptions={{ color: "#ffffff", weight: 1, dashArray: "4 4", fillOpacity: 0.08 }}
          interactive={false}
        />
      )}
      {selection && !dragBounds && (
        <Rectangle
          bounds={selection}
          pathOptions={{ color: "#ffffff", weight: 1.5, dashArray: "6 4", fillOpacity: 0.05 }}
          interactive={false}
        />
      )}
    </>
  );
}

/** Flies to a newly-selected station once (not on every re-render while it
 * stays selected, e.g. a metadata refetch) so the station is actually in
 * view without the user having to pan there manually. */
function FlyToStation({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  const lastRef = useRef<string>("");
  useEffect(() => {
    const key = `${lat},${lon}`;
    if (lastRef.current === key) return;
    lastRef.current = key;
    map.flyTo([lat, lon], 7, { duration: 0.8 });
  }, [lat, lon, map]);
  return null;
}

/**
 * A white boundary ring at the radar's real range plus a decorative sweep
 * filling that same circle — both drawn as one SVGOverlay bound to real
 * lat/lon (not fixed pixels), so panning/zooming moves and rescales them
 * exactly like any other geographic feature, always at the radar's true
 * physical size regardless of zoom level. The sweep's own rotation is still
 * purely decorative (no free feed exposes the antenna's actual azimuth) —
 * reuses the existing `.radar-sweep` conic-gradient/animation via a
 * `foreignObject` so it doesn't need reimplementing as raw SVG path math.
 */
function StationRangeOverlay({ lat, lon }: { lat: number; lon: number }) {
  const bounds = useMemo(() => stationRangeBounds(lat, lon, STATION_RANGE_METERS), [lat, lon]);
  return (
    <SVGOverlay bounds={bounds} attributes={{ viewBox: "0 0 100 100" }} interactive={false}>
      <circle cx={50} cy={50} r={49} fill="none" stroke="#ffffff" strokeWidth={0.5} opacity={0.85} />
      <foreignObject x={1} y={1} width={98} height={98}>
        {/* No xmlns attribute needed here — this div is created through
            React's own createElement (already HTML-namespaced) and
            portaled in via SVGOverlay, not parsed from a raw HTML/SVG
            string, which is the only case that attribute actually matters
            for. */}
        <div className="radar-sweep" />
      </foreignObject>
    </SVGOverlay>
  );
}

function AlertPolygonsLayer({ host }: { host: string }) {
  const map = useMap();
  const [bbox, setBbox] = useState<BBox>(() => boundsToBBox(map.getBounds()));
  const { config } = useSettings();
  const willyWeatherApiKey = config?.willyWeatherApiKey ?? null;
  const overrides = config?.alertTypeOverrides;

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

  // SPC Mesoscale Discussions aren't part of LibreWXR's CAP feed at all
  // (they're forecaster discussions, not alerts) — fetched separately and
  // merged into the same polygon layer. The query just comes back empty
  // outside CONUS, so no extra US-coverage gate is needed here.
  const { data: mdData } = useQuery({
    queryKey: ["spc-md-alerts", ...bbox],
    queryFn: () => fetchSpcMdAlerts(bbox),
    refetchInterval: 5 * 60_000,
  });

  // The two queries above are viewport/bbox-scoped and only ever see
  // whatever LibreWXR's relay has resolved. That relay can lag or miss
  // alerts the authoritative NWS/ECCC/BOM feeds already have (the same
  // feeds the audit log uses via fetchMergedAlerts) — fetching the same
  // merged result here, keyed off the bbox's own center point, guarantees
  // whatever's showing in the audit log for the area on screen also shows
  // up as a polygon, without giving up the bbox queries' "see alerts
  // anywhere I pan" behavior.
  const centerLat = (bbox[1] + bbox[3]) / 2;
  const centerLon = (bbox[0] + bbox[2]) / 2;
  const { data: mergedData } = useQuery({
    queryKey: ["merged-map-alerts", centerLat, centerLon, host, willyWeatherApiKey],
    queryFn: () => fetchMergedAlerts(centerLat, centerLon, host, willyWeatherApiKey),
    refetchInterval: 5 * 60_000,
  });

  const combined = [...(data ?? []), ...(mdData ?? []), ...(mergedData ?? [])];
  const seen = new Set<string>();
  const deduped = combined.filter((a) => {
    const dk = dedupeKey(a);
    if (seen.has(a.id) || seen.has(dk)) return false;
    seen.add(a.id);
    seen.add(dk);
    return true;
  });

  // Includes geometry-presence and (for still-missing alerts) the affected
  // zone list, not just the id — otherwise an alert whose geometry or
  // affectedZones arrives/changes on a later upstream refetch wouldn't
  // change this key at all, and fillMissingGeometry's cached result would
  // stay stuck on the earlier (missing) geometry for the rest of the
  // session despite staleTime: Infinity being otherwise correct for a
  // truly unchanged set of inputs.
  const withGeometryKey = deduped
    .map((a) => `${a.id}:${a.geometry ? "g" : (a.affectedZones ?? []).join("+")}`)
    .join(",");
  const { data: filled } = useQuery({
    queryKey: ["alert-polygons-filled", withGeometryKey],
    queryFn: () => fillMissingGeometry(deduped),
    enabled: deduped.length > 0,
    // The inputs (deduped) are already the resolved query data above, so
    // there's nothing to periodically refetch here — a new key (different
    // alerts, or an existing alert's geometry/zones changing) is what
    // triggers a re-run.
    staleTime: Infinity,
  });

  const alerts = (filled ?? deduped)
    .filter((a) => a.geometry)
    .filter((a) => overrides?.[a.cssClass]?.visible !== false);
  const featureKey = alerts.map((a) => a.id).join(",");

  if (!alerts.length) return null;

  const featureCollection: FeatureCollection = {
    type: "FeatureCollection",
    features: alerts.map(
      (a): Feature => ({
        type: "Feature",
        // GeoJSON typing wants a real geometry union; alert geometries are
        // sourced from each source's own GeoJSON responses (or synthesized
        // from NWS zone boundaries) so this cast is safe.
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
        const color = resolveAlertColorWithOverrides(feature?.properties?.cssClass ?? "alert-unknown", overrides);
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

const SPC_OUTLOOK_PANE = "spc-outlook-pane";

/** Creates a dedicated pane for the outlook overlay, just under Leaflet's
 * default `overlayPane` (z-index 400, where AlertPolygonsLayer's polygons
 * render) — panes stack by explicit z-index regardless of DOM/mount order,
 * so this reliably keeps the broad, filled outlook polygons from stealing
 * clicks meant for a smaller severe-alert polygon layered on top of them,
 * even though which layer's data resolves (and mounts) first varies with
 * network timing.
 *
 * Deliberately synchronous (called during render, not from an effect):
 * React fires a component's own effects *after* its children's, so if this
 * ran in a useEffect here it could still lose the race against <GeoJSON>'s
 * own mount effect — e.g. when useSpcOutlook already has cached data (map
 * remounted, tab revisited, ...) and <GeoJSON> attaches to the map in the
 * very same commit. Leaflet then tries to render into a pane that doesn't
 * exist yet and throws. `map.createPane` is idempotent (guarded below) and
 * doesn't touch React state, so doing it inline is safe. */
function ensureOutlookPane(map: L.Map) {
  if (map.getPane(SPC_OUTLOOK_PANE)) return;
  const pane = map.createPane(SPC_OUTLOOK_PANE);
  pane.style.zIndex = "399";
}

/**
 * SPC Day 1 Categorical Outlook overlay — outlined in the same style as
 * AlertPolygonsLayer above, colored from each polygon's own official SPC
 * stroke/fill hex (see spc-outlook.ts) rather than resolveAlertColor's
 * `.alert-*` CSS taxonomy, since there's no per-category class for this.
 * Unlike AlertPolygonsLayer, this isn't bbox/viewport-scoped — the whole
 * CONUS layer is only ever a handful of polygons.
 */
function SpcOutlookLayer({ enabled }: { enabled: boolean }) {
  const map = useMap();
  ensureOutlookPane(map);
  const { data } = useSpcOutlook(enabled);
  const outlooks = enabled ? (data ?? []) : [];

  if (!outlooks.length) return null;

  const featureCollection: FeatureCollection = {
    type: "FeatureCollection",
    features: outlooks.map(
      (o): Feature => ({
        type: "Feature",
        geometry: o.geometry as Feature["geometry"],
        properties: { code: o.code, name: o.name, stroke: o.stroke, fill: o.fill },
      }),
    ),
  };

  return (
    <GeoJSON
      // Keyed by code *and* issue time — the outlook only ever reuses the
      // same handful of category codes, so keying on code alone means a
      // refetch that brings back newly issued (re-shaped) polygons for the
      // same categories wouldn't remount the layer: react-leaflet's GeoJSON
      // doesn't diff the `data` prop after mount, so the stale geometry
      // would stick around silently until something else forced a remount.
      key={outlooks.map((o) => `${o.code}:${o.issue}`).join(",")}
      pane={SPC_OUTLOOK_PANE}
      data={featureCollection}
      style={(feature) => ({
        color: feature?.properties?.stroke ?? "#888888",
        weight: 1.5,
        fillColor: feature?.properties?.fill ?? "#888888",
        fillOpacity: 0.18,
      })}
      onEachFeature={(feature, layer) => {
        const p = feature.properties ?? {};
        layer.bindPopup(
          `<div style="font-family:var(--mono);min-width:180px;">
            <strong style="text-transform:uppercase;letter-spacing:.05em;font-size:.8rem;">${escapeHtml(String(p.name ?? "SPC Outlook"))}</strong>
          </div>`,
          { autoPan: false },
        );
      }}
    />
  );
}

export function LeafletRadarMap({
  lat,
  lon,
  label,
  libreWxrHost,
  theme,
  preloadLocations,
  spcOutlookEnabled,
  settings,
  renderSettingsInline = true,
  onBoundsChange,
}: RadarMapProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  // Only relevant when !renderSettingsInline (a pop-out radar window) —
  // starts collapsed so the map gets as much of the window as possible;
  // see the "Playback" toggle strip in the render below.
  const [showPlaybackBar, setShowPlaybackBar] = useState(false);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [stationProductId, setStationProductId] = useState(RADAR_PRODUCTS[0].id);
  // Bumped on a timer to force the station WMSTileLayer to remount and pull
  // a fresh image — GeoServer always serves whatever its latest mosaic is
  // regardless of query params, so a plain re-render wouldn't otherwise ask.
  const [stationRefreshTick, setStationRefreshTick] = useState(0);
  const { colorScheme, showArrows, showCells, showPolygons } = settings;

  // Config (and therefore the OpenWeatherMap key) is app-wide IPC-backed
  // state, not window-scoped — calling useSettings() here directly, rather
  // than threading the key through as its own prop, keeps every radar
  // instance (docked or pop-out) in sync with the same Settings dialog
  // value with no extra plumbing at each call site.
  const { config } = useSettings();
  const owmApiKey = config?.openWeatherMapApiKey ?? null;
  const overlaysAvailable = Boolean(owmApiKey);
  const unit = config?.units ?? "F";

  // Shares the ["radar-stations"] query cache with RadarStationsLayer below
  // — selecting a marker that layer already fetched doesn't trigger a
  // second network call.
  const { data: radarStations } = useRadarStations(Boolean(selectedStationId));
  const selectedStation = useMemo(
    () => radarStations?.find((s) => s.id === selectedStationId) ?? null,
    [radarStations, selectedStationId],
  );
  const stationProduct = RADAR_PRODUCTS.find((p) => p.id === stationProductId) ?? RADAR_PRODUCTS[0];

  const handleSelectStation = useCallback((id: string) => {
    setSelectedStationId((current) => (current === id ? null : id));
  }, []);

  // A station clicked at one location shouldn't silently keep showing once
  // the user has moved on to somewhere else entirely.
  useEffect(() => {
    setSelectedStationId(null);
  }, [lat, lon]);

  useEffect(() => {
    if (!selectedStationId) return;
    const id = setInterval(() => setStationRefreshTick((t) => t + 1), STATION_IMAGE_REFRESH_MS);
    return () => clearInterval(id);
  }, [selectedStationId]);

  const stationWindQuery = useQuery({
    queryKey: ["station-wind", selectedStation?.id],
    queryFn: () => openMeteoProvider.fetchWeather({ lat: selectedStation!.lat, lon: selectedStation!.lon }),
    enabled: Boolean(selectedStation),
    refetchInterval: 5 * 60_000,
  });

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
    // A station's own WMS image doesn't respond to the composite frame
    // index at all — no point ticking it forward in the background (or
    // burning CPU/triggering re-renders) while it's not visible.
    if (!isPlaying || frames.length < 2 || selectedStation) return;
    const id = setInterval(() => {
      setSelectedIndex((i) => (i + 1) % frames.length);
    }, 800);
    return () => clearInterval(id);
  }, [isPlaying, frames.length, selectedStation]);

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
          // Leaflet's default shift+drag draws a zoom-to-rectangle box —
          // disabled so the same gesture can instead draw an alerts region
          // selection (see AlertsBoundsController below).
          boxZoom={false}
          className="h-full w-full"
          style={{ background: "var(--bg)" }}
          attributionControl
        >
          <TileLayer url={theme === "light" ? CARTO_LIGHT : CARTO_DARK} attribution={CARTO_ATTRIB} />
          {/* Selecting a station swaps the general composite radar for that
              station's own real single-site WMS product, directly on this
              same map (docked or pop-out — both render through here) rather
              than in a separate dialog. */}
          {selectedStation ? (
            <WMSTileLayer
              key={`${selectedStation.id}-${stationProduct.id}-${stationRefreshTick}`}
              url={stationWmsUrl(selectedStation.id)}
              layers={stationLayerName(selectedStation.id, stationProduct)}
              styles={stationProduct.styleName}
              format="image/png"
              transparent
              version="1.1.1"
              opacity={0.85}
            />
          ) : (
            <RadarTileCrossfade url={debouncedRadarUrl} targetOpacity={0.75} zIndex={5} />
          )}
          {settings.showWindOverlay && owmApiKey && <WeatherTileOverlay layer="wind_new" apiKey={owmApiKey} zIndex={6} />}
          {settings.showTempOverlay && owmApiKey && <WeatherTileOverlay layer="temp_new" apiKey={owmApiKey} zIndex={7} />}
          {settings.showPrecipOverlay && owmApiKey && (
            <WeatherTileOverlay layer="precipitation_new" apiKey={owmApiKey} zIndex={8} />
          )}
          {showPolygons && <AlertPolygonsLayer host={libreWxrHost} />}
          <SpcOutlookLayer enabled={spcOutlookEnabled} />
          {settings.showRadarStations && <RadarStationsLayer onSelect={handleSelectStation} />}
          <Marker position={[lat, lon]} icon={locationIcon} />
          <RecenterOnLocationChange lat={lat} lon={lon} />
          <InvalidateSizeOnResize />
          <AlertsBoundsController lat={lat} lon={lon} onBoundsChange={onBoundsChange} />
          {selectedStation && (
            <>
              <FlyToStation lat={selectedStation.lat} lon={selectedStation.lon} />
              {/* Keyed on the station id to force a full remount when
                  switching — react-leaflet updates an existing SVGOverlay's
                  `bounds` prop via Leaflet's generic ImageOverlay update
                  path rather than a dedicated reposition call, which isn't
                  reliably repainting the ring/sweep at the new station's
                  location without a fresh layer instance. */}
              <StationRangeOverlay key={selectedStation.id} lat={selectedStation.lat} lon={selectedStation.lon} />
            </>
          )}
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
            {!selectedStation && isLive && (
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
            {settings.showAqiOverlay && owmApiKey && <AqiBadge lat={lat} lon={lon} apiKey={owmApiKey} />}
            {!selectedStation && <RadarLegend colorScheme={colorScheme} colorSchemes={weatherMaps?.radar.colorSchemes ?? []} />}
          </div>
        </div>

        {selectedStation && (
          <div className="pointer-events-none absolute inset-3 z-[1000] flex items-end">
            <div className="pointer-events-auto">
              <StationInfoPanel
                station={selectedStation}
                productId={stationProductId}
                onProductChange={setStationProductId}
                onClose={() => setSelectedStationId(null)}
                wind={stationWindQuery.data}
                windLoading={stationWindQuery.isLoading}
                unit={unit}
              />
            </div>
          </div>
        )}
      </div>

      {frames.length > 0 &&
        (renderSettingsInline ? (
          <RadarControls
            frames={frames}
            nowcastStartIndex={nowcastStartIndex}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
            isPlaying={isPlaying}
            onTogglePlay={() => setIsPlaying((v) => !v)}
            isLive={isLive}
            onJumpToLive={() => setSelectedIndex(latestObservedIndex)}
            colorSchemes={weatherMaps?.radar.colorSchemes ?? []}
            settings={settings}
            overlaysAvailable={overlaysAvailable}
            disabled={Boolean(selectedStation)}
          />
        ) : (
          // Pop-out windows: playback collapses to a slim toggle strip by
          // default (so the map gets as much of the window as possible) and
          // expands in place when clicked — never floats over the map.
          <div className="flex flex-col" style={{ padding: "0 8px" }}>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2"
              style={{ background: "none", border: "none", padding: "4px 0", color: "inherit", cursor: "pointer", font: "inherit" }}
              onClick={() => setShowPlaybackBar((v) => !v)}
              aria-expanded={showPlaybackBar}
            >
              <span className="flex items-center gap-1.5 font-mono" style={{ fontSize: "0.7rem", color: "var(--text3)" }}>
                <i className="ph ph-clock-counter-clockwise" aria-hidden="true" />
                Playback
                {!selectedStation && isLive && (
                  <span style={{ color: "var(--danger)" }} className="tracking-wider">
                    · LIVE
                  </span>
                )}
              </span>
              <i className={`ph ph-caret-${showPlaybackBar ? "down" : "up"}`} aria-hidden="true" style={{ fontSize: "0.7rem" }} />
            </button>
            {showPlaybackBar && (
              <div style={{ paddingTop: 6 }}>
                <RadarPlaybackBar
                  frames={frames}
                  nowcastStartIndex={nowcastStartIndex}
                  selectedIndex={selectedIndex}
                  onSelectIndex={setSelectedIndex}
                  isPlaying={isPlaying}
                  onTogglePlay={() => setIsPlaying((v) => !v)}
                  isLive={isLive}
                  onJumpToLive={() => setSelectedIndex(latestObservedIndex)}
                  disabled={Boolean(selectedStation)}
                />
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
