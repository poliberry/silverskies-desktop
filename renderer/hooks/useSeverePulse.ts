import { useEffect } from "react";

/** Ported from the original app's applyPulse()/applyTopGlow() — the highest-
 * tier active alerts pulse the whole window's background and swap the top
 * ambient glow bar to the alert's color. When nothing's active, the glow
 * bar's `--tg` inline override is removed (not set back to the accent
 * value) so it keeps tracking `--a0` live via its own CSS default. */
export function useSeverePulse(pulseColor: string | null, resolvedTheme: "light" | "dark") {
  useEffect(() => {
    const topGlow = document.getElementById("top-glow");
    let styleEl = document.getElementById("severePulseStyle") as HTMLStyleElement | null;

    if (pulseColor) {
      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = "severePulseStyle";
        document.head.appendChild(styleEl);
      }
      const isLight = resolvedTheme === "light";
      const bgBase = isLight ? "#f2f3f7" : "#0d0d0f";
      const pct = isLight ? "10%" : "22%";
      styleEl.textContent = `@keyframes severePulse {
        0%,100% { background-color: var(--bg); }
        50% { background-color: color-mix(in srgb, ${pulseColor} ${pct}, ${bgBase}); }
      }`;
      document.body.classList.add("severe-warning");

      if (topGlow) {
        const hex = pulseColor.replace("#", "");
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        topGlow.style.setProperty("--tg", `${r},${g},${b}`);
        topGlow.classList.add("pulsing");
      }
    } else {
      document.body.classList.remove("severe-warning");
      if (topGlow) {
        topGlow.classList.remove("pulsing");
        topGlow.style.removeProperty("--tg");
      }
    }
  }, [pulseColor, resolvedTheme]);
}
