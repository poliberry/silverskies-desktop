import type { TimeFormatPref, UnitPref } from "@/types/settings";

const toF = (c: number) => (c * 9) / 5 + 32;

/** Rounds a Celsius value to the display unit. */
export function fmtTemp(celsius: number, unit: UnitPref): number {
  return Math.round(unit === "F" ? toF(celsius) : celsius);
}

export function unitSuffix(unit: UnitPref): string {
  return `°${unit}`;
}

/** Wind speed in the API's native km/h → display unit (mph for °F, km/h for °C). */
export function fmtWind(kmh: number, unit: UnitPref): number {
  return Math.round(unit === "F" ? kmh * 0.621371 : kmh);
}

export function windSpeedUnit(unit: UnitPref): string {
  return unit === "F" ? "mph" : "km/h";
}

export function uvLabel(uv: number): { label: string; color: string } {
  if (uv <= 2) return { label: "Low", color: "var(--safe)" };
  if (uv <= 5) return { label: "Moderate", color: "#ffcc44" };
  if (uv <= 7) return { label: "High", color: "#ff8844" };
  if (uv <= 10) return { label: "Very High", color: "#ff6644" };
  return { label: "Extreme", color: "#ff44aa" };
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function windDirLabel(deg: number): string {
  return COMPASS[Math.round(deg / 45) % 8];
}

/** Always-12-hour clock time, e.g. "6:42 PM" — used for alert onset/expiry. */
export function fmtTime(isoStr: string): string {
  const d = new Date(isoStr);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${m} ${ap}`;
}

/** Hourly-strip label, honoring the 12h/24h preference. */
export function fmtHourLabel(isoStr: string, timeFormat: TimeFormatPref): string {
  const d = new Date(isoStr);
  const h = d.getHours();
  if (timeFormat === "24") return `${h.toString().padStart(2, "0")}:00`;
  const ap = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12} ${ap}`;
}

/** Ported from the original app's stampRefresh() — a bare hh:mm (AM/PM) clock time. */
export function fmtClockTime(date: Date, timeFormat: TimeFormatPref): string {
  const h24 = date.getHours();
  const m = date.getMinutes().toString().padStart(2, "0");
  if (timeFormat === "24") return `${h24.toString().padStart(2, "0")}:${m}`;
  const ap = h24 >= 12 ? "PM" : "AM";
  return `${(h24 % 12 || 12).toString().padStart(2, "0")}:${m} ${ap}`;
}

export function fmtDayLabel(isoDate: string, index: number): string {
  if (index === 0) return "Today";
  const d = new Date(`${isoDate}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short" });
}
