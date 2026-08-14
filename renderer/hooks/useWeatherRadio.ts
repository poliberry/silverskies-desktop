"use client";

import { useEffect, useRef } from "react";
import type { NormalizedAlert } from "@/types/alerts";
import { hasNotified, markNotified } from "@/lib/notifications/dedupe-store";
import { synthesizeSameAttentionTone } from "@/lib/weather-radio/same-tone";
import { speakAlert } from "@/lib/weather-radio/tts";

export interface UseWeatherRadioOptions {
  enabled: boolean;
  mode: "simulated" | "live";
  /** The alert set to watch for new arrivals — the active location's alerts
   * unioned with whatever's in the shift-drag bounding box, deduped by id.
   * Only used in "simulated" mode; "live" mode's audio comes from a real
   * stream instead (see LiveStreamPlayer). */
  alerts: NormalizedAlert[];
}

/**
 * Watches the currently active alert set for newly-appeared alerts and, in
 * "simulated" mode, plays the SAME attention tone followed by a spoken
 * reading of the alert — the NOAA Weather Radio experience, built from
 * alert data already in hand rather than decoding real audio.
 *
 * "Already seen" is tracked two ways: an in-memory id set so a pre-existing
 * alert never announces the moment the radio is enabled (only alerts that
 * arrive *after* that point count as "new"), and the same localStorage
 * dedupe store the toast-notification watcher uses (see
 * lib/notifications/dedupe-store.ts, keyed with a "radio:" prefix so the
 * two features don't share state) so an alert already announced doesn't
 * announce again after, say, a window reload.
 */
export function useWeatherRadio({ enabled, mode, alerts }: UseWeatherRadioOptions): void {
  const seenRef = useRef<Set<string> | null>(null);
  const idsKey = alerts.map((a) => a.id).join(",");

  useEffect(() => {
    if (!enabled || mode !== "simulated") return;

    if (seenRef.current === null) {
      // First run since the radio was enabled — seed with what's already
      // active instead of announcing every pre-existing alert in one burst.
      seenRef.current = new Set(alerts.map((a) => a.id));
      return;
    }

    const newAlerts = alerts.filter((a) => !seenRef.current!.has(a.id));
    for (const a of newAlerts) seenRef.current.add(a.id);
    const toAnnounce = newAlerts.filter((a) => !hasNotified(`radio:${a.id}`));
    if (toAnnounce.length === 0) return;

    let cancelled = false;
    void (async () => {
      for (const alert of toAnnounce) {
        if (cancelled) return;
        markNotified(`radio:${alert.id}`);
        const ctx = new AudioContext();
        try {
          await synthesizeSameAttentionTone(ctx);
          if (!cancelled) speakAlert(alert);
        } finally {
          void ctx.close();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on idsKey (a stable joined string) rather than the `alerts` array reference, which is a fresh array every render
  }, [enabled, mode, idsKey]);
}
