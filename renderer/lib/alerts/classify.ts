// Ported verbatim from the original app's ALERT_CLASS_MAP / alertClass() /
// getDisplayEvent() / alertIcon() / getPulseColorForClass(). This is the one
// taxonomy shared by the audit-log rows (app/globals.css `.alert-*` classes)
// and the radar map's alert-polygon fill colors.

type ClassRule = [RegExp, string];

// Exported so the Settings → Alerts catalog (alertTypeCatalog.ts) can
// enumerate every real classifier output instead of only the ones a
// DEMO_ALERT_GROUPS event happens to reach.
export const ALERT_CLASS_MAP: ClassRule[] = [
  // Tornado (Emergency/PDS/Observed are detected from headline text, below)
  [/tornado warning/i, "alert-tornado-warning"],
  [/tornado watch/i, "alert-tornado-watch"],
  // Severe Thunderstorm (PDS/Destructive detected from headline text, below)
  [/severe thunderstorm warning/i, "alert-severe-tstorm-warn"],
  [/severe thunderstorm watch/i, "alert-severe-tstorm-watch"],
  [/severe weather statement/i, "alert-severe-wx-stmt"],
  // Tropical
  [/hurricane warning/i, "alert-hurricane-warning"],
  [/hurricane watch/i, "alert-hurricane-watch"],
  [/hurricane local statement/i, "alert-hurricane-statement"],
  [/tropical storm warning/i, "alert-tropical-storm-warn"],
  [/tropical storm watch/i, "alert-tropical-storm-watch"],
  [/tropical depression/i, "alert-tropical-depression"],
  // Flood
  [/flash flood emergency/i, "alert-flash-flood-emergency"],
  [/flash flood warning/i, "alert-flash-flood-warn"],
  [/flash flood watch/i, "alert-flash-flood-watch"],
  [/flood warning/i, "alert-flood-warning"],
  [/coastal flood warning/i, "alert-coastal-flood-warn"],
  [/coastal flood watch/i, "alert-coastal-flood-watch"],
  [/coastal flood advisory/i, "alert-coastal-flood-adv"],
  [/lakeshore flood warning/i, "alert-lakeshore-flood-warn"],
  [/hydrological outlook|hydrology/i, "alert-hydrological"],
  // Winter
  [/blizzard warning/i, "alert-blizzard"],
  [/ice storm warning/i, "alert-ice-storm"],
  [/snow squall warning/i, "alert-snow-squall"],
  [/lake effect snow warning/i, "alert-lake-effect-snow-warn"],
  [/lake effect snow advisory/i, "alert-lake-effect-snow-adv"],
  [/wind chill warning/i, "alert-wind-chill-warn"],
  [/wind chill watch/i, "alert-wind-chill-watch"],
  [/wind chill advisory/i, "alert-wind-chill-adv"],
  [/freezing rain advisory|freezing drizzle/i, "alert-freezing-rain-adv"],
  [/sleet warning|sleet advisory/i, "alert-sleet-warn"],
  [/hard freeze warning/i, "alert-hard-freeze-warn"],
  [/hard freeze watch/i, "alert-hard-freeze-watch"],
  [/freeze warning/i, "alert-freeze-warn"],
  [/freeze watch/i, "alert-freeze-watch"],
  // Wind
  [/extreme wind warning/i, "alert-extreme"],
  [/high wind warning/i, "alert-severe"],
  [/high wind watch/i, "alert-moderate"],
  [/wind advisory/i, "alert-wind-adv"],
  [/gale warning/i, "alert-gale-warn"],
  // Fire
  [/red flag warning/i, "alert-severe"],
  [/fire weather watch/i, "alert-fire-watch"],
  [/extreme fire danger/i, "alert-extreme-fire"],
  // Heat
  [/excessive heat warning/i, "alert-extreme"],
  [/excessive heat watch/i, "alert-excessive-heat-watch"],
  [/heat advisory/i, "alert-heat-adv"],
  [/extreme heat warning/i, "alert-extreme"],
  // Fog / Visibility / Air
  [/dense fog advisory/i, "alert-dense-fog-adv"],
  [/dense smoke advisory/i, "alert-dense-smoke-adv"],
  [/air quality alert|air quality advisory/i, "alert-air-quality"],
  [/low water advisory/i, "alert-low-water-adv"],
  // Dust
  [/dust storm warning/i, "alert-dust-storm"],
  [/blowing dust advisory/i, "alert-blowing-dust"],
  // Coastal / Marine / Surf
  [/storm surge warning/i, "alert-storm-surge-warn"],
  [/storm surge watch/i, "alert-storm-surge-watch"],
  [/tsunami warning/i, "alert-tsunami-warn"],
  [/tsunami watch/i, "alert-tsunami-watch"],
  [/tsunami advisory/i, "alert-tsunami-adv"],
  [/high surf warning/i, "alert-high-surf-warn"],
  [/high surf advisory/i, "alert-high-surf-adv"],
  [/rip current statement/i, "alert-rip-current"],
  [/special marine warning/i, "alert-marine-warning"],
  // Volcanic / Geologic
  [/volcano warning/i, "alert-volcano"],
  [/ashfall warning/i, "alert-ashfall-warn"],
  [/ashfall advisory/i, "alert-ashfall-adv"],
  [/debris flow/i, "alert-debris-flow"],
  [/avalanche warning/i, "alert-avalanche-warn"],
  [/avalanche watch/i, "alert-avalanche-watch"],
  [/avalanche advisory/i, "alert-avalanche-adv"],
  [/earthquake warning/i, "alert-earthquake"],
  [/earthquake advisory/i, "alert-earthquake-advisory"],
  [/aftershock/i, "alert-aftershock"],
  // Evacuation — NWS's real product name is "Evacuation - Immediate" (with a dash)
  [/evacuation\s*-?\s*immediate/i, "alert-evacuation"],
  [/evacuation\s*-?\s*warning/i, "alert-evacuation-warning"],
  [/evacuation\s*-?\s*watch/i, "alert-evacuation-watch"],
  // Civil / Government
  [/civil emergency/i, "alert-civil-emergency"],
  [/shelter.?in.?place/i, "alert-shelter-in-place"],
  [/blue alert/i, "alert-blue-alert"],
  [/law enforcement/i, "alert-law-enforcement"],
  [/child abduction emergency|amber alert/i, "alert-amber"],
  [/911 telephone outage/i, "alert-911-outage"],
  [/nuclear power plant/i, "alert-nuclear"],
  [/emergency action notification|national emergency/i, "alert-ean"],
  [/administrative message/i, "alert-admin-message"],
  [/asteroid/i, "alert-asteroid"],
  // General
  [/special weather statement/i, "alert-special-wx-stmt"],
  [/mesoscale discussion/i, "alert-mesoscale-discussion"],
];

/** Severity → CSS class fallback when no event-name rule matches. */
const SEVERITY_CLASS: Record<string, string> = {
  Extreme: "alert-extreme",
  Severe: "alert-severe",
  Moderate: "alert-moderate",
  Minor: "alert-minor",
};

export function alertClass(
  event: string,
  severity: string | undefined,
  headline: string | undefined,
  description: string | undefined,
): string {
  const combined = `${event} ${headline ?? ""} ${description ?? ""}`;

  if (/tornado emergency/i.test(event)) return "alert-tornado-emergency";
  if (/tornado warning/i.test(event)) {
    if (/tornado emergency/i.test(combined)) return "alert-tornado-emergency";
    if (/particularly dangerous situation|PDS/i.test(combined)) return "alert-tornado-pds";
    if (/confirmed tornado|observed tornado/i.test(combined)) return "alert-tornado-observed";
  }
  if (/severe thunderstorm warning/i.test(event)) {
    if (/particularly dangerous situation|PDS/i.test(combined)) return "alert-svr-pds";
    if (/destructive/i.test(combined)) return "alert-svr-destructive";
  }

  for (const [re, cls] of ALERT_CLASS_MAP) {
    if (re.test(event)) return cls;
  }

  return (severity && SEVERITY_CLASS[severity]) || "alert-unknown";
}

/** A stable key identifying an alert's actual hazard type — distinct from
 * `cssClass`, which several genuinely different hazards intentionally
 * share for styling purposes (e.g. "Excessive Heat Warning", "Extreme Wind
 * Warning", and "Extreme Heat Warning" are all `alert-extreme`). Grouping
 * alerts (see AlertLog.tsx's accordion) by cssClass would incorrectly merge
 * those into one section; this instead keys on which specific
 * ALERT_CLASS_MAP rule matched (each rule/regex is unique per hazard, even
 * when several rules happen to resolve to the same cssClass), falling back
 * to the alert's own event text — not the shared severity-only cssClass —
 * when no rule matches at all. The inline tornado/severe-thunderstorm
 * tiering in alertClass() (PDS/destructive/observed/emergency) already
 * produces a cssClass unique per tier, so those are safe to key on cssClass
 * directly. */
export function hazardGroupKey(event: string, cssClass: string): string {
  if (
    cssClass.startsWith("alert-tornado-") ||
    cssClass === "alert-svr-pds" ||
    cssClass === "alert-svr-destructive"
  ) {
    return cssClass;
  }
  for (const [re] of ALERT_CLASS_MAP) {
    if (re.test(event)) return re.source;
  }
  return event.trim().toLowerCase();
}

/** Overrides the display name for alerts whose `event` field doesn't
 * reflect the true tier (e.g. a "Tornado Warning" that's actually a
 * Tornado Emergency per its headline text). */
export function getDisplayEvent(event: string, cls: string): string {
  if (cls === "alert-tornado-emergency") return "Tornado Emergency";
  if (cls === "alert-tornado-pds") return "Tornado Warning (PDS)";
  if (cls === "alert-tornado-observed") return "Tornado Warning (Confirmed)";
  if (cls === "alert-svr-pds") return "Severe Thunderstorm Warning (PDS)";
  if (cls === "alert-svr-destructive") return "Severe Thunderstorm Warning (Destructive)";
  return event;
}

/** Phosphor icon name for a given event/hazard name. */
export function alertIconName(eventName: string): string {
  const e = eventName.toLowerCase();
  if (/mesoscale discussion/.test(e)) return "chat-centered-text";
  if (/tornado/.test(e)) return "tornado";
  if (/hurricane|typhoon|tropical storm|tropical dep/.test(e)) return "hurricane";
  if (/thunderstorm|severe thunder/.test(e)) return "cloud-lightning";
  if (/flash flood|flood/.test(e)) return "waves";
  if (/snow squall|blizzard|snow|winter|lake effect/.test(e)) return "snowflake";
  if (/ice storm|sleet|freezing/.test(e)) return "thermometer-snowflake";
  if (/freeze|frost|wind chill|extreme cold|cold/.test(e)) return "thermometer-cold";
  if (/heat|excessive heat/.test(e)) return "thermometer-hot";
  if (/high wind|wind|gale/.test(e)) return "wind";
  if (/dust storm|blowing dust/.test(e)) return "wind";
  if (/fog|dense fog/.test(e)) return "cloud-fog";
  if (/haze|smoke|air quality|air stagnation/.test(e)) return "smiley-x-eyes";
  if (/fire|red flag/.test(e)) return "fire";
  if (/tsunami|storm surge/.test(e)) return "waves";
  if (/marine|coastal|surf|rip current/.test(e)) return "waves";
  if (/avalanche/.test(e)) return "mountains";
  if (/volcano|ash/.test(e)) return "mountains";
  if (/nuclear|radiological|hazardous mat/.test(e)) return "radioactive";
  if (/earthquake|aftershock/.test(e)) return "waveform";
  if (/evacuation|shelter.?in.?place/.test(e)) return "door-open";
  if (/civil emergency|civil danger/.test(e)) return "warning";
  if (/emergency action|national emergency/.test(e)) return "siren";
  if (/law enforcement|blue alert/.test(e)) return "shield-warning";
  if (/911/.test(e)) return "phone-x";
  if (/drizzle|shower|rain|rainfall|precip/.test(e)) return "cloud-rain";
  return "warning";
}

/** ECCC risk_colour_en → CSS class. */
export function ecccAlertClass(colour: string): string {
  const c = colour.toLowerCase();
  if (c === "red") return "eccc-red";
  if (c === "orange") return "eccc-orange";
  if (c === "yellow") return "eccc-yellow";
  return "eccc-statement";
}

/** Only the highest-tier alerts trigger the full-window severe pulse —
 * matches the original app's (intentionally narrow) getPulseColorForClass
 * map, keyed by exact CSS class rather than by hazard family. */
const PULSE_COLOR_BY_CLASS: Record<string, string> = {
  "eccc-red": "#cc0000",
  "eccc-orange": "#dd5500",
  "alert-tornado-emergency": "#8a0ba5",
  "alert-tornado-pds": "#7300ff",
  "alert-tornado-observed": "#bd0065",
  "alert-svr-pds": "#ff3300",
  "alert-svr-destructive": "#ff3300",
  "alert-hurricane-warning": "#ff0550",
  "alert-flash-flood-emergency": "#00d9c0",
  "alert-civil-emergency": "#e75480",
  "alert-earthquake": "#ff2020",
  "alert-dust-storm": "#b08040",
  "alert-volcano": "#cc4400",
  "alert-tsunami-warn": "#ff00cc",
  "alert-avalanche-warn": "#ffffff",
  "alert-debris-flow": "#886633",
  "alert-ean": "#ffffff",
  "alert-blue-alert": "#1a6eff",
  "alert-amber": "#ffdd00",
  "alert-nuclear": "#39ff14",
  "alert-evacuation": "#ffffff",
};

export function getPulseColorForClass(cls: string): string | null {
  return PULSE_COLOR_BY_CLASS[cls] ?? null;
}

/** ECCC's risk_colour_en doubles as the Air Quality Health Index scale — a
 * health-risk rating, not severe-weather urgency, so a "red" AQHI reading
 * shouldn't trigger the same full-screen pulse as a red severe warning. */
export function isAirQualityEvent(event: string): boolean {
  return /air quality|smoke/i.test(event);
}
