"use client";

export interface WindCompassProps {
  /** Meteorological convention: direction the wind is blowing *from*,
   * 0/360 = north. The needle is drawn pointing that way, matching the
   * compass rose you'd read on a station model. */
  directionDeg: number;
  loading?: boolean;
}

/** A small compass with a needle that rotates to the current wind direction
 * and pulses continuously — "animated" here means the needle itself
 * transitions/pulses on screen, not that the underlying reading streams in
 * real time (it's Open-Meteo's current conditions, refetched every few
 * minutes like the rest of the app's wind data). */
export function WindCompass({ directionDeg, loading }: WindCompassProps) {
  return (
    <div className="wind-compass" aria-hidden="true">
      <div
        className={`wind-compass-needle${loading ? " is-loading" : ""}`}
        style={{ transform: `rotate(${directionDeg}deg)` }}
      />
    </div>
  );
}
