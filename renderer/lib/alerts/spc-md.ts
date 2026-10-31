import type { AlertGeometry, NormalizedAlert } from "@/types/alerts";
import type { BBox } from "./librewxr";
import { getDisplayEvent } from "./classify";

const MAPSERVER_QUERY_URL =
  "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/spc_mesoscale_discussion/MapServer/0/query";
// SPC's Mesoscale Discussion text products are oddly filed under the NWS
// Products API's "location" facet as the sub-product code "MCD" rather than
// an office id (confirmed by cross-referencing MD numbers between this and
// the MapServer's polygons — KWNS/SPC alone return nothing for this type).
const PRODUCTS_LIST_URL = "https://api.weather.gov/products?type=SWO&location=MCD&limit=15";
const USER_AGENT_HEADERS = { Accept: "application/ld+json" };

interface MdProperties {
  objectid: number;
  name: string; // e.g. "MD 1939"
  folderpath: string; // e.g. "MD 1939 Active Till 0215 UTC"
  popupinfo: string; // link to the full text page on spc.noaa.gov
  idp_filedate: number; // epoch ms issue time
}

interface MdFeature {
  type: "Feature";
  properties: MdProperties;
  geometry: AlertGeometry;
}

function mdNumber(name: string): number | null {
  const m = name.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/** The MapServer's `folderpath` only carries an "Active Till HH:MM UTC"
 * time, no date — reconstruct a full timestamp from the issue time, rolling
 * over to the next day if the expiry clock time is earlier (i.e. it crosses
 * midnight UTC). */
function computeExpiry(issuedMs: number, folderpath: string): string | undefined {
  const m = folderpath.match(/Till (\d{2})(\d{2}) UTC/);
  if (!m) return undefined;
  const issued = new Date(issuedMs);
  const expiry = new Date(
    Date.UTC(issued.getUTCFullYear(), issued.getUTCMonth(), issued.getUTCDate(), parseInt(m[1], 10), parseInt(m[2], 10), 0),
  );
  if (expiry.getTime() <= issuedMs) expiry.setUTCDate(expiry.getUTCDate() + 1);
  return expiry.toISOString();
}

async function fetchMdTexts(): Promise<Map<number, string>> {
  const byNumber = new Map<number, string>();
  try {
    const listRes = await fetch(PRODUCTS_LIST_URL, { headers: USER_AGENT_HEADERS });
    if (!listRes.ok) return byNumber;
    const listData = await listRes.json();
    const ids: string[] = (listData["@graph"] ?? []).map((p: { "@id": string }) => p["@id"]);
    const products = await Promise.all(
      ids.map(async (id) => {
        try {
          const r = await fetch(id, { headers: USER_AGENT_HEADERS });
          if (!r.ok) return null;
          return (await r.json()) as { productText?: string };
        } catch {
          return null;
        }
      }),
    );
    for (const p of products) {
      const text = p?.productText;
      if (!text) continue;
      const m = text.match(/Mesoscale Discussion (\d+)/i);
      if (m) byNumber.set(parseInt(m[1], 10), text);
    }
  } catch {
    // Best-effort — missing text just falls back to the SPC link below.
  }
  return byNumber;
}

/**
 * SPC Mesoscale Discussions: forecaster situational-awareness products that
 * often precede a severe thunderstorm/tornado watch. They don't appear in
 * NWS's `/alerts/active` CAP feed at all (they're narrative discussions, not
 * alerts), so this pulls polygon geometry from SPC's public ArcGIS layer and
 * cross-references the full discussion text from the NWS Products API by MD
 * number (there's no direct link between the two APIs otherwise).
 */
export async function fetchSpcMdAlerts(bbox: BBox): Promise<NormalizedAlert[]> {
  try {
    const [w, s, e, n] = bbox;
    const geomUrl = `${MAPSERVER_QUERY_URL}?geometry=${w},${s},${e},${n}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&f=geojson`;
    const geoRes = await fetch(geomUrl);
    if (!geoRes.ok) return [];
    const geo = await geoRes.json();
    const features: MdFeature[] = geo.features ?? [];
    if (!features.length) return [];

    const texts = await fetchMdTexts();

    return features.map((f): NormalizedAlert => {
      const num = mdNumber(f.properties.name);
      const text = num !== null ? texts.get(num) : undefined;
      const areaMatch = text?.match(/Areas affected\.\.\.(.+)/i);
      const summaryMatch = text?.match(/SUMMARY\.\.\.([\s\S]+?)\n\n/i);
      const issued = new Date(f.properties.idp_filedate).toISOString();
      const event = `Mesoscale Discussion ${num ?? f.properties.objectid}`;
      const cls = "alert-mesoscale-discussion";

      return {
        id: `spc-md:${f.properties.objectid}`,
        source: "spc",
        event,
        displayEvent: getDisplayEvent(event, cls),
        cssClass: cls,
        headline: f.properties.name,
        description: (summaryMatch?.[1] ?? text)?.replace(/\s+/g, " ").trim(),
        severity: "Moderate",
        areaDesc: areaMatch?.[1]?.trim(),
        onset: issued,
        sent: issued,
        expires: computeExpiry(f.properties.idp_filedate, f.properties.folderpath),
        issuingOffice: "NWS Storm Prediction Center",
        url: f.properties.popupinfo,
        geometry: f.geometry,
      };
    });
  } catch {
    return [];
  }
}
