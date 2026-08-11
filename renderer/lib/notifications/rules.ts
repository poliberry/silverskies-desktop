import type { NormalizedAlert } from "@/types/alerts";
import type { DailyPoint, HourlyPoint } from "@/types/weather";
import { wmoLabel } from "@/lib/icons/wmo";

export interface NotificationCandidate {
  /** De-dupe key — see lib/notifications/dedupe-store.ts. */
  key: string;
  title: string;
  body: string;
}

/** Thunderstorm, heavy rain, heavy snow, wintry mix/sleet/freezing rain —
 * the WMO codes worth a heads-up even before an official alert exists. */
const SEVERE_CODES = new Set([95, 96, 99, 65, 82, 75, 86, 56, 57, 66, 67]);

const NOTIFIABLE_SEVERITIES = new Set(["Extreme", "Severe", "Moderate"]);

export function detectNewAlerts(
  locationId: string,
  locationLabel: string,
  alerts: NormalizedAlert[],
): NotificationCandidate[] {
  return alerts
    .filter((a) => NOTIFIABLE_SEVERITIES.has(a.severity ?? ""))
    .map((a) => ({
      key: `alert:${locationId}:${a.id}`,
      title: `⚠ ${a.displayEvent}`,
      body: `${locationLabel} — ${a.headline ?? a.event}`,
    }));
}

/** Tomorrow's forecast — high rain chance or a hazardous condition, once
 * per calendar day per location (keyed by tomorrow's own date, so it
 * naturally stops repeating once "tomorrow" rolls over). */
export function detectNotableForecast(
  locationId: string,
  locationLabel: string,
  daily: DailyPoint[],
): NotificationCandidate[] {
  const tomorrow = daily[1];
  if (!tomorrow) return [];
  const candidates: NotificationCandidate[] = [];

  if (tomorrow.precipitationProbabilityMaxPct >= 60) {
    candidates.push({
      key: `forecast-rain:${locationId}:${tomorrow.date}`,
      title: "🌧 Rain likely tomorrow",
      body: `${locationLabel} — ${tomorrow.precipitationProbabilityMaxPct}% chance of precipitation, ${wmoLabel(tomorrow.weatherCode).toLowerCase()}.`,
    });
  }
  if (SEVERE_CODES.has(tomorrow.weatherCode)) {
    candidates.push({
      key: `forecast-severe:${locationId}:${tomorrow.date}`,
      title: `⛈ ${wmoLabel(tomorrow.weatherCode)} expected tomorrow`,
      body: `${locationLabel} — forecast calls for ${wmoLabel(tomorrow.weatherCode).toLowerCase()}.`,
    });
  }
  return candidates;
}

/** A heads-up when a hazardous condition shows up in the hourly forecast
 * within the next `hoursAhead` hours, independent of whether an official
 * alert has been issued yet — once per calendar day per location. */
export function detectExpectedSevere(
  locationId: string,
  locationLabel: string,
  hourly: HourlyPoint[],
  hoursAhead = 12,
): NotificationCandidate[] {
  const now = Date.now();
  const cutoff = now + hoursAhead * 3_600_000;
  const hit = hourly.find((h) => {
    const t = new Date(h.time).getTime();
    return t >= now && t <= cutoff && SEVERE_CODES.has(h.weatherCode);
  });
  if (!hit) return [];

  const today = new Date().toDateString();
  return [
    {
      key: `severe-heads-up:${locationId}:${today}`,
      title: "⛈ Severe weather possible",
      body: `${locationLabel} — ${wmoLabel(hit.weatherCode)} possible within the next ${hoursAhead} hours.`,
    },
  ];
}
