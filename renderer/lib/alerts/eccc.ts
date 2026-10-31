import type { NormalizedAlert } from "@/types/alerts";
import { ecccAlertClass, getDisplayEvent } from "./classify";

/** Rough bounding rectangle for Canada — not the real border (also covers
 * WY/MT/ID/MN/MI/NY/ME, etc.), so this is only used to decide whether it's
 * worth *also* querying ECCC alongside NWS, never to pick one exclusively.
 * ECCC's own API filters by real alert-zone polygons, so a point outside
 * its actual coverage just comes back empty. */
export function isCanada(lat: number, lon: number): boolean {
  return lat >= 41.7 && lat <= 83.1 && lon >= -141.0 && lon <= -52.6;
}

interface EcccFeature {
  properties: {
    alert_name_en?: string;
    alert_short_name_en?: string;
    alert_text_en?: string;
    validity_datetime?: string;
    expiration_datetime?: string;
    impact_en?: string;
    risk_colour_en?: string;
  };
}

/** Ported from the original app's fetchEcccAlerts() — queries Environment
 * Canada's GeoMet OGC API with a point-intersects filter. */
export async function fetchEcccAlerts(lat: number, lon: number): Promise<NormalizedAlert[]> {
  const filter = `INTERSECTS(geometry,POINT(${lon} ${lat}))`;
  const url = `https://api.weather.gc.ca/collections/weather-alerts/items?filter=${encodeURIComponent(filter)}&lang=en&f=json&limit=30`;
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return [];
    const data = await r.json();
    const features: EcccFeature[] = data.features ?? [];
    return features.map((f, i): NormalizedAlert => {
      const p = f.properties;
      const colour = (p.risk_colour_en ?? "").toLowerCase();
      const event = p.alert_name_en || p.alert_short_name_en || "Weather Alert";
      const cls = ecccAlertClass(colour);
      return {
        id: `eccc:${event}:${p.validity_datetime ?? i}`,
        source: "eccc",
        event,
        displayEvent: getDisplayEvent(event, cls),
        cssClass: cls,
        headline: p.alert_name_en,
        description: p.alert_text_en,
        severity: p.impact_en || "Unknown",
        onset: p.validity_datetime,
        sent: p.validity_datetime,
        expires: p.expiration_datetime,
        issuingOffice: "ECCC",
        geometry: null,
      };
    });
  } catch {
    return [];
  }
}
