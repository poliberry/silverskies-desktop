// Ported from the original app's sun-arc math in renderAll(): a quadratic
// Bézier from sunrise to sunset, with the "now" dot placed by elapsed-time
// fraction along the same curve the arc itself is drawn with.
const P0: [number, number] = [10, 100];
const P1: [number, number] = [150, -10];
const P2: [number, number] = [290, 100];
const ARC_LENGTH = 390;

export interface SunArcPosition {
  pct: number;
  dashOffset: number;
  cx: number;
  cy: number;
  daylightHours: number;
  daylightMinutes: number;
}

export function computeSunArc(sunriseIso: string, sunsetIso: string, now: Date = new Date()): SunArcPosition {
  const sunrise = new Date(sunriseIso).getTime();
  const sunset = new Date(sunsetIso).getTime();
  const totalMs = sunset - sunrise;
  const elapsed = Math.min(Math.max(now.getTime() - sunrise, 0), Math.max(totalMs, 0));
  const pct = totalMs > 0 ? elapsed / totalMs : 0;
  const t = pct;
  const cx = (1 - t) ** 2 * P0[0] + 2 * (1 - t) * t * P1[0] + t ** 2 * P2[0];
  const cy = (1 - t) ** 2 * P0[1] + 2 * (1 - t) * t * P1[1] + t ** 2 * P2[1];
  return {
    pct,
    dashOffset: ARC_LENGTH - pct * ARC_LENGTH,
    cx,
    cy,
    daylightHours: Math.floor(totalMs / 3_600_000),
    daylightMinutes: Math.floor((totalMs % 3_600_000) / 60_000),
  };
}
