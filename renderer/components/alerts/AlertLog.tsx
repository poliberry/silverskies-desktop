"use client";

import { useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AlertSource, NormalizedAlert } from "@/types/alerts";
import type { TodayOutlook } from "@/lib/forecast-outlook";
import type { SpcOutlookFeature } from "@/lib/alerts/spc-outlook";
import { AlertRow } from "./AlertRow";
import { TodayOutlookRow } from "./TodayOutlookRow";
import { SpcOutlookBanner } from "./SpcOutlookBanner";

const SEVERITIES = ["Extreme", "Severe", "Moderate", "Minor"] as const;
const SOURCE_LABEL: Record<AlertSource, string> = {
  nws: "NWS",
  eccc: "ECCC",
  librewxr: "WMO",
  bom: "BOM",
  spc: "SPC",
};

interface AlertLogProps {
  alerts: NormalizedAlert[];
  isLoading?: boolean;
  demoAlerts?: NormalizedAlert[];
  todayOutlook?: TodayOutlook | null;
  spcOutlook?: SpcOutlookFeature | null;
  /** Only passed by Shell for the main window's own docked panel (and only
   * in Advanced UI mode) — omitted entirely inside AuditLogWindow, which is
   * already the popped-out instance and has nowhere further to pop out to. */
  onPopOutAuditLog?: () => void;
}

export function AlertLog({
  alerts,
  isLoading,
  demoAlerts = [],
  todayOutlook,
  spcOutlook,
  onPopOutAuditLog,
}: AlertLogProps) {
  const [severityFilter, setSeverityFilter] = useState<Set<string>>(new Set());
  const [sourceFilter, setSourceFilter] = useState<Set<AlertSource>>(new Set());

  const combined = useMemo(() => [...demoAlerts, ...alerts], [demoAlerts, alerts]);

  const sourcesPresent = useMemo(
    () => Array.from(new Set(combined.map((a) => a.source))),
    [combined],
  );

  const filtered = combined.filter((a) => {
    if (severityFilter.size && !severityFilter.has(a.severity ?? "Unknown")) return false;
    if (sourceFilter.size && !sourceFilter.has(a.source)) return false;
    return true;
  });

  function toggle<T>(set: Set<T>, value: T, setter: (s: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-3 px-1">
        <div className="section-title">Audit Log</div>
        <div className="section-line" />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className={`unit-btn ${severityFilter.size || sourceFilter.size ? "active" : ""}`}
                style={{ borderRadius: "var(--radius)" }}
              >
                <i className="ph ph-funnel" aria-hidden="true" style={{ marginRight: 4 }} />
                Filter
                {severityFilter.size + sourceFilter.size > 0 && ` (${severityFilter.size + sourceFilter.size})`}
              </button>
            }
          />
          <DropdownMenuContent align="start">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Severity</DropdownMenuLabel>
              {SEVERITIES.map((s) => (
                <DropdownMenuCheckboxItem
                  key={s}
                  checked={severityFilter.has(s)}
                  onCheckedChange={() => toggle(severityFilter, s, setSeverityFilter)}
                >
                  {s}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Source</DropdownMenuLabel>
              {sourcesPresent.map((s) => (
                <DropdownMenuCheckboxItem
                  key={s}
                  checked={sourceFilter.has(s)}
                  onCheckedChange={() => toggle(sourceFilter, s, setSourceFilter)}
                >
                  {SOURCE_LABEL[s]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {onPopOutAuditLog && (
          <div className="unit-toggle">
            <button
              className="unit-btn"
              onClick={onPopOutAuditLog}
              title="Undock the audit log into its own window"
              aria-label="Pop out audit log"
            >
              <i className="ph ph-arrow-square-out" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {spcOutlook && <SpcOutlookBanner outlook={spcOutlook} />}
      {todayOutlook && <TodayOutlookRow outlook={todayOutlook} />}

      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col gap-1 pr-2 pb-2">
          {isLoading && <div className="loading-text px-2">Checking for active alerts…</div>}
          {!isLoading && filtered.length === 0 && (
            <div className="geo-notice">No active alerts for this area right now.</div>
          )}
          {filtered.map((alert) => (
            <AlertRow key={alert.id} alert={alert} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
