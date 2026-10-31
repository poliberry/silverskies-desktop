import { useEffect } from "react";
import { resolveAccentRgb } from "@/lib/theme";

/** Ported from the original app's applyTheme() — the accent hue (--a0)
 * shifts based on current conditions, and every other token that derives
 * from it (--accent, --accent2, --accent-glow, the top-glow bar, …)
 * follows automatically since they're all `rgb(var(--a0))`-based. */
export function useConditionAccent(
  weatherCode: number | undefined,
  isDay: boolean | undefined,
  resolvedTheme: "light" | "dark",
  // False while a user-selected theme (Settings → Themes) is active, so its
  // own accent color doesn't get overwritten on the next weather refetch.
  enabled = true,
) {
  useEffect(() => {
    if (!enabled || weatherCode === undefined || isDay === undefined) return;
    const [r, g, b] = resolveAccentRgb(weatherCode, isDay, resolvedTheme);
    document.documentElement.style.setProperty("--a0", `${r},${g},${b}`);
  }, [weatherCode, isDay, resolvedTheme, enabled]);
}
