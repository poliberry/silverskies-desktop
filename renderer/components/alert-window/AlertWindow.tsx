"use client";

import { useEffect, useState } from "react";
import { AlertDetailContent } from "@/components/alerts/AlertDetailContent";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { WindowControlButtons } from "@/components/layout/WindowControlButtons";
import { ipc } from "@/lib/ipc-client";
import type { NormalizedAlert } from "@/types/alerts";

export interface AlertWindowProps {
  /** One-time token minted by `windows:openAlert` — the full alert payload
   * is fetched once via IPC rather than round-tripped through the launch
   * URL, so alert text isn't subject to URL length limits. */
  token: string;
}

/** A single alert, popped out of the audit log into its own window instead
 * of the default modal — same content (AlertDetailContent), just full-window. */
export function AlertWindow({ token }: AlertWindowProps) {
  const [alert, setAlert] = useState<NormalizedAlert | null | undefined>(undefined);

  useEffect(() => {
    if (!token) {
      setAlert(null);
      return;
    }
    let cancelled = false;
    void ipc.windows.getAlertPayload(token).then((payload) => {
      if (!cancelled) setAlert(payload);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useDocumentTitle(alert ? `${alert.displayEvent} - Alert - Silver Skies` : "Alert - Silver Skies");

  return (
    <div className={`flex h-screen flex-col ${alert?.cssClass ?? ""}`} style={{ background: "var(--bg)" }}>
      <div className="drag-region flex flex-shrink-0 items-center justify-end" style={{ padding: "3px 8px" }}>
        <WindowControlButtons iconSize={11} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto thin-scroll p-6">
        {alert === undefined && <div className="loading-text">Loading alert…</div>}
        {alert === null && <div className="error-box">⚠ This alert is no longer available.</div>}
        {alert && <AlertDetailContent alert={alert} />}
      </div>
    </div>
  );
}
