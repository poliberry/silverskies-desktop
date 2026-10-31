"use client";

import { useEffect, useState } from "react";
import { WindowControlButtons } from "@/components/layout/WindowControlButtons";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useSettings } from "@/hooks/useSettings";
import { useNwrFeedCandidates } from "@/hooks/useNwrFeedCandidates";
import { synthesizeSameAttentionTone } from "@/lib/weather-radio/same-tone";
import { speakAlert } from "@/lib/weather-radio/tts";
import { CustomAudioPlayer, type AudioCandidate } from "@/components/weather-radio/CustomAudioPlayer";
import { ipc } from "@/lib/ipc-client";
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

export interface WeatherRadioWindowProps {
  initialLocation: WindowLocation | null;
}

/**
 * A standalone Weather Radio window — tracks the main window's own active
 * location (paired to the "main" sentinel instanceId, the same relay
 * ConditionsWindow/AuditLogWindow use when popped out of main) rather than
 * a specific radar instance, since there's only ever one of these. The
 * actual tone+speech "new alert" watcher (useWeatherRadio) keeps running in
 * Shell regardless of whether this window is open — this is purely a
 * status/control/live-playback surface, opened via the toolbar's Weather
 * Radio button.
 */
export function WeatherRadioWindow({ initialLocation }: WeatherRadioWindowProps) {
  const [location, setLocation] = useState<WindowLocation | null>(initialLocation);
  const { config } = useSettings();
  const [testing, setTesting] = useState(false);

  useEffect(() => ipc.windows.onInstanceLocation(setLocation), []);

  useDocumentTitle("Weather Radio - Silver Skies");

  const liveActive = Boolean(config?.weatherRadioEnabled) && config?.weatherRadioMode === "live";
  const autoMode = (config?.weatherRadioLiveFeedMode ?? "auto") === "auto";
  const candidatesQuery = useNwrFeedCandidates(location, liveActive && autoMode);

  const candidates: AudioCandidate[] = autoMode
    ? (candidatesQuery.data ?? []).map((c) => ({ url: c.feed.streamUrl, label: `${c.feed.city}, ${c.feed.state}` }))
    : config?.weatherRadioLiveStreamUrl
      ? [{ url: config.weatherRadioLiveStreamUrl, label: "Manual feed" }]
      : [];

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
    <div className="flex h-screen flex-col" style={{ background: "var(--bg)" }}>
      <div
        className="drag-region flex items-center justify-between gap-2 font-mono text-xs"
        style={{ padding: "3px 8px", color: "var(--text2)" }}
      >
        <span className="truncate">Weather Radio</span>
        <WindowControlButtons iconSize={11} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        <div className="font-mono text-xs" style={{ color: "var(--text3)" }}>
          {config?.weatherRadioEnabled
            ? `Enabled — ${config.weatherRadioMode === "live" ? "live stream" : "simulated tone + speech"} mode.`
            : "Disabled — turn it on in Settings → Radio."}
        </div>

        <button className="unit-btn" disabled={testing} onClick={() => void runTest()}>
          {testing ? "Playing…" : "Test Tone + TTS"}
        </button>

        {liveActive && autoMode && candidatesQuery.isLoading && (
          <p className="font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
            Looking up nearby public feeds…
          </p>
        )}
        {liveActive && candidates.length > 0 && <CustomAudioPlayer candidates={candidates} />}
        {liveActive && candidates.length === 0 && !candidatesQuery.isLoading && (
          <p className="font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
            {autoMode
              ? "No public feed could be resolved for this location — try Settings → Radio → Manual URL."
              : "Add a live stream URL in Settings → Radio to start listening."}
          </p>
        )}
      </div>
    </div>
  );
}
