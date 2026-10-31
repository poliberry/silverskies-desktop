import { SEVERE_WMO_CODES, wmoLabel } from "@/lib/icons/wmo";
import { fmtWind, windDirLabel, windSpeedUnit } from "@/lib/units";
import type { UnitPref } from "@/types/settings";
import type { CurrentConditions, DailyPoint } from "@/types/weather";

export interface TodayOutlook {
  text: string;
  isSevere: boolean;
}

const RAIN_POP_THRESHOLD = 40;
const HIGH_WIND_KMH_THRESHOLD = 40; // ~25 mph

/**
 * A locally-derived, non-official heads-up for the active location's own
 * day — distinct from the real NWS/ECCC/BOM/WMO alerts in the audit log,
 * which this deliberately doesn't try to look like (see TodayOutlookRow).
 * Only appears when there's actually something worth a mention: notable
 * rain chance, high wind, or a hazardous condition in today's forecast —
 * an ordinary clear/calm day renders nothing.
 */
export function buildTodayOutlook(
  current: CurrentConditions,
  today: DailyPoint | undefined,
  unit: UnitPref,
): TodayOutlook | null {
  if (!today) return null;

  const pop = today.precipitationProbabilityMaxPct;
  const rainExpected = pop >= RAIN_POP_THRESHOLD;
  const highWind = current.windSpeedKmh >= HIGH_WIND_KMH_THRESHOLD;
  const severeCode = SEVERE_WMO_CODES.has(current.weatherCode)
    ? current.weatherCode
    : SEVERE_WMO_CODES.has(today.weatherCode)
      ? today.weatherCode
      : null;
  const isSevere = severeCode !== null;

  if (!rainExpected && !highWind && !isSevere) return null;

  const segments: string[] = [];
  if (isSevere) segments.push(`${wmoLabel(severeCode)} expected today`);
  segments.push(`${pop}% chance of rain`);
  segments.push(
    `wind ${fmtWind(current.windSpeedKmh, unit)} ${windSpeedUnit(unit)} ${windDirLabel(current.windDirectionDeg)}${highWind ? " (high)" : ""}`,
  );

  return {
    text: `Today's outlook: ${segments.join(" · ")}`,
    isSevere,
  };
}
