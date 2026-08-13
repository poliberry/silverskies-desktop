import { useEffect } from "react";
import { useSettings } from "./useSettings";
import { BUILTIN_THEMES } from "@/lib/themes/builtinThemes";
import { CSS_VAR_BY_KEY } from "@/lib/themes/theme";
import type { ThemeDefinition } from "@/types/settings";

/** Resolves config.themeId/customTheme to an actual theme and applies its
 * colors as inline CSS custom properties on <html> — same mechanism
 * useConditionAccent already uses for --a0, just for the full palette.
 * "default" clears every themed property so the plain :root/[data-theme]
 * tokens (and the weather-driven accent) take back over. */
export function useAppliedTheme() {
  const { config } = useSettings();
  const themeId = config?.themeId ?? "default";
  const customTheme = config?.customTheme ?? null;

  useEffect(() => {
    const resolved: ThemeDefinition | null =
      themeId === "default" ? null : themeId === "custom" ? customTheme : BUILTIN_THEMES.find((t) => t.id === themeId) ?? null;

    const root = document.documentElement.style;
    for (const [key, cssVar] of Object.entries(CSS_VAR_BY_KEY)) {
      const value = resolved?.colors[key as keyof typeof CSS_VAR_BY_KEY];
      if (value) root.setProperty(cssVar, value);
      else root.removeProperty(cssVar);
    }
  }, [themeId, customTheme]);
}
