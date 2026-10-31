import type { NormalizedAlert } from "@/types/alerts";
import { alertClass, getDisplayEvent } from "./classify";

/** Rough bounding box for Australia — only used to decide whether it's worth
 * *also* querying WillyWeather; WillyWeather's own location search just
 * comes back empty for a point outside real BOM coverage. */
export function isAustralia(lat: number, lon: number): boolean {
  return lat >= -44 && lat <= -10 && lon >= 112 && lon <= 154;
}

interface WillyWeatherSearchResult {
  id: number;
}

interface WillyWeatherWarning {
  code: string;
  name: string;
  issueDateTime: string; // "YYYY-MM-DD HH:MM:SS", UTC, no offset
  expireDateTime?: string;
  warningType: {
    name: string;
    classification: string;
  };
  content?: {
    text?: string;
  };
}

/** WillyWeather's `warningType.classification` doesn't map to a BOM/CAP
 * severity tier directly, so this buckets the classification strings BOM
 * itself uses (tsunami/cyclone-scale hazards down to general advice) onto
 * the same Extreme/Severe/Moderate/Minor scale the rest of the app uses. */
const CLASSIFICATION_SEVERITY: Record<string, string> = {
  tsunami: "Extreme",
  tornado: "Extreme",
  hurricane: "Extreme",
  typhoon: "Extreme",
  cyclone: "Extreme",
  volcano: "Extreme",
  earthquake: "Extreme",
  fire: "Severe",
  flood: "Severe",
  storm: "Severe",
  "strong-wind": "Severe",
  wind: "Severe",
  cold: "Severe",
  heat: "Severe",
  blizzard: "Severe",
  avalanche: "Severe",
  hazmat: "Severe",
  marine: "Moderate",
  surf: "Moderate",
  frost: "Moderate",
  fog: "Moderate",
  "cold-rain": "Moderate",
  "wind-chill": "Moderate",
  road: "Moderate",
  "dust-smoke-pollution": "Moderate",
  farming: "Minor",
  sheep: "Minor",
  hiking: "Minor",
  "fruit-disease": "Minor",
  "leaf-disease": "Minor",
  general: "Minor",
  "closed-water": "Minor",
};

function severityFromClassification(classification: string): string {
  return CLASSIFICATION_SEVERITY[classification.toLowerCase()] ?? "Moderate";
}

function toIso(willyWeatherDateTime: string | undefined): string | undefined {
  if (!willyWeatherDateTime) return undefined;
  return `${willyWeatherDateTime.replace(" ", "T")}Z`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/**
 * BOM severe-weather warnings via WillyWeather's public, documented API
 * (https://www.willyweather.com.au/api/docs/warnings.html) — BOM itself
 * doesn't publish a usable third-party API (the app's own JSON feed is
 * explicitly marked "you must not use, copy or share it", and the public
 * website/RSS actively block automated requests), but WillyWeather
 * re-publishes the same underlying BOM warning data under its own keyed API.
 * Requires the user's own WillyWeather API key (Settings) — there's no
 * documented free tier, so this is opt-in and silently no-ops without a key.
 */
export async function fetchBomAlerts(lat: number, lon: number, apiKey: string | null): Promise<NormalizedAlert[]> {
  if (!apiKey) return [];
  try {
    const searchUrl = `https://api.willyweather.com.au/v2/${encodeURIComponent(apiKey)}/search.json?lat=${lat}&lng=${lon}&units=distance:km`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) return [];
    const results: WillyWeatherSearchResult[] = await searchRes.json();
    const locationId = results[0]?.id;
    if (!locationId) return [];

    const warningsUrl = `https://api.willyweather.com.au/v2/${encodeURIComponent(apiKey)}/locations/${locationId}/warnings.json`;
    const warningsRes = await fetch(warningsUrl);
    if (!warningsRes.ok) return [];
    const warnings: WillyWeatherWarning[] = await warningsRes.json();

    return warnings.map((w): NormalizedAlert => {
      const event = w.warningType?.name || w.name || "Weather Warning";
      const severity = severityFromClassification(w.warningType?.classification ?? "");
      const description = w.content?.text ? stripHtml(w.content.text) : undefined;
      const cls = alertClass(event, severity, w.name, description);
      return {
        id: `bom:${w.code}`,
        source: "bom",
        event,
        displayEvent: getDisplayEvent(event, cls),
        cssClass: cls,
        headline: w.name,
        description,
        severity,
        onset: toIso(w.issueDateTime),
        sent: toIso(w.issueDateTime),
        expires: toIso(w.expireDateTime),
        issuingOffice: "BOM",
        geometry: null,
      };
    });
  } catch {
    return [];
  }
}
