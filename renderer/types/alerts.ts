export type AlertSource = "nws" | "eccc" | "librewxr" | "bom" | "spc";

/** GeoJSON-ish geometry, loosely typed so we don't need a full @types/geojson
 * dependency just for the map polygon layer. */
export interface AlertGeometry {
  type: string;
  coordinates: unknown;
}

export interface NormalizedAlert {
  /** Stable de-dupe key: source + event + onset + area. */
  id: string;
  source: AlertSource;
  event: string;
  displayEvent: string;
  cssClass: string;
  headline?: string;
  description?: string;
  instruction?: string;
  severity?: string;
  areaDesc?: string;
  onset?: string;
  /** When the product was issued — distinct from `onset` (when the hazard
   * itself begins, which can be later for a Watch). Falls back to `onset`
   * for sources that don't distinguish the two. */
  sent?: string;
  expires?: string;
  /** e.g. "NWS Tucson AZ" — who issued it, when the source provides one. */
  issuingOffice?: string;
  url?: string;
  geometry?: AlertGeometry | null;
  /** Zone-boundary API URLs — see nws.ts. Used to synthesize a polygon for
   * zone-based products whose `geometry` comes back null. */
  affectedZones?: string[];
  /** Raw VTEC string (e.g. "/O.NEW.KOUN.SV.W.0045.240101T0000Z-240101T0100Z/")
   * — NWS-specific, absent for every other source. Lets the in-app browser
   * open the alert on IEM's VTEC event browser instead of the raw CAP API
   * URL in `url` — see lib/browser/external-links.ts's iemAlertUrl. */
  vtec?: string;
}
