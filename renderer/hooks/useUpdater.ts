"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ipc } from "@/lib/ipc-client";
import type { UpdaterStatus } from "@/types/updater";

/** Subscribes to electron-updater's status stream (electron/main.ts forwards
 * its events over "updater:status") and exposes the manual check/install
 * pair — the app also silently self-checks on launch (main.ts), so this
 * hook may already see a non-idle status the moment it mounts. */
export function useUpdater() {
  const [status, setStatus] = useState<UpdaterStatus>({ state: "idle" });
  const gotLiveStatusRef = useRef(false);

  useEffect(() => {
    const unsubscribe = ipc.updater.onStatus((s) => {
      gotLiveStatusRef.current = true;
      setStatus(s);
    });
    // The subscription above only sees *future* events — an update can
    // finish downloading (or fail, or already be ready to install) entirely
    // while this component wasn't mounted, so replay whatever main already
    // knows. Guarded so a live event that arrives first (or while this is
    // in flight) isn't clobbered by a now-stale snapshot.
    void ipc.updater.getStatus().then((s) => {
      if (!gotLiveStatusRef.current) setStatus(s);
    });
    return unsubscribe;
  }, []);

  const check = useCallback(() => {
    setStatus({ state: "checking" });
    void ipc.updater.check();
  }, []);

  const download = useCallback(() => {
    void ipc.updater.download();
  }, []);

  const install = useCallback(() => {
    void ipc.updater.install();
  }, []);

  return { status, check, download, install };
}
