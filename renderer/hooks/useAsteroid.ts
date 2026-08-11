import { useCallback, useRef, useState } from "react";
import { buildAsteroidAlert } from "@/lib/alerts/demo";
import type { NormalizedAlert } from "@/types/alerts";

export interface UseAsteroidOptions {
  onDemoAlertsChange: (alerts: NormalizedAlert[]) => void;
  onForcePulse: (color: string | null) => void;
  onRefreshWeather: () => void;
}

/** Ported from the original app's triggerAsteroid()/detonateAsteroid() —
 * the "Asteroid Impact Warning" easter egg: a fake 60-second countdown
 * that shakes the window, pulses red, then "detonates" before resetting. */
export function useAsteroid({ onDemoAlertsChange, onForcePulse, onRefreshWeather }: UseAsteroidOptions) {
  const [isActive, setIsActive] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const detonate = useCallback(() => {
    document.body.classList.remove("asteroid-shaking", "asteroid-shaking-violent");
    document.body.style.animationDuration = "";
    document.body.classList.add("exploding");

    if (navigator.vibrate) {
      navigator.vibrate([500, 50, 300, 50, 200, 50, 500, 30, 100, 30, 100, 30, 100, 30, 100, 30, 800]);
    }

    setTimeout(() => {
      document.body.classList.remove("exploding");
      document.body.removeAttribute("style");
      onDemoAlertsChange([]);
      onForcePulse(null);
      setIsActive(false);
      onRefreshWeather();
    }, 1400);
  }, [onDemoAlertsChange, onForcePulse, onRefreshWeather]);

  const trigger = useCallback(() => {
    if (timerRef.current) return;

    onDemoAlertsChange([buildAsteroidAlert(60_000)]);
    onForcePulse("#ff2200");
    document.body.classList.add("asteroid-shaking");
    setIsActive(true);
    setSecondsLeft(60);

    let seconds = 60;
    timerRef.current = setInterval(() => {
      seconds -= 1;
      setSecondsLeft(seconds);
      if (seconds <= 5 && seconds > 0) {
        // Brace for impact — swap to the violent shake entirely (rather
        // than layering it) so the two animations don't fight over
        // `transform`, and clear the inline animation-duration override
        // from the tiers below so the violent class's own 0.08s wins.
        document.body.classList.remove("asteroid-shaking");
        document.body.style.animationDuration = "";
        document.body.classList.add("asteroid-shaking-violent");
        if (navigator.vibrate) navigator.vibrate([120, 20]);
      } else if (seconds <= 10) {
        document.body.style.animationDuration = "0.15s";
        if (navigator.vibrate) navigator.vibrate([80, 40]);
      } else if (seconds <= 30) {
        document.body.style.animationDuration = "0.25s";
        if (seconds % 2 === 0 && navigator.vibrate) navigator.vibrate([40, 60]);
      } else if (seconds % 5 === 0 && navigator.vibrate) {
        navigator.vibrate(20);
      }
      if (seconds <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        detonate();
      }
    }, 1000);
  }, [detonate, onDemoAlertsChange, onForcePulse]);

  return { trigger, isActive, secondsLeft };
}
