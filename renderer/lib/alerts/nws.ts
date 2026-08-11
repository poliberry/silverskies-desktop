import type { AlertGeometry, NormalizedAlert } from "@/types/alerts";
import { alertClass, getDisplayEvent } from "./classify";

interface NwsFeature {
  id: string;
  geometry: AlertGeometry | null;
  properties: {
    event: string;
    headline?: string;
    description?: string;
    instruction?: string;
    severity?: string;
    areaDesc?: string;
    onset?: string;
    sent?: string;
    expires?: string;
    senderName?: string;
  };
}

/** Ported from the original app's fetchNwsAlerts() — same bounding box
 * gate (NWS only covers roughly this range) and endpoint. */
export async function fetchNwsAlerts(lat: number, lon: number): Promise<NormalizedAlert[]> {
  if (lat < 15 || lat > 72 || lon < -180 || lon > -60) return [];
  try {
    const r = await fetch(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, {
      headers: { Accept: "application/geo+json" },
    });
    if (!r.ok) return [];
    const d = await r.json();
    const features: NwsFeature[] = d.features ?? [];
    return features.map((f): NormalizedAlert => {
      const p = f.properties;
      const cls = alertClass(p.event, p.severity, p.headline, p.description);
      return {
        id: `nws:${f.id}`,
        source: "nws",
        event: p.event,
        displayEvent: getDisplayEvent(p.event, cls),
        cssClass: cls,
        headline: p.headline,
        description: p.description,
        instruction: p.instruction,
        severity: p.severity,
        areaDesc: p.areaDesc,
        onset: p.onset,
        sent: p.sent ?? p.onset,
        expires: p.expires,
        issuingOffice: p.senderName,
        url: f.id,
        geometry: f.geometry,
      };
    });
  } catch {
    return [];
  }
}
