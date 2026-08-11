"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { NormalizedAlert } from "@/types/alerts";
import { alertIconName } from "@/lib/alerts/classify";
import { fmtTime } from "@/lib/units";
import { issuedLabel, timeRemainingLabel, untilLabel } from "@/lib/alerts/format";
import { ipc } from "@/lib/ipc-client";
import { FitTitle } from "./FitTitle";

export function AlertRow({ alert }: { alert: NormalizedAlert }) {
  const duration =
    alert.onset && alert.expires
      ? `${fmtTime(alert.onset)} – ${fmtTime(alert.expires)}`
      : alert.expires
        ? `Until ${fmtTime(alert.expires)}`
        : "";
  const meta = [duration, alert.areaDesc].filter(Boolean).join(" · ");
  const body = [alert.description, alert.instruction].filter(Boolean).join("\n\n");
  const iconName = alertIconName(alert.event);

  const modalMeta = [
    alert.issuingOffice ?? alert.source.toUpperCase(),
    timeRemainingLabel(alert.expires),
    untilLabel(alert.expires),
    issuedLabel(alert.sent ?? alert.onset),
  ].filter(Boolean);

  return (
    <Dialog>
      <DialogTrigger
        render={
          <button type="button" className={`alert-banner ${alert.cssClass}`}>
            <div className="alert-banner-row">
              <div className="alert-icon">
                <i className={`ph ph-${iconName} alert-mc-icon`} aria-hidden="true" />
              </div>
              <div className="alert-body">
                <div className="alert-title">{alert.displayEvent}</div>
                <div className="alert-duration">{meta || alert.source.toUpperCase()}</div>
              </div>
              <div className="alert-arrow">▸</div>
            </div>
          </button>
        }
      />
      <DialogContent
        className="max-h-[80vh] w-full overflow-x-hidden overflow-y-auto thin-scroll rounded-none p-6 sm:max-w-lg"
        style={{
          border: `2px solid var(--ac, #888)`,
          boxShadow: `0 0 32px color-mix(in srgb, var(--ac, #888) 35%, transparent)`,
        }}
        // Base UI autofocuses the first focusable descendant by default —
        // here that's the "SOURCE" link at the very end of the alert text,
        // which drags the scrollable content straight to the bottom the
        // instant the dialog opens. Focus the dialog surface itself instead.
        initialFocus={false}
      >
        <div className={`${alert.cssClass} min-w-0`}>
          <DialogHeader className="min-w-0 gap-2">
            <div className="flex items-center gap-3">
              <i className={`ph ph-${iconName}`} aria-hidden="true" style={{ fontSize: "2rem", color: "var(--ac, #888)", flexShrink: 0 }} />
              <DialogTitle className="min-w-0 flex-1 p-0 text-base font-normal normal-case">
                <FitTitle text={alert.displayEvent} color="var(--ac, #888)" />
              </DialogTitle>
            </div>
            <div className="font-mono text-xs leading-relaxed" style={{ color: "var(--text3)" }}>
              {modalMeta.join(" · ")}
            </div>
          </DialogHeader>
          <div className="my-3 h-px w-full" style={{ background: "var(--border)" }} />
          <div className="alert-text min-w-0" style={{ padding: 0, borderTop: "none", overflowWrap: "anywhere" }}>
            {body || "No further details provided."}
            {alert.url && (
              <a
                className="alert-nws-link"
                href={alert.url}
                onClick={(e) => {
                  e.preventDefault();
                  void ipc.app.openExternal(alert.url!);
                }}
              >
                SOURCE ↗
              </a>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
