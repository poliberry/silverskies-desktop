"use client";

import { useEffect, useState } from "react";
import { AlertDetailContent } from "@/components/alerts/AlertDetailContent";
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

  return (
    <div
      className={`flex h-screen flex-col overflow-y-auto thin-scroll p-6 ${alert?.cssClass ?? ""}`}
      style={{ background: "var(--bg)" }}
    >
      {alert === undefined && <div className="loading-text">Loading alert…</div>}
      {alert === null && <div className="error-box">⚠ This alert is no longer available.</div>}
      {alert && <AlertDetailContent alert={alert} />}
    </div>
  );
}
