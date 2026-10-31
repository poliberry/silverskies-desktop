import type { ThemeDefinition } from "@/types/settings";

export interface BuiltinTheme extends ThemeDefinition {
  id: string;
}

/** Built-in theme presets for Settings → Themes. Tuned for the app's dark
 * default (see globals.css :root) — a custom/pasted theme can still target
 * light mode too, these just aren't designed around it. */
export const BUILTIN_THEMES: BuiltinTheme[] = [
  {
    id: "pink-fuchsia",
    name: "Pink Fuchsia",
    colors: {
      a0: "255, 45, 155",
      bg: "#180510",
      surface: "#210a18",
      surface3: "#2c0f22",
      border: "rgba(255, 255, 255, 0.08)",
      text: "#ffeef7",
      text2: "rgba(255, 238, 247, 0.62)",
      text3: "rgba(255, 238, 247, 0.32)",
      danger: "#ff4d6d",
      safe: "#5dffb0",
    },
  },
  {
    id: "wintergreen",
    name: "Wintergreen",
    colors: {
      a0: "60, 210, 160",
      bg: "#07120f",
      surface: "#0d1e19",
      surface3: "#122922",
      border: "rgba(255, 255, 255, 0.07)",
      text: "#eafff5",
      text2: "rgba(234, 255, 245, 0.6)",
      text3: "rgba(234, 255, 245, 0.3)",
      danger: "#ff6b6b",
      safe: "#7dffb8",
    },
  },
  {
    id: "nord-blue",
    name: "Nord Blue",
    colors: {
      a0: "136, 192, 208",
      bg: "#2e3440",
      surface: "#3b4252",
      surface3: "#434c5e",
      border: "rgba(236, 239, 244, 0.08)",
      text: "#eceff4",
      text2: "rgba(236, 239, 244, 0.65)",
      text3: "rgba(236, 239, 244, 0.35)",
      danger: "#bf616a",
      safe: "#a3be8c",
    },
  },
  {
    id: "purple-violet",
    name: "Purple Violet",
    colors: {
      a0: "170, 90, 255",
      bg: "#120a1f",
      surface: "#1a1029",
      surface3: "#241536",
      border: "rgba(255, 255, 255, 0.08)",
      text: "#f3ecff",
      text2: "rgba(243, 236, 255, 0.62)",
      text3: "rgba(243, 236, 255, 0.32)",
      danger: "#ff6b8a",
      safe: "#7dffc8",
    },
  },
];
