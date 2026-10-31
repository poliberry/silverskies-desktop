export interface RadarStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  elevationM: number | null;
  /** Parsed numeric Volume Coverage Pattern (e.g. 35 from "R35"). */
  vcp: number | null;
  operabilityStatus: string | null;
  alarmSummary: string | null;
  /** ISO timestamp of the most recently received Level II data — the
   * closest real signal to "when did this radar last actually scan." */
  lastReceivedTime: string | null;
}

export interface RadarProductDef {
  /** WMS layer-name suffix, e.g. "sr_bref" → "{site}:{site}_sr_bref". */
  id: string;
  label: string;
  /** WMS style name registered for this product on the NCEP GeoServer. */
  styleName: string;
  description: string;
}
