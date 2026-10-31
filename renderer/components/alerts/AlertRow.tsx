"use client";

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { NormalizedAlert } from "@/types/alerts";
import { alertIconName } from "@/lib/alerts/classify";
import { fmtTime } from "@/lib/units";
import { ipc } from "@/lib/ipc-client";
import { AlertDetailContent } from "./AlertDetailContent";

export function AlertRow({ alert }: { alert: NormalizedAlert }) {
  const duration =
    alert.onset && alert.expires
      ? `${fmtTime(alert.onset)} – ${fmtTime(alert.expires)}`
      : alert.expires
        ? `Until ${fmtTime(alert.expires)}`
        : "";
  const meta = [duration, alert.issuingOffice || alert.source.toUpperCase()].filter(Boolean).join(" · ");
  const iconName = alertIconName(alert.event);

  function openInWindow() {
    void ipc.windows.openAlert(alert);
  }

  return (
    <Dialog>
      {/* One flat, single-line row (name · time · issuing office) instead of
          a stacked banner card — `alert.cssClass` still just sets --ac here,
          so the trigger and pop-out button both pick up the severity color
          without either needing its own background/border chrome. */}
      <div className={`flex items-center gap-1 ${alert.cssClass}`}>
        <DialogTrigger
          render={
            <button type="button" className="alert-line" style={{ flex: 1 }}>
              <span className="alert-line-icon">
                <i className={`ph ph-${iconName} alert-mc-icon`} aria-hidden="true" />
              </span>
              <span className="alert-line-title">{alert.displayEvent}</span>
              <span className="alert-line-meta">{meta}</span>
              <span className="alert-line-arrow">▸</span>
            </button>
          }
        />
        <button
          type="button"
          className="alert-line-popout"
          title="Open this alert in its own window"
          aria-label="Open this alert in its own window"
          onClick={(e) => {
            e.stopPropagation();
            openInWindow();
          }}
        >
          <i className="ph ph-arrow-square-out" aria-hidden="true" />
        </button>
      </div>
      <DialogContent
        // `alert.cssClass` (which only ever sets the --ac custom property —
        // see the taxonomy in app/globals.css) has to live on this element
        // itself, not a descendant: the border/shadow/scrollbar below all
        // read var(--ac) right here, and a CSS custom property set on a
        // child isn't visible to its own ancestor.
        className={`${alert.cssClass} max-h-[80vh] w-full overflow-x-hidden overflow-y-auto alert-modal-scroll rounded-none p-6 sm:max-w-lg`}
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
        {/* Base UI's Dialog wires aria-labelledby to whatever DialogTitle
            renders — AlertDetailContent's own visible title uses FitTitle
            (a plain div, for its variable-width shrink behavior), so this
            sr-only one gives the dialog its accessible name without
            visually duplicating the heading. */}
        <DialogTitle className="sr-only">{alert.displayEvent}</DialogTitle>
        <AlertDetailContent
          alert={alert}
          titleAction={
            <button
              type="button"
              className="unit-btn"
              style={{ flexShrink: 0 }}
              onClick={openInWindow}
              title="Open this alert in its own window instead"
            >
              <i className="ph ph-arrow-square-out" aria-hidden="true" />
            </button>
          }
        />
      </DialogContent>
    </Dialog>
  );
}
