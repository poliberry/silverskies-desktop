import type { HourlyPoint } from "@/types/weather";

/** Ported from the original app's hourly-card loop in renderAll(): skip
 * hours already in the past (but keep the current hour), cap at 12 cards. */
export function selectUpcomingHours(hourly: HourlyPoint[], now: Date = new Date(), max = 12): HourlyPoint[] {
  const result: HourlyPoint[] = [];
  for (const point of hourly) {
    if (result.length >= max) break;
    const hd = new Date(point.time);
    if (hd < now && hd.getHours() !== now.getHours()) continue;
    result.push(point);
  }
  return result;
}
