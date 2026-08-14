"use client";

import { useEffect, useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { useNearestNwrFeed } from "@/hooks/useNearestNwrFeed";
import type { WindowLocation } from "@/types/windows";

const FAR_FEED_KM = 320; // ~200mi — beyond this, the "nearest" feed found is unlikely to be locally relevant

export interface WeatherRadioPanelProps {
  /** The active location — used only for the "Auto" live-feed preview
   * below, so this panel can show which public relay would actually be
   * used without the user having to open the toolbar Sheet first. */
  location: WindowLocation | null;
}

/** Settings -> Radio: enable/mode/live-feed-source for the NWS weather radio
 * easter feature (see hooks/useWeatherRadio.ts and lib/weather-radio/*). */
export function WeatherRadioPanel({ location }: WeatherRadioPanelProps) {
  const { config, updateConfig } = useSettings();
  const [streamUrlDraft, setStreamUrlDraft] = useState("");

  const autoPreviewEnabled =
    (config?.weatherRadioEnabled ?? false) &&
    config?.weatherRadioMode === "live" &&
    (config?.weatherRadioLiveFeedMode ?? "auto") === "auto";
  const nearest = useNearestNwrFeed(location, autoPreviewEnabled);

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
          already has — no real audio decoding involved. <strong>Live</strong> plays a real public NOAA
          Weather Radio relay stream and attempts to decode a real SAME header from it, purely for
          informational display.
        </p>
      </div>

      {config.weatherRadioMode === "live" && (
        <div className="settings-bar-section">
          <div className="settings-bar-label">LIVE FEED SOURCE</div>
          <div className="settings-bar-group">
            <button
              className={`unit-btn ${(config.weatherRadioLiveFeedMode ?? "auto") === "auto" ? "active" : ""}`}
              onClick={() => updateConfig({ weatherRadioLiveFeedMode: "auto" })}
            >
              Auto (nearest public feed)
            </button>
            <button
              className={`unit-btn ${config.weatherRadioLiveFeedMode === "manual" ? "active" : ""}`}
              onClick={() => updateConfig({ weatherRadioLiveFeedMode: "manual" })}
            >
              Manual URL
            </button>
          </div>

          {(config.weatherRadioLiveFeedMode ?? "auto") === "auto" ? (
            <p className="font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
              {nearest.isLoading && "Looking up the nearest public feed…"}
              {nearest.data && (
                <>
                  Nearest live public feed to your active location:{" "}
                  <strong>
                    {nearest.data.feed.city}, {nearest.data.feed.state}
                  </strong>{" "}
                  ({nearest.data.feed.callsign}) — {Math.round(nearest.data.distanceKm)} km away, relayed by{" "}
                  {nearest.data.feed.provider}.
                  {nearest.data.distanceKm > FAR_FEED_KM &&
                    " That's quite far — this location may not have a nearby volunteer relay yet."}
                </>
              )}
              {nearest.isError && "Couldn't reach the public feed directory — try Manual instead."}
              {" "}Sourced from noaaweatherradio.org&apos;s public relay directory (volunteer-run — coverage and
              reliability vary by area).
            </p>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
