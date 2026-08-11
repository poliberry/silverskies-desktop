import { useEffect, useState } from "react";
import type { TimeFormatPref } from "@/types/settings";

/** Ported from the original app's updateClock() — a full date/time display
 * in the active location's timezone, falling back to device time if the
 * timezone string can't be resolved. */
export function useClock(timezone: string | undefined, timeFormat: TimeFormatPref): string {
  const [display, setDisplay] = useState("—");

  useEffect(() => {
    function tick() {
      const now = new Date();
      const use24 = timeFormat === "24";
      try {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: !use24,
        }).formatToParts(now);
        const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
        const day = get("weekday").toUpperCase();
        const date = get("day");
        const mon = get("month").toUpperCase();
        const yr = get("year");
        const h = get("hour").padStart(2, "0");
        const m = get("minute");
        const ap = use24 ? "" : ` ${get("dayPeriod").toUpperCase()}`;
        setDisplay(`${day} ${date} ${mon} ${yr} — ${h}:${m}${ap}`);
      } catch {
        const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
        const MONS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
        const h24 = now.getHours();
        const m = now.getMinutes().toString().padStart(2, "0");
        const timeStr = use24
          ? `${h24.toString().padStart(2, "0")}:${m}`
          : `${(h24 % 12 || 12).toString().padStart(2, "0")}:${m} ${h24 >= 12 ? "PM" : "AM"}`;
        setDisplay(`${DAYS[now.getDay()]} ${now.getDate()} ${MONS[now.getMonth()]} ${now.getFullYear()} — ${timeStr}`);
      }
    }
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, [timezone, timeFormat]);

  return display;
}
