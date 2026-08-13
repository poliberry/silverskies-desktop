import { DEMO_ALERT_GROUPS } from "./demo";
import { alertClass } from "./classify";

export interface AlertTypeEntry {
  group: string;
  cssClass: string;
  label: string;
}

/** Every manageable alert "type" for Settings → Alerts, grouped the same
 * way as the demo-alert dropdown. Derived from DEMO_ALERT_GROUPS + the same
 * alertClass() classifier the live alert feeds use, rather than hand-listing
 * the ~86 CSS classes a second time — stays in sync with classify.ts by
 * construction. */
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
