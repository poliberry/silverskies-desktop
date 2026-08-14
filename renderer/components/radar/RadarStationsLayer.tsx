"use client";

import { useMemo } from "react";
import { Marker, Popup } from "react-leaflet";
import L from "leaflet";
import { useRadarStations } from "@/hooks/useRadarStations";
import { nwsRadarStationUrl } from "@/lib/browser/external-links";
import { ipc } from "@/lib/ipc-client";

export interface RadarStationsLayerProps {
  onSelect: (stationId: string) => void;
}

function stationIcon(stationId: string, alarm: boolean): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div class="radar-station-marker${alarm ? " alarm" : ""}">${stationId}</div>`,
    iconSize: [50, 18],
    iconAnchor: [25, 9],
  });
}

/** All WSR-88D station markers — clicking one swaps the radar map's own
 * layer to that site's WMS product (see LeafletRadarMap.tsx). Memoized on
 * the station list (not the map's own re-renders, e.g. from playback
 * scrubbing) since building ~159 divIcons on every unrelated render would
 * be wasteful. */
export function RadarStationsLayer({ onSelect }: RadarStationsLayerProps) {
  const { data } = useRadarStations(true);

  const markers = useMemo(
    () =>
      (data ?? []).map((s) => {
        const alarm = Boolean(s.alarmSummary && s.alarmSummary !== "No Alarms");
        return (
          <Marker
            key={s.id}
            position={[s.lat, s.lon]}
            icon={stationIcon(s.id, alarm)}
            eventHandlers={{ click: () => onSelect(s.id) }}
          >
            <Popup>
              <button
                type="button"
                className="unit-btn"
                onClick={() => void ipc.windows.openBrowser({ url: nwsRadarStationUrl(s.id), title: `${s.id} — NWS Radar` })}
              >
                View Station Info ↗
              </button>
            </Popup>
          </Marker>
        );
      }),
    [data, onSelect],
  );

  return <>{markers}</>;
}
