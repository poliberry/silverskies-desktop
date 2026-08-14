"use client";

import { useState } from "react";
import { SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useSettings } from "@/hooks/useSettings";
import { synthesizeSameAttentionTone } from "@/lib/weather-radio/same-tone";
import { speakAlert } from "@/lib/weather-radio/tts";
import { LiveStreamPlayer } from "./LiveStreamPlayer";
import type { NormalizedAlert } from "@/types/alerts";

const TEST_ALERT: NormalizedAlert = {
  id: "weather-radio-test",
  source: "nws",
  event: "Test Alert",
  displayEvent: "Weather Radio Test",
  cssClass: "alert-unknown",
  headline: "This is a test of the Silver Skies weather radio feature",
  description: "No action is required. This was only a test of the simulated attention tone and speech synthesis.",
};

/** The toolbar's "Weather Radio" panel — status, a hands-on test of the
 * simulated tone + speech pipeline, and (live mode only) the actual stream
 * player with its best-effort decoded SAME metadata. */
export function WeatherRadioSheetContent() {
  const { config } = useSettings();
  const [testing, setTesting] = useState(false);

  async function runTest() {
    setTesting(true);
    const ctx = new AudioContext();
    try {
      await synthesizeSameAttentionTone(ctx, 3);
      speakAlert(TEST_ALERT);
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
        {config?.weatherRadioEnabled && config.weatherRadioMode === "live" && config.weatherRadioLiveStreamUrl && (
          <LiveStreamPlayer streamUrl={config.weatherRadioLiveStreamUrl} />
        )}
        {config?.weatherRadioEnabled && config.weatherRadioMode === "live" && !config.weatherRadioLiveStreamUrl && (
          <p className="font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
            Add a live stream URL in Settings → Radio to start listening.
          </p>
        )}
      </div>
    </>
  );
}
