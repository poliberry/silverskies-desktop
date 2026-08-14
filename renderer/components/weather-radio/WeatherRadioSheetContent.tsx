"use client";

import { useState } from "react";
import { SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useSettings } from "@/hooks/useSettings";
import { useNearestNwrFeed } from "@/hooks/useNearestNwrFeed";
import { synthesizeSameAttentionTone } from "@/lib/weather-radio/same-tone";
import { speakAlert } from "@/lib/weather-radio/tts";
import { LiveStreamPlayer } from "./LiveStreamPlayer";
import type { NormalizedAlert } from "@/types/alerts";
import type { WindowLocation } from "@/types/windows";

const TEST_ALERT: NormalizedAlert = {
  id: "weather-radio-test",
  source: "nws",
  event: "Test Alert",
  displayEvent: "Weather Radio Test",
  cssClass: "alert-unknown",
  headline: "This is a test of the Silver Skies weather radio feature",
  description: "No action is required. This was only a test of the simulated attention tone and speech synthesis.",
};

export interface WeatherRadioSheetContentProps {
  location: WindowLocation | null;
}

/** The toolbar's "Weather Radio" panel — status, a hands-on test of the
 * simulated tone + speech pipeline, and (live mode only) the actual stream
 * player with its best-effort decoded SAME metadata. In "auto" live-feed
 * mode, resolves and plays the nearest confirmed-live public NWR relay to
 * the active location instead of a manually-entered URL — see
 * lib/weather-radio/nwr-directory.ts. */
export function WeatherRadioSheetContent({ location }: WeatherRadioSheetContentProps) {
  const { config } = useSettings();
  const [testing, setTesting] = useState(false);

  const liveActive = Boolean(config?.weatherRadioEnabled) && config?.weatherRadioMode === "live";
  const autoMode = (config?.weatherRadioLiveFeedMode ?? "auto") === "auto";
  const nearest = useNearestNwrFeed(location, liveActive && autoMode);
  const streamUrl = autoMode ? (nearest.data?.feed.streamUrl ?? null) : (config?.weatherRadioLiveStreamUrl ?? null);

  async function runTest() {
    setTesting(true);
    const ctx = new AudioContext();
    try {
      await synthesizeSameAttentionTone(ctx, 3);
      await speakAlert(TEST_ALERT);
    } finally {
      void ctx.close();
      setTesting(false);
    }
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>Weather Radio</SheetTitle>
        <SheetDescription>
          {config?.weatherRadioEnabled
            ? `Enabled — ${config.weatherRadioMode === "live" ? "live stream" : "simulated tone + speech"} mode.`
            : "Disabled — turn it on in Settings → Radio."}
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-4 px-4">
        <button className="unit-btn" disabled={testing} onClick={() => void runTest()}>
          {testing ? "Playing…" : "Test Tone + TTS"}
        </button>
        {liveActive && autoMode && nearest.isLoading && (
          <p className="font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
            Looking up the nearest public feed…
          </p>
        )}
        {liveActive && autoMode && nearest.data && (
          <p className="font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
            Tuned to {nearest.data.feed.city}, {nearest.data.feed.state} ({nearest.data.feed.callsign}) —{" "}
            {Math.round(nearest.data.distanceKm)} km away.
          </p>
        )}
        {liveActive && streamUrl && <LiveStreamPlayer streamUrl={streamUrl} />}
        {liveActive && !streamUrl && !nearest.isLoading && (
          <p className="font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
            {autoMode
              ? "No public feed could be resolved for this location — try Settings → Radio → Manual URL."
              : "Add a live stream URL in Settings → Radio to start listening."}
          </p>
        )}
      </div>
    </>
  );
}
