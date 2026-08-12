"use client";

import { useCallback, useEffect, useState } from "react";
import { ipc } from "@/lib/ipc-client";
import type { UpdaterStatus } from "@/types/updater";

/** Subscribes to electron-updater's status stream (electron/main.ts forwards
 * its events over "updater:status") and exposes the manual check/install
 * pair — the app also silently self-checks on launch (main.ts), so this
 * hook may already see a non-idle status the moment it mounts. */
export function useUpdater() {
  const [status, setStatus] = useState<UpdaterStatus>({ state: "idle" });

  useEffect(() => ipc.updater.onStatus(setStatus), []);

  const check = useCallback(() => {
    setStatus({ state: "checking" });
    void ipc.updater.check();
  }, []);

  const install = useCallback(() => {
    void ipc.updater.install();
  }, []);

  return { status, check, install };
}
