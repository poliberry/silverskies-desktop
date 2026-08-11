import type { NormalizedAlert } from "@/types/alerts";
import { alertClass, getDisplayEvent } from "./classify";

/** Grouped options for the alert-demo dropdown — ported verbatim from the
 * original app's `#demoAlertSelect`. The special `__ASTEROID__` event is
 * the easter egg, handled separately by triggerAsteroidAlert(). */
export const DEMO_ALERT_GROUPS: { label: string; options: { event: string; severity: string }[] }[] = [
  {
    label: "Tornado",
    options: [
      { event: "Tornado Emergency", severity: "Extreme" },
      { event: "Tornado Warning (PDS)", severity: "Extreme" },
      { event: "Confirmed Tornado Warning", severity: "Extreme" },
      { event: "Tornado Warning", severity: "Extreme" },
      { event: "Tornado Watch", severity: "Severe" },
    ],
  },
  {
    label: "Severe Thunderstorm",
    options: [
      { event: "Severe Thunderstorm Warning (PDS)", severity: "Extreme" },
      { event: "Severe Thunderstorm Warning (Destructive)", severity: "Extreme" },
      { event: "Severe Thunderstorm Warning", severity: "Severe" },
      { event: "Severe Thunderstorm Watch", severity: "Moderate" },
      { event: "Severe Weather Statement", severity: "Moderate" },
    ],
  },
  {
    label: "Tropical",
    options: [
      { event: "Hurricane Warning", severity: "Extreme" },
      { event: "Hurricane Watch", severity: "Severe" },
      { event: "Hurricane Local Statement", severity: "Moderate" },
      { event: "Tropical Storm Warning", severity: "Severe" },
      { event: "Tropical Storm Watch", severity: "Moderate" },
      { event: "Tropical Depression Statement", severity: "Minor" },
    ],
  },
  {
    label: "Flood",
    options: [
      { event: "Flash Flood Emergency", severity: "Extreme" },
      { event: "Flash Flood Warning", severity: "Severe" },
      { event: "Flash Flood Watch", severity: "Moderate" },
      { event: "Coastal Flood Warning", severity: "Severe" },
      { event: "Coastal Flood Watch", severity: "Moderate" },
      { event: "Coastal Flood Advisory", severity: "Minor" },
      { event: "Lakeshore Flood Warning", severity: "Severe" },
      { event: "Hydrological Outlook", severity: "Minor" },
    ],
  },
  {
    label: "Winter",
    options: [
      { event: "Blizzard Warning", severity: "Extreme" },
      { event: "Ice Storm Warning", severity: "Severe" },
      { event: "Snow Squall Warning", severity: "Severe" },
      { event: "Winter Storm Warning", severity: "Severe" },
      { event: "Lake Effect Snow Warning", severity: "Severe" },
      { event: "Lake Effect Snow Advisory", severity: "Moderate" },
      { event: "Wind Chill Warning", severity: "Extreme" },
      { event: "Wind Chill Watch", severity: "Severe" },
      { event: "Wind Chill Advisory", severity: "Moderate" },
      { event: "Freezing Rain Advisory", severity: "Moderate" },
      { event: "Sleet Warning", severity: "Moderate" },
      { event: "Hard Freeze Warning", severity: "Severe" },
      { event: "Hard Freeze Watch", severity: "Moderate" },
      { event: "Freeze Warning", severity: "Moderate" },
      { event: "Freeze Watch", severity: "Minor" },
    ],
  },
  {
    label: "Wind",
    options: [
      { event: "Extreme Wind Warning", severity: "Extreme" },
      { event: "High Wind Warning", severity: "Severe" },
      { event: "High Wind Watch", severity: "Moderate" },
      { event: "Wind Advisory", severity: "Minor" },
      { event: "Gale Warning", severity: "Severe" },
    ],
  },
  {
    label: "Fire",
    options: [
      { event: "Red Flag Warning", severity: "Severe" },
      { event: "Fire Weather Watch", severity: "Moderate" },
      { event: "Extreme Fire Danger", severity: "Extreme" },
    ],
  },
  {
    label: "Heat",
    options: [
      { event: "Extreme Heat Warning", severity: "Extreme" },
      { event: "Excessive Heat Warning", severity: "Severe" },
      { event: "Excessive Heat Watch", severity: "Severe" },
      { event: "Heat Advisory", severity: "Moderate" },
    ],
  },
  {
    label: "Fog / Visibility / Air",
    options: [
      { event: "Dense Fog Advisory", severity: "Minor" },
      { event: "Dense Smoke Advisory", severity: "Minor" },
      { event: "Air Quality Alert", severity: "Moderate" },
      { event: "Low Water Advisory", severity: "Minor" },
    ],
  },
  {
    label: "Dust",
    options: [
      { event: "Dust Storm Warning", severity: "Extreme" },
      { event: "Blowing Dust Advisory", severity: "Moderate" },
    ],
  },
  {
    label: "Coastal / Marine",
    options: [
      { event: "Storm Surge Warning", severity: "Extreme" },
      { event: "Storm Surge Watch", severity: "Severe" },
      { event: "Tsunami Warning", severity: "Extreme" },
      { event: "Tsunami Watch", severity: "Severe" },
      { event: "Tsunami Advisory", severity: "Moderate" },
      { event: "High Surf Warning", severity: "Severe" },
      { event: "High Surf Advisory", severity: "Moderate" },
      { event: "Rip Current Statement", severity: "Minor" },
      { event: "Special Marine Warning", severity: "Severe" },
    ],
  },
  {
    label: "Volcanic / Geologic",
    options: [
      { event: "Volcano Warning", severity: "Extreme" },
      { event: "Ashfall Warning", severity: "Extreme" },
      { event: "Ashfall Advisory", severity: "Moderate" },
      { event: "Debris Flow Warning", severity: "Extreme" },
      { event: "Avalanche Warning", severity: "Extreme" },
      { event: "Avalanche Watch", severity: "Severe" },
      { event: "Avalanche Advisory", severity: "Moderate" },
      { event: "Earthquake Warning", severity: "Extreme" },
      { event: "Earthquake Advisory", severity: "Moderate" },
      { event: "Aftershock Advisory", severity: "Minor" },
    ],
  },
  {
    label: "Evacuation",
    options: [
      { event: "Evacuation Immediate", severity: "Extreme" },
      { event: "Evacuation Warning", severity: "Severe" },
      { event: "Evacuation Watch", severity: "Moderate" },
    ],
  },
  {
    label: "Civil / Government",
    options: [
      { event: "Civil Emergency Message", severity: "Extreme" },
      { event: "Shelter In Place Warning", severity: "Extreme" },
      { event: "Child Abduction Emergency", severity: "Extreme" },
      { event: "Blue Alert", severity: "Extreme" },
      { event: "Law Enforcement Warning", severity: "Severe" },
      { event: "Nuclear Power Plant Warning", severity: "Extreme" },
      { event: "911 Telephone Outage Emergency", severity: "Severe" },
      { event: "Emergency Action Notification", severity: "Extreme" },
      { event: "Administrative Message", severity: "Minor" },
    ],
  },
  { label: "General", options: [{ event: "Special Weather Statement", severity: "Minor" }] },
];

export const ASTEROID_SENTINEL = "__ASTEROID__";

export function buildDemoAlert(event: string, severity: string): NormalizedAlert {
  const now = new Date();
  const end = new Date(now.getTime() + 6 * 3_600_000);
  const headline = `${event} in effect`;
  const description = `This is a demo alert for testing the Silver Skies alert display. Event: ${event}. Severity: ${severity}.`;
  const cls = alertClass(event, severity, headline, description);
  return {
    id: `demo:${event}:${now.getTime()}`,
    source: "nws",
    event,
    displayEvent: getDisplayEvent(event, cls),
    cssClass: cls,
    headline,
    description,
    instruction: "This is a simulated alert for UI testing purposes only.",
    severity,
    areaDesc: "Demo County, Test State",
    onset: now.toISOString(),
    expires: end.toISOString(),
  };
}

export function buildAsteroidAlert(impactInMs: number): NormalizedAlert {
  const now = new Date();
  return {
    id: `demo:asteroid:${now.getTime()}`,
    source: "nws",
    event: "Asteroid Impact Warning",
    displayEvent: "Asteroid Impact Warning",
    cssClass: "alert-asteroid",
    severity: "Extreme",
    headline: "ASTEROID IMPACT IMMINENT — SEEK SHELTER IMMEDIATELY",
    description:
      "THE NATIONAL EMERGENCY ALERT SYSTEM HAS CONFIRMED THAT A NEAR-EARTH OBJECT OF CATASTROPHIC SIZE IS ON A COLLISION COURSE WITH EARTH. IMPACT IS PROJECTED IN APPROXIMATELY 60 SECONDS.\n\nTHIS IS NOT A TEST. THIS IS NOT A DRILL.\n\nCIVIL AUTHORITIES URGE ALL CITIZENS TO CEASE NORMAL ACTIVITIES IMMEDIATELY. THERE IS NO SHELTER THAT CAN GUARANTEE SURVIVAL FROM A DIRECT IMPACT EVENT OF THIS MAGNITUDE.\n\nWE ASK THAT YOU SPEND THESE FINAL MOMENTS WITH THE PEOPLE YOU LOVE. CALL SOMEONE. HOLD SOMEONE. TELL THEM WHAT THEY MEAN TO YOU.\n\nWE ARE GRATEFUL FOR EVERY MOMENT WE HAVE HAD ON THIS BEAUTIFUL PLANET. GODSPEED TO YOU ALL.\n\n— National Emergency Coordination Center",
    instruction: "Locate loved ones. Make peace. 🌍",
    areaDesc: "The Entire Earth",
    onset: now.toISOString(),
    expires: new Date(now.getTime() + impactInMs).toISOString(),
  };
}
