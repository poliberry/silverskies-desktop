import { z } from "zod";
import type { ThemeColors, ThemeDefinition } from "@/types/settings";

export type { ThemeColors, ThemeDefinition };

/** Maps each themeable `colors` key to the real CSS custom property it
 * overrides (see the :root token block in app/globals.css). Only this
 * subset — the brand hue plus the background/surface/border/text
 * hierarchy and the two status colors — is themeable; everything else in
 * globals.css derives from these. */
export const CSS_VAR_BY_KEY: Record<keyof ThemeColors, string> = {
  a0: "--a0",
  bg: "--bg",
  surface: "--surface",
  surface3: "--surface3",
  border: "--border",
  text: "--text",
  text2: "--text2",
  text3: "--text3",
  danger: "--danger",
  safe: "--safe",
};

const themeColorsSchema = z
  .object({
    a0: z.string().optional(),
    bg: z.string().optional(),
    surface: z.string().optional(),
    surface3: z.string().optional(),
    border: z.string().optional(),
    text: z.string().optional(),
    text2: z.string().optional(),
    text3: z.string().optional(),
    danger: z.string().optional(),
    safe: z.string().optional(),
  })
  .refine((colors) => Object.values(colors).some((v) => typeof v === "string" && v.length > 0), {
    message: "Theme must set at least one color",
  });

export const themeDefinitionSchema = z.object({
  name: z.string().min(1, "Theme needs a name"),
  colors: themeColorsSchema,
});

export interface ThemeParseError {
  message: string;
}

/** Parses + validates a theme from raw JSON text (a loaded file or pasted
 * JSON) — used by Settings → Themes. Returns either the theme or a single
 * human-readable error message. */
export function parseThemeJson(raw: string): { theme: ThemeDefinition } | { error: ThemeParseError } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { error: { message: "That's not valid JSON." } };
  }
  const result = themeDefinitionSchema.safeParse(json);
  if (!result.success) {
    const first = result.error.issues[0];
    return { error: { message: first ? `${first.path.join(".") || "theme"}: ${first.message}` : "Invalid theme." } };
  }
  return { theme: result.data };
}
