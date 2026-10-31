"use client";

import { useEffect, useRef, useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { useAppliedTheme } from "@/hooks/useAppliedTheme";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { ipc } from "@/lib/ipc-client";
import { issuedLabel, timeRemainingLabel, untilLabel } from "@/lib/alerts/format";
import { playNotificationSound, type PlayingSound } from "@/lib/notifications/sounds";
import type { AlertPopupPayload } from "@/types/alerts";

/** Extreme alerts keep sounding until acknowledged — but not forever, in
 * case the machine is unattended. */
const EXTREME_REPEAT_FOR_MS = 2 * 60_000;
const REPEAT_GAP_MS = 1500;

export interface AlertPopupWindowProps {
  token: string;
}

/**
 * The always-on-top card a Severe/Extreme alert opens (see
 * lib/notifications/dispatch.ts and windows:openAlertPopup in
 * electron/main.ts). Plays the "severe" notification sound — twice for
 * Severe, repeating until acknowledged for Extreme — and stays up until
 * the user dismisses it or opens the full alert.
 */
export function AlertPopupWindow({ token }: AlertPopupWindowProps) {
  const [payload, setPayload] = useState<AlertPopupPayload | null | undefined>(undefined);
  const { config } = useSettings();
  useResolvedTheme();
  useAppliedTheme();

  useEffect(() => {
    let cancelled = false;
    void ipc.windows.getAlertPopupPayload(token).then((p) => {
      if (!cancelled) setPayload(p);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const alert = payload?.alert;
  const isExtreme = alert?.severity === "Extreme";
  useDocumentTitle(alert ? `${alert.displayEvent} - Silver Skies` : "Alert - Silver Skies");

  // ── Sound ─────────────────────────────────────────────────────────────
  const [muted, setMuted] = useState(false);
  const playing = useRef<PlayingSound | null>(null);
  const soundId = config?.notificationSoundSevere;
  const volume = config?.notificationVolume ?? 0.8;
  const soundReady = Boolean(alert) && soundId !== undefined;
  useEffect(() => {
    if (!soundReady || muted || !soundId) return;
    let stopped = false;
    const startedAt = Date.now();
    const maxPlays = payload?.isTest ? 1 : isExtreme ? Infinity : 2;
    void (async () => {
      for (let i = 0; i < maxPlays && !stopped; i++) {
        if (i > 0 && Date.now() - startedAt > EXTREME_REPEAT_FOR_MS) break;
        playing.current = playNotificationSound(soundId, "severe", volume);
        await playing.current.done;
        if (stopped) break;
        await new Promise((r) => setTimeout(r, REPEAT_GAP_MS));
      }
    })();
    return () => {
      stopped = true;
      playing.current?.stop();
    };
    // Starts once, when both the alert and the user's sound settings have
    // loaded; muting stops it for good.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundReady, muted]);

  function close() {
    playing.current?.stop();
    void ipc.windowControls.close();
  }

  function openDetails() {
    if (alert) void ipc.windows.openAlert(alert);
    close();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
      if (e.key === "Enter") openDetails();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (payload === undefined) return <div className="alert-popup" />;
  if (!alert) {
    return (
      <div className="alert-popup items-center justify-center p-6 text-center">
        <p className="geo-notice">This alert is no longer available.</p>
        <button type="button" className="unit-btn mt-3" style={{ borderRadius: "var(--radius)" }} onClick={close}>
          Close
        </button>
      </div>
    );
  }

  const until = untilLabel(alert.expires);
  const remaining = timeRemainingLabel(alert.expires);
  const issued = issuedLabel(alert.sent ?? alert.onset);

  return (
    <div className={`alert-popup ${alert.cssClass} ${isExtreme ? "alert-popup-extreme" : ""}`}>
      <div className="alert-popup-stripe" aria-hidden="true" />
      <header className="drag-region flex items-center gap-2 px-4 pt-3">
        <span className="alert-popup-severity">
          <i className={`ph ${isExtreme ? "ph-siren" : "ph-warning"}`} aria-hidden="true" />
          {payload.isTest ? "Test · " : ""}
          {alert.severity ?? "Alert"}
        </span>
        <span className="truncate font-mono text-[0.65rem]" style={{ color: "var(--text3)" }}>
          {issued}
          {alert.issuingOffice ? ` · ${alert.issuingOffice}` : ""}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          className="no-drag alert-popup-icon-btn"
          onClick={() => {
            setMuted(true);
            playing.current?.stop();
          }}
          disabled={muted}
          title={muted ? "Muted" : "Silence"}
          aria-label={muted ? "Muted" : "Silence"}
        >
          <i className={`ph ${muted ? "ph-speaker-slash" : "ph-speaker-high"}`} aria-hidden="true" />
        </button>
        <button type="button" className="no-drag alert-popup-icon-btn" onClick={close} title="Dismiss" aria-label="Dismiss">
          <i className="ph ph-x" aria-hidden="true" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-4 pt-2">
        <h1 className="alert-popup-title">{alert.displayEvent}</h1>
        <div className="flex items-center gap-1.5 text-sm" style={{ color: "var(--text2)" }}>
          <i className="ph ph-map-pin" aria-hidden="true" />
          <span className="truncate">{payload.locationLabel}</span>
        </div>
        {(alert.headline || alert.areaDesc) && (
          <p className="alert-popup-body">{alert.headline ?? alert.areaDesc}</p>
        )}
        {(until || remaining) && (
          <div className="mt-auto font-mono text-[0.7rem]" style={{ color: "var(--text3)" }}>
            {until}
            {until && remaining ? " · " : ""}
            {remaining && <span style={{ color: "var(--ac)" }}>{remaining}</span>}
          </div>
        )}
      </div>

      <footer className="flex items-center gap-2 px-4 pt-3 pb-4">
        <button type="button" className="alert-popup-primary" onClick={openDetails}>
          Details &amp; safety info
        </button>
        <button type="button" className="unit-btn" style={{ borderRadius: "var(--radius)" }} onClick={close}>
          Dismiss
        </button>
      </footer>
    </div>
  );
}
