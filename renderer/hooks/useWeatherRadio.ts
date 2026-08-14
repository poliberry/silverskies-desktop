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
    if (!enabled || mode !== "simulated") {
      // Reset so re-enabling (or switching back to "simulated") re-seeds
      // from what's active *then*, instead of immediately treating every
      // currently-active alert as newly arrived because the old seen-set
      // (from before this went inactive) no longer contains them.
      seenRef.current = null;
      return;
    }

    if (seenRef.current === null) {
      // First run since the radio was (re-)enabled — seed with what's
      // already active instead of announcing every pre-existing alert in
      // one burst.
      seenRef.current = new Set(alerts.map((a) => a.id));
      return;
    }

    const seen = seenRef.current;
    const newAlerts = alerts.filter((a) => !seen.has(a.id));
    for (const a of newAlerts) seen.add(a.id);
    const toAnnounce = newAlerts.filter((a) => !hasNotified(`radio:${a.id}`));
    if (toAnnounce.length === 0) return;

    let cancelled = false;
    void (async () => {
      // Only an alert that actually finished its tone + speech counts as
      // "announced" — tracked by index so the cleanup below knows exactly
      // which trailing alerts (interrupted mid-tone, mid-speech, or never
      // started at all) to un-mark as seen, regardless of *where* in the
      // loop this got cancelled.
      let completedThrough = -1;
      try {
        for (let i = 0; i < toAnnounce.length; i++) {
          if (cancelled) return;
          const alert = toAnnounce[i];
          const ctx = new AudioContext();
          try {
            await synthesizeSameAttentionTone(ctx);
            if (cancelled) return;
            // Awaited, not fired-and-forgotten — speakAlert's own
            // `cancel()` on the *next* call would otherwise cut this
            // alert's speech off mid-sentence the instant the next one in
            // the batch started.
            await speakAlert(alert);
          } finally {
            void ctx.close();
          }
          if (cancelled) return;
          // Marked persistently-notified only now, after it actually
          // finished playing — marking it beforehand (before the tone even
          // played) meant an interrupted tone left the alert both
          // unannounced *and* permanently unretriable.
          markNotified(`radio:${alert.id}`);
          completedThrough = i;
        }
      } finally {
        for (let i = completedThrough + 1; i < toAnnounce.length; i++) {
          seen.delete(toAnnounce[i].id);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on idsKey (a stable joined string) rather than the `alerts` array reference, which is a fresh array every render
  }, [enabled, mode, idsKey]);
}
