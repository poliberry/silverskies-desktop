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

// --a0 isn't consumed as a CSS <color> itself — it's a bare "r, g, b" triple
// substituted into rgb(var(--a0))/rgba(var(--a0), alpha) — so it needs its
// own format check rather than the general color validator below.
const RGB_TRIPLE = /^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/;

function isValidRgbTriple(value: string): boolean {
  if (!RGB_TRIPLE.test(value)) return false;
  return value.split(",").every((n) => {
    const channel = Number(n.trim());
    return Number.isInteger(channel) && channel >= 0 && channel <= 255;
  });
}

// Every other theme color is assigned to a real CSS <color>-typed
// declaration (e.g. `background: var(--bg)`), so an invalid value doesn't
// throw — it's just silently ignored at computed-value time and the
// palette change never renders. Catching that here means testing the same
// way the browser does: assign it to a real color property and see if the
// assignment stuck (rejected values leave the property empty).
function isValidCssColor(value: string): boolean {
  const probe = document.createElement("span");
  probe.style.color = "";
  probe.style.color = value;
  return probe.style.color !== "";
}

const themeColorsSchema = z
  .object({
    a0: z.string().trim().min(1).refine(isValidRgbTriple, { message: 'must be an "r, g, b" triple (0-255 each)' }).optional(),
    bg: z.string().trim().min(1).refine(isValidCssColor, { message: "must be a valid CSS color" }).optional(),
    surface: z.string().trim().min(1).refine(isValidCssColor, { message: "must be a valid CSS color" }).optional(),
    surface3: z.string().trim().min(1).refine(isValidCssColor, { message: "must be a valid CSS color" }).optional(),
    border: z.string().trim().min(1).refine(isValidCssColor, { message: "must be a valid CSS color" }).optional(),
    text: z.string().trim().min(1).refine(isValidCssColor, { message: "must be a valid CSS color" }).optional(),
    text2: z.string().trim().min(1).refine(isValidCssColor, { message: "must be a valid CSS color" }).optional(),
    text3: z.string().trim().min(1).refine(isValidCssColor, { message: "must be a valid CSS color" }).optional(),
    danger: z.string().trim().min(1).refine(isValidCssColor, { message: "must be a valid CSS color" }).optional(),
    safe: z.string().trim().min(1).refine(isValidCssColor, { message: "must be a valid CSS color" }).optional(),
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
