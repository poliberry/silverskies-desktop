"use client";

import { useEffect, useState } from "react";
import { AlertLog } from "@/components/alerts/AlertLog";
import { useAlerts } from "@/hooks/useAlerts";
import { useSpcOutlook } from "@/hooks/useSpcOutlook";
import { useSettings } from "@/hooks/useSettings";
import { useWeather } from "@/hooks/useWeather";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { useAppliedTheme } from "@/hooks/useAppliedTheme";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { WindowControlButtons } from "@/components/layout/WindowControlButtons";
import { ipc } from "@/lib/ipc-client";
import { findOutlookAtPoint } from "@/lib/alerts/spc-outlook";
import { buildTodayOutlook } from "@/lib/forecast-outlook";
import type { WindowLocation } from "@/types/windows";
import type { UnitPref } from "@/types/settings";

export interface AuditLogWindowProps {
  /** The radar window instance this one is paired to — or the "main"
   * sentinel when popped out of the main window's own docked audit log
   * (see electron/main.ts). Main only relays location updates to the
   * correctly paired window, so nothing here needs to filter incoming
   * events by it; kept for clarity/future use. */
  instanceId: string;
  initialLocation: WindowLocation | null;
}

/**
 * A standalone audit-log window tracking one specific radar instance's (or
 * the main window's own) location — reuses AlertLog completely as-is, so
 * it's styled identically to the docked one. Updates automatically whenever
 * its paired instance's location changes (search, GPS, saved-location
 * pick). Independently derives its own alerts/outlook data rather than
 * receiving it over IPC, the same way ConditionsWindow independently calls
 * useWeather() instead of Shell handing it props.
 */
export function AuditLogWindow({ initialLocation }: AuditLogWindowProps) {
  const [location, setLocation] = useState<WindowLocation | null>(initialLocation);
  const { config } = useSettings();
  // AlertLog has no theme prop of its own — it reads CSS variables scoped by
  // the <html data-theme> attribute this hook's own effect sets, same as
  // every other window.
  useResolvedTheme();
  useAppliedTheme();

  useEffect(() => ipc.windows.onInstanceLocation(setLocation), []);

  useDocumentTitle(location ? `${location.label} - Audit Log - Silver Skies` : "Audit Log - Silver Skies");

  const unit: UnitPref = config?.units ?? "F";
  const spcOutlookEnabled = config?.spcOutlookEnabled ?? true;

  const alertsQuery = useAlerts(location?.lat ?? null, location?.lon ?? null);
  const weatherQuery = useWeather(location);
  const spcOutlookQuery = useSpcOutlook(spcOutlookEnabled);

  const todayOutlook = weatherQuery.data
    ? buildTodayOutlook(weatherQuery.data.current, weatherQuery.data.daily[0], unit)
    : null;
  const spcOutlook =
    spcOutlookEnabled && location && spcOutlookQuery.data
      ? findOutlookAtPoint(spcOutlookQuery.data, location.lat, location.lon)
      : null;

  return (
    <div className="flex h-screen flex-col" style={{ background: "var(--bg)" }}>
      <div
        className="drag-region flex items-center justify-between gap-2 font-mono text-xs"
        style={{ padding: "3px 8px", color: "var(--text2)" }}
      >
        <span className="truncate">{location?.label ?? "Waiting for radar location…"}</span>
        <WindowControlButtons iconSize={11} />
      </div>
      <div className="min-h-0 flex-1 p-3" style={{ paddingTop: 0 }}>
        <AlertLog
          alerts={alertsQuery.data ?? []}
          isLoading={alertsQuery.isLoading}
          todayOutlook={todayOutlook}
          spcOutlook={spcOutlook}
        />
      </div>
    </div>
  );
}
