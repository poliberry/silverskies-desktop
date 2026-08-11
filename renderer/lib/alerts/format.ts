import { fmtTime } from "@/lib/units";

/** "12h 30m left" — time remaining until `expiresIso`, or null once expired
 * (or if there's no expiry to compute against). */
export function timeRemainingLabel(expiresIso: string | undefined, now: Date = new Date()): string | null {
  if (!expiresIso) return null;
  const ms = new Date(expiresIso).getTime() - now.getTime();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

/** "Until 10:00 AM" — plus a weekday suffix when the expiry isn't today. */
export function untilLabel(expiresIso: string | undefined, now: Date = new Date()): string | null {
  if (!expiresIso) return null;
  const d = new Date(expiresIso);
  const isToday = d.toDateString() === now.toDateString();
  const weekday = isToday ? "" : ` ${d.toLocaleDateString(undefined, { weekday: "short" })}`;
  return `Until ${fmtTime(expiresIso)}${weekday}`;
}

/** "Issued 7:59 PM" */
export function issuedLabel(sentIso: string | undefined): string | null {
  if (!sentIso) return null;
  return `Issued ${fmtTime(sentIso)}`;
}
