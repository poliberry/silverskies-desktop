// Routes a notification to the right surface:
//
//  - Severe / Extreme alerts → an always-on-top pop-up window (which plays
//    the "severe" sound itself, and keeps repeating it for Extreme until
//    acknowledged — see AlertPopupWindow).
//  - Everything else (Moderate/Minor/unknown-severity alerts, forecast
//    heads-ups) → a regular OS notification, silent at the OS level, with
//    the "advisory" sound played here instead.
//
// Pop-ups fall back to a toast (with the severe sound) when the user has
// turned pop-ups off in Settings → Notifications.

import { ipc } from "@/lib/ipc-client";
import type { ConfigFile } from "@/types/settings";
import type { NormalizedAlert } from "@/types/alerts";
import { playNotificationSound } from "./sounds";

export type AlertTier = "popup" | "toast";

export function alertTier(alert: Pick<NormalizedAlert, "severity">): AlertTier {
  return alert.severity === "Extreme" || alert.severity === "Severe" ? "popup" : "toast";
}

type SoundConfig = Pick<
  ConfigFile,
  "alertPopupsEnabled" | "notificationSoundAdvisory" | "notificationSoundSevere" | "notificationVolume"
>;

// Several toasts can land in the same watcher pass — one sound for the
// batch, not a pile-up.
let lastAdvisorySoundAt = 0;
function playAdvisorySound(config: SoundConfig | null | undefined) {
  const now = Date.now();
  if (now - lastAdvisorySoundAt < 3000) return;
  lastAdvisorySoundAt = now;
  playNotificationSound(config?.notificationSoundAdvisory ?? "chime", "advisory", config?.notificationVolume ?? 0.8);
}

export function notifyToast(title: string, body: string, config: SoundConfig | null | undefined): void {
  void ipc.app.notify(title, body, { silent: true });
  playAdvisorySound(config);
}

export function notifyAlert(
  alert: NormalizedAlert,
  locationLabel: string,
  config: SoundConfig | null | undefined,
  opts: { isTest?: boolean } = {},
): void {
  const tier = alertTier(alert);
  if (tier === "popup" && (config?.alertPopupsEnabled ?? true)) {
    void ipc.windows.openAlertPopup(alert.id, { alert, locationLabel, isTest: opts.isTest });
    return;
  }
  const title = `${tier === "popup" ? "🚨" : "⚠"} ${alert.displayEvent}`;
  const body = `${locationLabel} — ${alert.headline ?? alert.event}`;
  void ipc.app.notify(title, body, { silent: true });
  if (tier === "popup") {
    playNotificationSound(config?.notificationSoundSevere ?? "attention", "severe", config?.notificationVolume ?? 0.8);
  } else {
    playAdvisorySound(config);
  }
}
