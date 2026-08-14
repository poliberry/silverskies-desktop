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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSettings } from "@/hooks/useSettings";
import { AboutPanel } from "./AboutPanel";
import { DevToolsPanel } from "./DevToolsPanel";
import { AlertTypesPanel } from "./AlertTypesPanel";
import { ThemesPanel } from "./ThemesPanel";
import type { NormalizedAlert } from "@/types/alerts";
import type { ThemePref, TimeFormatPref, UiModePref, UnitPref, WeatherProviderId } from "@/types/settings";

const REFRESH_OPTIONS = [
  { label: "5M", value: 5 },
  { label: "15M", value: 15 },
  { label: "30M", value: 30 },
  { label: "1H", value: 60 },
  { label: "2H", value: 120 },
  { label: "OFF", value: 0 },
];

const TAB_TRIGGER_CLASS = "font-mono text-[0.7rem] tracking-wider uppercase";

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
  const [owmKeyDraft, setOwmKeyDraft] = useState("");
  const [hostDraft, setHostDraft] = useState("");

  useEffect(() => {
    setApiKeyDraft(config?.accuWeatherApiKey ?? "");
    setWillyWeatherKeyDraft(config?.willyWeatherApiKey ?? "");
    setOwmKeyDraft(config?.openWeatherMapApiKey ?? "");
    setHostDraft(config?.libreWxrHost ?? "https://api.librewxr.net");
  }, [config?.accuWeatherApiKey, config?.willyWeatherApiKey, config?.openWeatherMapApiKey, config?.libreWxrHost]);

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

        <Tabs defaultValue="general">
          <TabsList variant="line" className="w-full justify-start border-b" style={{ borderColor: "var(--border)" }}>
            <TabsTrigger value="general" className={TAB_TRIGGER_CLASS}>
              General
            </TabsTrigger>
            <TabsTrigger value="sources" className={TAB_TRIGGER_CLASS}>
              Data Sources
            </TabsTrigger>
            <TabsTrigger value="alerts" className={TAB_TRIGGER_CLASS}>
              Alerts
            </TabsTrigger>
            <TabsTrigger value="themes" className={TAB_TRIGGER_CLASS}>
              Themes
            </TabsTrigger>
            <TabsTrigger value="developer" className={TAB_TRIGGER_CLASS}>
              Developer
            </TabsTrigger>
            <TabsTrigger value="about" className={TAB_TRIGGER_CLASS}>
              About
            </TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="flex flex-col gap-5 pt-4">
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
              <div className="settings-bar-label">INTERFACE</div>
              <div className="settings-bar-group">
                {(["classic", "advanced"] as UiModePref[]).map((m) => (
                  <button
                    key={m}
                    className={`unit-btn ${config.uiMode === m ? "active" : ""}`}
                    onClick={() => updateConfig({ uiMode: m })}
                  >
                    {m === "classic" ? "Classic" : "Advanced"}
                  </button>
                ))}
              </div>
              <p className="font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
                Classic is this single-window layout. Advanced adds a &quot;Pop Out&quot;/&quot;New Window&quot;
                pair next to the refresh button, letting you undock the radar into its own window — with a
                search bar and its own settings — and open as many independent radar and current-conditions
                windows as you like. Advanced mode also restores whichever radar/conditions windows you had
                open the next time you launch the app.
              </p>
            </div>

            <div className="settings-bar-section">
              <div className="settings-bar-label">TOP GLOW SWEEP</div>
              <div className="settings-bar-group">
                <button
                  className={`unit-btn ${config.topGlowEnabled ? "active" : ""}`}
                  onClick={() => updateConfig({ topGlowEnabled: true })}
                >
                  ON
                </button>
                <button
                  className={`unit-btn ${!config.topGlowEnabled ? "active" : ""}`}
                  onClick={() => updateConfig({ topGlowEnabled: false })}
                >
                  OFF
                </button>
              </div>
              <p className="font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
                The animated accent-colored sweep across the top edge of the main window (and its faster
                pulse during an active severe alert). Purely decorative — turn it off if it&apos;s
                distracting.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="sources" className="flex flex-col gap-5 pt-4">
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

            <div className="settings-bar-section">
              <div className="settings-bar-label">OPENWEATHERMAP API KEY (RADAR OVERLAYS)</div>
              <input
                id="owm-key"
                className="search-input"
                type="password"
                placeholder="Paste your OpenWeatherMap API key"
                value={owmKeyDraft}
                onChange={(e) => setOwmKeyDraft(e.target.value)}
                onBlur={() => updateConfig({ openWeatherMapApiKey: owmKeyDraft.trim() || null })}
              />
              <p className="font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
                Stored locally in config.json — never sent anywhere but OpenWeatherMap. Powers the Wind/
                Temp/Precip/AQI toggles on the radar (main window and every radar window). Free tier
                available at openweathermap.org/api. Left blank, those toggles are disabled.
              </p>
            </div>

            <div className="settings-bar-section">
              <div className="settings-bar-label">SPC DAY 1 OUTLOOK</div>
              <div className="settings-bar-group">
                <button
                  className={`unit-btn ${config.spcOutlookEnabled ? "active" : ""}`}
                  onClick={() => updateConfig({ spcOutlookEnabled: true })}
                >
                  ON
                </button>
                <button
                  className={`unit-btn ${!config.spcOutlookEnabled ? "active" : ""}`}
                  onClick={() => updateConfig({ spcOutlookEnabled: false })}
                >
                  OFF
                </button>
              </div>
              <p className="font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
                Shows the Storm Prediction Center&apos;s Day 1 Convective Outlook (Marginal/Slight/Enhanced/
                Moderate/High risk) as outlined areas on the radar, plus a banner in the alert log when your
                active location falls inside one. No key required. Until an on-radar Overlays button exists,
                this is the only toggle for the radar outline.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="alerts" className="pt-4">
            <AlertTypesPanel />
          </TabsContent>

          <TabsContent value="themes" className="pt-4">
            <ThemesPanel />
          </TabsContent>

          <TabsContent value="developer" className="pt-4">
            <DevToolsPanel
              demoAlerts={demoAlerts}
              onDemoAlertsChange={onDemoAlertsChange}
              onTriggerAsteroid={onTriggerAsteroid}
              asteroidActive={asteroidActive}
            />
          </TabsContent>

          <TabsContent value="about" className="pt-4">
            <AboutPanel />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
