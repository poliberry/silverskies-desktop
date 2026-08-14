"use client";

import { useEffect, useState } from "react";
import { useSettings } from "@/hooks/useSettings";

/** Settings -> Radio: enable/mode/live-stream-URL for the NWS weather radio
 * easter feature (see hooks/useWeatherRadio.ts and lib/weather-radio/*). */
export function WeatherRadioPanel() {
  const { config, updateConfig } = useSettings();
  const [streamUrlDraft, setStreamUrlDraft] = useState("");

  useEffect(() => {
    setStreamUrlDraft(config?.weatherRadioLiveStreamUrl ?? "");
  }, [config?.weatherRadioLiveStreamUrl]);

  if (!config) return null;

  return (
    <div className="flex flex-col gap-5">
      <div className="settings-bar-section">
        <div className="settings-bar-label">WEATHER RADIO</div>
        <div className="settings-bar-group">
          <button
            className={`unit-btn ${config.weatherRadioEnabled ? "active" : ""}`}
            onClick={() => updateConfig({ weatherRadioEnabled: true })}
          >
            ON
          </button>
          <button
            className={`unit-btn ${!config.weatherRadioEnabled ? "active" : ""}`}
            onClick={() => updateConfig({ weatherRadioEnabled: false })}
          >
            OFF
          </button>
        </div>
        <p className="font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
          Plays the classic NOAA Weather Radio two-tone attention signal, then reads new alerts aloud, for
          your active location and whatever&apos;s currently in view on the radar.
        </p>
      </div>

      <div className="settings-bar-section">
        <div className="settings-bar-label">MODE</div>
        <div className="settings-bar-group">
          <button
            className={`unit-btn ${config.weatherRadioMode === "simulated" ? "active" : ""}`}
            onClick={() => updateConfig({ weatherRadioMode: "simulated" })}
          >
            Simulated
          </button>
          <button
            className={`unit-btn ${config.weatherRadioMode === "live" ? "active" : ""}`}
            onClick={() => updateConfig({ weatherRadioMode: "live" })}
          >
            Live
          </button>
        </div>
        <p className="font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
          <strong>Simulated</strong> synthesizes the attention tone and speaks the alert text this app
          already has — no real audio decoding involved. <strong>Live</strong> plays a real audio stream you
          supply below and attempts to decode a real SAME header from it, purely for informational display;
          this app has no FIPS/county database, so a live stream can&apos;t be auto-filtered to your
          location — the stream URL itself is effectively how you pick your region for live mode.
        </p>
      </div>

      {config.weatherRadioMode === "live" && (
        <div className="settings-bar-section">
          <div className="settings-bar-label">LIVE STREAM URL</div>
          <input
            className="search-input"
            placeholder="https://example.com/your-noaa-weather-radio-relay"
            value={streamUrlDraft}
            onChange={(e) => setStreamUrlDraft(e.target.value)}
            onBlur={() => updateConfig({ weatherRadioLiveStreamUrl: streamUrlDraft.trim() || null })}
          />
          <p className="font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
            A direct audio stream URL — an internet-relayed NOAA Weather Radio feed, for instance. SAME
            decoding against a compressed relay is best-effort; if it can&apos;t fully parse a header,
            audio still plays normally.
          </p>
        </div>
      )}
    </div>
  );
}
