"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useUpdater } from "@/hooks/useUpdater";
import { ipc } from "@/lib/ipc-client";
import type { AppInfo } from "@/types/updater";

function statusLabel(status: ReturnType<typeof useUpdater>["status"]): string {
  switch (status.state) {
    case "idle":
      return "";
    case "checking":
      return "Checking for updates…";
    case "available":
      return `Update v${status.version} found — downloading…`;
    case "not-available":
      return "You're up to date.";
    case "downloading":
      return `Downloading update… ${status.percent}%`;
    case "downloaded":
      return `Update v${status.version} downloaded — restart to install.`;
    case "error":
      return `Update check failed: ${status.message}`;
    case "unsupported":
      return "Updates aren't available in this build (not packaged/installed).";
  }
}

export function AboutPanel() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const { status, check, install } = useUpdater();

  useEffect(() => {
    void ipc.app.getInfo().then(setInfo);
  }, []);

  const busy = status.state === "checking" || status.state === "downloading";
  const label = statusLabel(status);

  return (
    <div className="flex flex-col gap-5">
      <div className="settings-bar-section">
        <div className="settings-bar-label">VERSION</div>
        <div className="font-mono text-sm" style={{ color: "var(--text)" }}>
          Silver Skies {info?.version ?? "…"}
        </div>
      </div>

      <div className="settings-bar-section">
        <div className="settings-bar-label">DETAILS</div>
        <div className="flex flex-col gap-1 font-mono text-[0.72rem]" style={{ color: "var(--text2)" }}>
          <div>Electron {info?.electron ?? "—"}</div>
          <div>Chromium {info?.chrome ?? "—"}</div>
          <div>Node {info?.node ?? "—"}</div>
          <div>
            {info?.platform ?? "—"} ({info?.arch ?? "—"})
          </div>
        </div>
      </div>

      <div className="settings-bar-section">
        <div className="settings-bar-label">UPDATES</div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={check} disabled={busy}>
            Check for Updates
          </Button>
          {status.state === "downloaded" && (
            <Button onClick={install}>Restart &amp; Install</Button>
          )}
        </div>
        {label && (
          <p className="mt-1.5 font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
            {label}
          </p>
        )}
      </div>
    </div>
  );
}
