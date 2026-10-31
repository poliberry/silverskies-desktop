// Resolves an alert's hex color from its CSS class (`.alert-*`/`.eccc-*`,
// see app/globals.css) via the `--ac` custom property, rather than
// duplicating the ~100-entry color taxonomy a second time in JS. Browser-
// only — used by the radar map's alert-polygon layer.
const cache = new Map<string, string>();

export function resolveAlertColor(cssClass: string): string {
  const cached = cache.get(cssClass);
  if (cached) return cached;

  const probe = document.createElement("div");
  probe.className = cssClass;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const ac = getComputedStyle(probe).getPropertyValue("--ac").trim();
  document.body.removeChild(probe);

  const color = ac || "#888888";
  cache.set(cssClass, color);
  return color;
}

/** Same as resolveAlertColor, but checks a user's per-type color override
 * (Settings → Alerts) first — see types/settings.ts's `alertTypeOverrides`. */
export function resolveAlertColorWithOverrides(
  cssClass: string,
  overrides: Record<string, { visible?: boolean; color?: string }> | undefined,
): string {
  const override = overrides?.[cssClass]?.color;
  return override || resolveAlertColor(cssClass);
}
