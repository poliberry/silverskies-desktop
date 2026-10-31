// Ported from the original app's CONDITION_THEMES / conditionThemeKey /
// applyTheme — the accent hue (--a0) shifts based on current conditions.

export type ConditionThemeKey =
  | "clear_day"
  | "clear_night"
  | "partly_cloudy"
  | "overcast"
  | "fog"
  | "drizzle"
  | "rain"
  | "heavy_rain"
  | "snow"
  | "thunderstorm"
  | "hot"
  | "windy";

export const CONDITION_THEMES: Record<ConditionThemeKey, [number, number, number]> = {
  clear_day: [255, 200, 60], // warm gold
  clear_night: [80, 120, 220], // deep blue
  partly_cloudy: [100, 180, 255], // sky blue
  overcast: [140, 150, 170], // cool grey-blue
  fog: [160, 160, 180], // muted lavender-grey
  drizzle: [80, 160, 220], // steel blue
  rain: [60, 130, 210], // rain blue
  heavy_rain: [40, 100, 180], // deep rain
  snow: [180, 220, 255], // ice blue
  thunderstorm: [138, 100, 255], // purple (brand default)
  hot: [255, 120, 40], // orange heat
  windy: [100, 200, 180], // teal
};

export function conditionThemeKey(code: number, isDay: boolean): ConditionThemeKey {
  if ([95, 96, 99].includes(code)) return "thunderstorm";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([65, 82].includes(code)) return "heavy_rain";
  if ([61, 63, 80, 81].includes(code)) return "rain";
  if ([51, 53, 55].includes(code)) return "drizzle";
  if ([45, 48].includes(code)) return "fog";
  if (code === 3) return "overcast";
  if ([1, 2].includes(code)) return "partly_cloudy";
  return isDay ? "clear_day" : "clear_night";
}

/** Resolves the accent RGB triple for a weather code, darkening pale/bright
 * accents in light mode so they stay readable on a white surface. */
export function resolveAccentRgb(
  code: number,
  isDay: boolean,
  resolvedTheme: "light" | "dark",
): [number, number, number] {
  let [r, g, b] = CONDITION_THEMES[conditionThemeKey(code, isDay)] ?? CONDITION_THEMES.clear_day;
  if (resolvedTheme === "light") {
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    if (brightness > 160) {
      const scale = 140 / brightness;
      r = Math.round(r * scale);
      g = Math.round(g * scale);
      b = Math.round(b * scale);
    }
  }
  return [r, g, b];
}
