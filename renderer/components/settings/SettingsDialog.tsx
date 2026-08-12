"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useSettings } from "@/hooks/useSettings";
import { DevToolsPanel } from "./DevToolsPanel";
import type { NormalizedAlert } from "@/types/alerts";
import type { ThemePref, TimeFormatPref, UnitPref, WeatherProviderId } from "@/types/settings";

const REFRESH_OPTIONS = [
  { label: "5M", value: 5 },
  { label: "15M", value: 15 },
  { label: "30M", value: 30 },
  { label: "1H", value: 60 },
  { label: "2H", value: 120 },
  { label: "OFF", value: 0 },
];

export interface SettingsDialogProps {
  demoAlerts: NormalizedAlert[];
  onDemoAlertsChange: (alerts: NormalizedAlert[]) => void;
  onTriggerAsteroid: () => void;
  asteroidActive: boolean;
}

export function SettingsDialog({
  demoAlerts,
  onDemoAlertsChange,
  onTriggerAsteroid,
  asteroidActive,
}: SettingsDialogProps) {
  const { config, updateConfig } = useSettings();
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [willyWeatherKeyDraft, setWillyWeatherKeyDraft] = useState("");
  const [hostDraft, setHostDraft] = useState("");

  useEffect(() => {
    setApiKeyDraft(config?.accuWeatherApiKey ?? "");
    setWillyWeatherKeyDraft(config?.willyWeatherApiKey ?? "");
    setHostDraft(config?.libreWxrHost ?? "https://api.librewxr.net");
  }, [config?.accuWeatherApiKey, config?.willyWeatherApiKey, config?.libreWxrHost]);

  if (!config) return null;

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" className="w-full justify-start gap-2">
            <i className="ph ph-gear" aria-hidden="true" />
            Settings
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] overflow-y-auto thin-scroll rounded-none sm:max-w-lg" initialFocus={false}>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Weather provider, units, appearance, and refresh behavior.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <div className="settings-bar-section">
            <div className="settings-bar-label">WEATHER PROVIDER</div>
            <div className="settings-bar-group">
              {(["open-meteo", "accuweather"] as WeatherProviderId[]).map((p) => (
                <button
                  key={p}
                  className={`unit-btn ${config.provider === p ? "active" : ""}`}
                  onClick={() => updateConfig({ provider: p })}
                >
                  {p === "open-meteo" ? "Open-Meteo" : "AccuWeather"}
                </button>
              ))}
            </div>
            {config.provider === "accuweather" && (
              <div className="mt-2 flex flex-col gap-1.5">
                <Label htmlFor="accu-key" className="settings-bar-label">
                  ACCUWEATHER API KEY
                </Label>
                <input
                  id="accu-key"
                  className="search-input"
                  type="password"
                  placeholder="Paste your AccuWeather API key"
                  value={apiKeyDraft}
                  onChange={(e) => setApiKeyDraft(e.target.value)}
                  onBlur={() => updateConfig({ accuWeatherApiKey: apiKeyDraft.trim() || null })}
                />
                <p className="font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
                  Stored locally in config.json — never sent anywhere but AccuWeather. Get a free key at{" "}
                  developer.accuweather.com.
                </p>
              </div>
            )}
          </div>

          <div className="settings-bar-section">
            <div className="settings-bar-label">TEMPERATURE</div>
            <div className="settings-bar-group">
              {(["F", "C"] as UnitPref[]).map((u) => (
                <button key={u} className={`unit-btn ${config.units === u ? "active" : ""}`} onClick={() => updateConfig({ units: u })}>
                  °{u}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-bar-section">
            <div className="settings-bar-label">TIME</div>
            <div className="settings-bar-group">
              {(["12", "24"] as TimeFormatPref[]).map((t) => (
                <button key={t} className={`unit-btn ${config.timeFormat === t ? "active" : ""}`} onClick={() => updateConfig({ timeFormat: t })}>
                  {t}H
                </button>
              ))}
            </div>
          </div>

          <div className="settings-bar-section">
            <div className="settings-bar-label">THEME</div>
            <div className="settings-bar-group">
              {([
                { value: "system", label: "⚙ SYS" },
                { value: "light", label: "☀ LIGHT" },
                { value: "dark", label: "🌙 DARK" },
              ] as { value: ThemePref; label: string }[]).map((opt) => (
                <button key={opt.value} className={`unit-btn ${config.theme === opt.value ? "active" : ""}`} onClick={() => updateConfig({ theme: opt.value })}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-bar-section">
            <div className="settings-bar-label">AUTO-REFRESH</div>
            <div className="settings-bar-group">
              {REFRESH_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`unit-btn ${config.autoRefreshMinutes === opt.value ? "active" : ""}`}
                  onClick={() => updateConfig({ autoRefreshMinutes: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-bar-section">
            <div className="settings-bar-label">NOTIFICATIONS</div>
            <div className="settings-bar-group">
              <button
                className={`unit-btn ${config.notificationsEnabled ? "active" : ""}`}
                onClick={() => updateConfig({ notificationsEnabled: true })}
              >
                ON
              </button>
              <button
                className={`unit-btn ${!config.notificationsEnabled ? "active" : ""}`}
                onClick={() => updateConfig({ notificationsEnabled: false })}
              >
                OFF
              </button>
            </div>
            <p className="font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
              Desktop toasts for new alerts, notable next-day forecasts, and heads-up severe weather —
              checked across all of your saved locations, not just the one on screen.
            </p>
          </div>

          <div className="settings-bar-section">
            <div className="settings-bar-label">WILLYWEATHER API KEY (BOM WARNINGS)</div>
            <input
              id="willyweather-key"
              className="search-input"
              type="password"
              placeholder="Paste your WillyWeather API key"
              value={willyWeatherKeyDraft}
              onChange={(e) => setWillyWeatherKeyDraft(e.target.value)}
              onBlur={() => updateConfig({ willyWeatherApiKey: willyWeatherKeyDraft.trim() || null })}
            />
            <p className="font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
              Stored locally in config.json — never sent anywhere but WillyWeather. Powers Australian BOM
              warnings/alerts for locations in Australia. No documented free tier — get a key at
              willyweather.com.au/info/api.html. Left blank, BOM alerts are simply skipped.
            </p>
          </div>

          <div className="settings-bar-section">
            <div className="settings-bar-label">LIBREWXR RADAR HOST</div>
            <input
              className="search-input"
              value={hostDraft}
              onChange={(e) => setHostDraft(e.target.value)}
              onBlur={() => updateConfig({ libreWxrHost: hostDraft.trim() || "https://api.librewxr.net" })}
            />
            <p className="font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
              Defaults to the public instance. Point this at your own self-hosted LibreWXR server if you run one.
            </p>
          </div>

          <DevToolsPanel
            demoAlerts={demoAlerts}
            onDemoAlertsChange={onDemoAlertsChange}
            onTriggerAsteroid={onTriggerAsteroid}
            asteroidActive={asteroidActive}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
