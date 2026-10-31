"use client";

import { useRef, useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { NOTIFICATION_SOUNDS, playNotificationSound } from "@/lib/notifications/sounds";
import { clearCustomSound, getCustomSound, setCustomSound, type SoundTier } from "@/lib/notifications/custom-sounds";
import { notifyAlert } from "@/lib/notifications/dispatch";
import { buildDemoAlert } from "@/lib/alerts/demo";
import type { NotificationSoundId } from "@/types/settings";
import type { WindowLocation } from "@/types/windows";

export interface NotificationsPanelProps {
  /** Used as the location on test notifications. */
  location: WindowLocation | null;
}

const hint = "font-mono text-[0.68rem]";

/** Settings → Notifications: on/off, the Severe/Extreme pop-up, per-tier
 * sounds (built-in or a custom file), volume, and test buttons. */
export function NotificationsPanel({ location }: NotificationsPanelProps) {
  const { config, updateConfig } = useSettings();
  if (!config) return null;

  const volume = config.notificationVolume ?? 0.8;
  const testLabel = location?.label ?? "Test location";

  return (
    <div className="flex flex-col gap-5">
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
        <p className={hint} style={{ color: "var(--text3)" }}>
          New alerts for the location on screen and every saved location, plus heads-ups for notable
          forecasts. Advisories, watches, and other alerts below Severe arrive as regular desktop notifications.
        </p>
      </div>

      <div className="settings-bar-section">
        <div className="settings-bar-label">SEVERE &amp; EXTREME POP-UPS</div>
        <div className="settings-bar-group">
          <button
            className={`unit-btn ${config.alertPopupsEnabled ? "active" : ""}`}
            onClick={() => updateConfig({ alertPopupsEnabled: true })}
          >
            ON
          </button>
          <button
            className={`unit-btn ${!config.alertPopupsEnabled ? "active" : ""}`}
            onClick={() => updateConfig({ alertPopupsEnabled: false })}
          >
            OFF
          </button>
        </div>
        <p className={hint} style={{ color: "var(--text3)" }}>
          Severe and Extreme alerts open a card that stays on top of every other window — even full-screen
          apps — until you dismiss it. Extreme alerts keep sounding until acknowledged (up to two minutes).
          Off sends them as regular notifications instead, still with the severe sound.
        </p>
      </div>

      <SoundPicker
        tier="advisory"
        label="ADVISORY SOUND"
        description="Regular notifications — advisories, watches, statements, forecast heads-ups."
        value={config.notificationSoundAdvisory ?? "chime"}
        volume={volume}
        onChange={(id) => updateConfig({ notificationSoundAdvisory: id })}
      />
      <SoundPicker
        tier="severe"
        label="SEVERE ALERT SOUND"
        description="Severe and Extreme alert pop-ups."
        value={config.notificationSoundSevere ?? "attention"}
        volume={volume}
        onChange={(id) => updateConfig({ notificationSoundSevere: id })}
      />

      <div className="settings-bar-section">
        <div className="settings-bar-label">VOLUME · {Math.round(volume * 100)}%</div>
        <Slider
          className="max-w-xs"
          min={0}
          max={100}
          value={[Math.round(volume * 100)]}
          onValueChange={(v) => updateConfig({ notificationVolume: (Array.isArray(v) ? v[0] : v) / 100 })}
        />
      </div>

      <div className="settings-bar-section">
        <div className="settings-bar-label">TRY IT</div>
        <div className="settings-bar-group">
          <button
            className="unit-btn"
            style={{ borderRadius: "var(--radius)" }}
            onClick={() =>
              notifyAlert({ ...buildDemoAlert("Winter Weather Advisory", "Moderate"), id: `test:${Date.now()}` }, testLabel, config, {
                isTest: true,
              })
            }
          >
            <i className="ph ph-bell-simple" aria-hidden="true" style={{ marginRight: 4 }} />
            Test advisory
          </button>
          <button
            className="unit-btn"
            style={{ borderRadius: "var(--radius)" }}
            onClick={() =>
              notifyAlert({ ...buildDemoAlert("Severe Thunderstorm Warning", "Severe"), id: `test:${Date.now()}` }, testLabel, config, {
                isTest: true,
              })
            }
          >
            <i className="ph ph-warning" aria-hidden="true" style={{ marginRight: 4 }} />
            Test severe
          </button>
          <button
            className="unit-btn"
            style={{ borderRadius: "var(--radius)" }}
            onClick={() =>
              notifyAlert({ ...buildDemoAlert("Tornado Warning", "Extreme"), id: `test:${Date.now()}` }, testLabel, config, {
                isTest: true,
              })
            }
          >
            <i className="ph ph-siren" aria-hidden="true" style={{ marginRight: 4 }} />
            Test extreme
          </button>
        </div>
        <p className={hint} style={{ color: "var(--text3)" }}>
          Test alerts are clearly labelled and only sound once.
        </p>
      </div>
    </div>
  );
}

function SoundPicker({
  tier,
  label,
  description,
  value,
  volume,
  onChange,
}: {
  tier: SoundTier;
  label: string;
  description: string;
  value: NotificationSoundId;
  volume: number;
  onChange: (id: NotificationSoundId) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [customName, setCustomName] = useState(() => getCustomSound(tier)?.name ?? null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const sound = await setCustomSound(tier, file);
      setCustomName(sound.name);
      onChange("custom");
      playNotificationSound("custom", tier, volume);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't use that file.");
    }
  }

  return (
    <div className="settings-bar-section">
      <div className="settings-bar-label">{label}</div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={value}
          onValueChange={(v) => {
            const id = v as NotificationSoundId;
            // Picking "Custom file…" with nothing saved yet goes straight to
            // the file picker instead of selecting an empty custom sound.
            if (id === "custom" && !customName) {
              fileInput.current?.click();
              return;
            }
            onChange(id);
            playNotificationSound(id, tier, volume);
          }}
        >
          <SelectTrigger size="sm" className="min-w-48">
            <SelectValue>
              {(v: string) =>
                v === "custom" && customName
                  ? `Custom · ${customName}`
                  : (NOTIFICATION_SOUNDS.find((s) => s.id === v)?.label ?? v)
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {NOTIFICATION_SOUNDS.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.id === "custom" && customName ? `Custom · ${customName}` : s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          className="unit-btn"
          style={{ borderRadius: "var(--radius)" }}
          onClick={() => playNotificationSound(value, tier, volume)}
          disabled={value === "none"}
          title="Preview"
          aria-label="Preview sound"
        >
          <i className="ph ph-play" aria-hidden="true" />
        </button>
        <button
          className="unit-btn"
          style={{ borderRadius: "var(--radius)" }}
          onClick={() => fileInput.current?.click()}
          title="Use your own audio file"
        >
          <i className="ph ph-upload-simple" aria-hidden="true" style={{ marginRight: 4 }} />
          {customName ? "Replace file" : "Upload"}
        </button>
        {customName && (
          <button
            className="unit-btn"
            style={{ borderRadius: "var(--radius)" }}
            onClick={() => {
              clearCustomSound(tier);
              setCustomName(null);
              if (value === "custom") onChange(tier === "severe" ? "attention" : "chime");
            }}
            title="Remove custom file"
            aria-label="Remove custom file"
          >
            <i className="ph ph-trash" aria-hidden="true" />
          </button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      <p className={hint} style={{ color: error ? "var(--danger)" : "var(--text3)" }}>
        {error ?? description}
      </p>
    </div>
  );
}
