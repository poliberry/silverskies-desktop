import { DEMO_ALERT_GROUPS } from "./demo";
import { ALERT_CLASS_MAP, alertClass } from "./classify";

export interface AlertTypeEntry {
  group: string;
  cssClass: string;
  label: string;
}

// Curated group/label for the handful of ALERT_CLASS_MAP entries no
// DEMO_ALERT_GROUPS event text happens to reach (e.g. a plain "Flood
// Warning", a Mesoscale Discussion, or the asteroid easter egg) — kept
// manual and short rather than guessing a label from the CSS class name.
const FALLBACK_LABELS: Record<string, { group: string; label: string }> = {
  "alert-flood-warning": { group: "Flood", label: "Flood Warning" },
  "alert-mesoscale-discussion": { group: "General", label: "Mesoscale Discussion" },
  "alert-asteroid": { group: "General", label: "Asteroid Impact Warning" },
};

/** Every manageable alert "type" for Settings → Alerts. Two passes:
 * DEMO_ALERT_GROUPS first, since it already gives every class it reaches a
 * clean human label/group (including the handful of classes — tornado
 * emergency/PDS, severe thunderstorm PDS/destructive — that alertClass()
 * only resolves from headline text, not from ALERT_CLASS_MAP itself); then
 * every remaining ALERT_CLASS_MAP entry, so a live alert type with no demo
 * event pointing at it (e.g. a plain Flood Warning or a Mesoscale
 * Discussion) still gets a configurable entry instead of silently having
 * no color/visibility control. */
export const ALERT_TYPE_CATALOG: AlertTypeEntry[] = (() => {
  const seen = new Set<string>();
  const entries: AlertTypeEntry[] = [];

  for (const group of DEMO_ALERT_GROUPS) {
    for (const { event, severity } of group.options) {
      const cssClass = alertClass(event, severity, event, "");
      if (seen.has(cssClass)) continue;
      seen.add(cssClass);
      entries.push({ group: group.label, cssClass, label: event });
    }
  }

  for (const [, cssClass] of ALERT_CLASS_MAP) {
    if (seen.has(cssClass)) continue;
    seen.add(cssClass);
    const fallback = FALLBACK_LABELS[cssClass];
    entries.push(fallback ? { group: fallback.group, cssClass, label: fallback.label } : { group: "Other", cssClass, label: cssClass });
  }

  const other: [string, string][] = [
    ["alert-extreme", "Extreme (generic)"],
    ["alert-severe", "Severe (generic)"],
    ["alert-moderate", "Moderate (generic)"],
    ["alert-minor", "Minor (generic)"],
    ["alert-unknown", "Unknown"],
    ["eccc-red", "ECCC Red"],
    ["eccc-orange", "ECCC Orange"],
    ["eccc-yellow", "ECCC Yellow"],
    ["eccc-statement", "ECCC Statement"],
  ];
  for (const [cssClass, label] of other) {
    if (seen.has(cssClass)) continue;
    seen.add(cssClass);
    entries.push({ group: "Other", cssClass, label });
  }

  return entries;
})();
