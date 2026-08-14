"use client";

import type { ReactNode } from "react";
import type { NormalizedAlert } from "@/types/alerts";
import { alertIconName } from "@/lib/alerts/classify";
import { issuedLabel, timeRemainingLabel, untilLabel } from "@/lib/alerts/format";
import { ipc } from "@/lib/ipc-client";
import { resolveAlertSourceUrl } from "@/lib/browser/external-links";
import { FitTitle } from "./FitTitle";

export interface AlertDetailContentProps {
  alert: NormalizedAlert;
  /** An extra control rendered next to the title — AlertRow's modal uses
   * this for the "open in window" button, so this component itself stays
   * unaware of windows/IPC. */
  titleAction?: ReactNode;
}

/**
 * The actual alert detail — icon, title, meta line, full text, source link.
 * Extracted out of AlertRow's modal so the exact same content can also be
 * rendered full-window (AlertWindow.tsx) when a user pops an alert out
 * instead of viewing it as a modal.
 */
export function AlertDetailContent({ alert, titleAction }: AlertDetailContentProps) {
  const iconName = alertIconName(alert.event);
  const body = [alert.description, alert.instruction].filter(Boolean).join("\n\n");
  const modalMeta = [
    alert.issuingOffice ?? alert.source.toUpperCase(),
    timeRemainingLabel(alert.expires),
    untilLabel(alert.expires),
    issuedLabel(alert.sent ?? alert.onset),
  ].filter(Boolean);

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center gap-3">
          <i
            className={`ph ph-${iconName}`}
            aria-hidden="true"
            style={{ fontSize: "2rem", color: "var(--ac, #888)", flexShrink: 0 }}
          />
          <div className="min-w-0 flex-1 text-base font-normal normal-case">
            <FitTitle text={alert.displayEvent} color="var(--ac, #888)" />
          </div>
          {titleAction}
        </div>
        <div className="font-mono text-xs leading-relaxed" style={{ color: "var(--text3)" }}>
          {modalMeta.join(" · ")}
        </div>
      </div>
      <div className="my-3 h-px w-full" style={{ background: "var(--border)" }} />
      <div className="alert-text min-w-0" style={{ padding: 0, borderTop: "none", overflowWrap: "anywhere" }}>
        {body || "No further details provided."}
        {alert.url && (
          <a
            className="alert-nws-link"
            href={alert.url}
            onClick={(e) => {
              e.preventDefault();
              // NWS alerts route through IEM's VTEC event browser instead of
              // the raw CAP identifier; librewxr/WMO-sourced alerts carry
              // that same identifier as `url` but not a parsed VTEC, so it's
              // resolved on demand (see resolveAlertSourceUrl) rather than
              // opening the bare "urn:oid:..." string, which no browser can
              // actually load.
              void resolveAlertSourceUrl(alert).then((url) => {
                if (url) void ipc.windows.openBrowser({ url, title: alert.displayEvent });
              });
            }}
          >
            SOURCE ↗
          </a>
        )}
      </div>
    </div>
  );
}
