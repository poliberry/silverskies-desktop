import type { NormalizedAlert } from "@/types/alerts";

/** Direct NWS radar-station viewer — no IEM involved, per the confirmed
 * routing (radar stations and SPC both link straight to their NWS source;
 * only NWS alerts route through IEM — see iemAlertUrl below). */
export function nwsRadarStationUrl(stationId: string): string {
  return `https://radar.weather.gov/station/${stationId}/standard`;
}

interface ParsedVtec {
  wfo: string;
  phenomena: string;
  significance: string;
  eventId: number;
  periodStart: string;
  periodEnd: string;
}

/** Parses a raw NWS VTEC string, e.g.
 * `/O.NEW.KOUN.SV.W.0045.240101T0000Z-240101T0100Z/`, into the fields IEM's
 * VTEC event browser needs. */
function parseVtec(vtec: string): ParsedVtec | null {
  const parts = vtec.trim().replace(/^\/+|\/+$/g, "").split(".");
  if (parts.length < 7) return null;
  const [, , wfo, phenomena, significance, etn, period] = parts;
  const eventId = Number.parseInt(etn, 10);
  const [periodStart, periodEnd] = period.split("-");
  if (!wfo || !phenomena || !significance || Number.isNaN(eventId) || !periodStart) return null;
  return { wfo, phenomena, significance, eventId, periodStart, periodEnd: periodEnd ?? periodStart };
}

/** A VTEC segment's begin timestamp is "000000T0000Z" (a placeholder, not a
 * real date) for most actions other than a fresh "NEW" — CON/EXT/EXP/COR
 * all leave it zeroed since the event's real start was already established
 * by the original NEW. Returns null for that placeholder so the caller
 * falls through to a real date instead of reporting the year 2000. */
function yearFromVtecTimestamp(ts: string | undefined): number | null {
  if (!ts || ts.startsWith("000000")) return null;
  const y = Number.parseInt(ts.slice(0, 2), 10);
  return Number.isNaN(y) ? null : 2000 + y;
}

/** IEM's VTEC event browser — the confirmed current (post Nov-2024 redesign)
 * URL format for viewing one specific NWS warning/watch/advisory. `year`
 * isn't reliably recoverable from the VTEC string alone (see
 * yearFromVtecTimestamp above, true for the common CON/EXT/EXP case, not
 * just a rare edge case), so a `referenceDate` — the alert's own
 * `sent`/`onset` — is the primary source for it, falling back to the VTEC
 * segment's own timestamps only if no reference date is available. Returns
 * null when nothing usable comes out of any of that, so the caller can fall
 * back to `alert.url`. */
export function iemAlertUrl(vtec: string, referenceDate?: string | Date | null): string | null {
  const parsed = parseVtec(vtec);
  if (!parsed) return null;

  const refYear = referenceDate ? new Date(referenceDate).getFullYear() : NaN;
  const year =
    (!Number.isNaN(refYear) && refYear) ||
    yearFromVtecTimestamp(parsed.periodStart) ||
    yearFromVtecTimestamp(parsed.periodEnd);
  if (!year) return null;

  const params = new URLSearchParams({
    year: String(year),
    wfo: parsed.wfo,
    phenomena: parsed.phenomena,
    significance: parsed.significance,
    eventid: String(parsed.eventId),
    tab: "info",
  });
  return `https://mesonet.agron.iastate.edu/vtec/?${params.toString()}`;
}

const NWS_ALERTS_PREFIX = "https://api.weather.gov/alerts/";

/** Recovers a VTEC string for an alert that doesn't already carry one —
 * true for every `librewxr`-sourced alert (the bbox-based feed the audit
 * log actually uses most of the time), even when the underlying alert is
 * itself NWS-originated. LibreWXR's own `uri` field turns out to be the
 * exact same CAP `<identifier>` NWS's own API uses (confirmed by fetching
 * `https://api.weather.gov/alerts/{that identifier}` directly and getting
 * the matching alert back, VTEC included) — so this just re-fetches the
 * real NWS alert by that identifier and pulls VTEC out of it. Returns null
 * (not a throw) for anything that isn't a resolvable NWS identifier at all
 * (a bare "urn:oid:..." only ever means something to api.weather.gov) or
 * that fails for any reason (offline, 404, a non-US alert, …). */
async function fetchVtecForAlert(rawUrl: string | undefined): Promise<string | null> {
  if (!rawUrl) return null;
  const identifier = rawUrl.startsWith("urn:")
    ? rawUrl
    : rawUrl.startsWith(NWS_ALERTS_PREFIX)
      ? rawUrl.slice(NWS_ALERTS_PREFIX.length)
      : null;
  if (!identifier) return null;
  try {
    const r = await fetch(`${NWS_ALERTS_PREFIX}${identifier}`, { headers: { Accept: "application/geo+json" } });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.properties?.parameters?.VTEC?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Resolves the best URL to open for an alert's "SOURCE" link: IEM's VTEC
 * event browser when a VTEC is available — either already on the alert (the
 * `nws` source populates it eagerly) or recovered on demand (see
 * fetchVtecForAlert above) — falling back to `alert.url` only when that's
 * an actual fetchable http(s) link, since a bare "urn:oid:..." CAP
 * identifier (what `librewxr`/WMO alerts carry as `url`) isn't something a
 * browser can load at all. */
export async function resolveAlertSourceUrl(alert: NormalizedAlert): Promise<string | null> {
  const referenceDate = alert.sent ?? alert.onset;
  const vtec = alert.vtec ?? (await fetchVtecForAlert(alert.url));
  const iemUrl = vtec ? iemAlertUrl(vtec, referenceDate) : null;
  if (iemUrl) return iemUrl;
  return alert.url && /^https?:\/\//i.test(alert.url) ? alert.url : null;
}
