"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { alertClass, hazardGroupKey } from "@/lib/alerts/classify";
import { DEMO_ALERT_GROUPS } from "@/lib/alerts/demo";
import { Accordion, AccordionItem, AccordionHeader, AccordionTrigger, AccordionPanel } from "@/components/ui/accordion";
import { AlertRow } from "./AlertRow";
import { TodayOutlookRow } from "./TodayOutlookRow";
import { SpcOutlookBanner } from "./SpcOutlookBanner";

// hazardGroupKey -> clean canonical label, built from the same demo-event
// catalog Settings -> Alerts draws from — each demo event is already a
// clean, single-hazard name, so reverse-mapping through hazardGroupKey
// gives a distinct label per *hazard*, not per shared cssClass (several
// genuinely different hazards — e.g. "Excessive Heat Warning" and "Extreme
// Wind Warning" — intentionally share the "alert-extreme" cssClass for
// styling, so a cssClass-keyed label lookup would show the wrong hazard's
// name for one of them once grouping stopped merging them together).
const GROUP_LABEL_BY_KEY: Record<string, string> = (() => {
  const labels: Record<string, string> = {};
  for (const group of DEMO_ALERT_GROUPS) {
    for (const { event, severity } of group.options) {
      const key = hazardGroupKey(event, alertClass(event, severity, event, ""));
      if (!(key in labels)) labels[key] = event;
    }
  }
  return labels;
})();

interface AlertGroup {
  /** Stable group identity (see groupAlertsByEvent) — used as the React/
   * accordion key, not shown to the user. */
  groupKey: string;
  /** The clean canonical label for this hazard type, shown as the group's
   * header — falls back to the first-seen member's displayEvent only for a
   * hazard the demo catalog doesn't reach. */
  displayEvent: string;
  alerts: NormalizedAlert[];
}

/** Groups alerts belonging to the same hazard type — e.g. every alert with
 * "Flash Flood Warning" somewhere in its name, whether that's a clean NWS
 * `displayEvent` like "Flash Flood Warning" or a source (WMO/librewxr) that
 * only gives a full sentence like "Flash Flood Warning issued for XYZ County
 * until 5pm" — into one collapsible section.
 *
 * Keyed via hazardGroupKey(), not `cssClass` or `displayEvent` directly:
 * cssClass matches hazard phrases via regex (`.test(event)`, i.e.
 * "contains", not "equals") against the raw event text, which is exactly
 * the "contains this phrase" grouping wanted here — but several distinct
 * hazards intentionally share one cssClass for styling, so grouping on the
 * class itself would merge unrelated hazards (see hazardGroupKey's own
 * doc). Grouping on the plain displayEvent string, meanwhile, would only
 * work for sources whose event field is already just the clean hazard
 * name, which not all of them are. */
function groupAlertsByEvent(alerts: NormalizedAlert[]): AlertGroup[] {
  const groups: AlertGroup[] = [];
  const index = new Map<string, AlertGroup>();
  for (const alert of alerts) {
    const key = hazardGroupKey(alert.event, alert.cssClass);
    let group = index.get(key);
    if (!group) {
      group = {
        groupKey: key,
        displayEvent: GROUP_LABEL_BY_KEY[key] ?? alert.displayEvent,
        alerts: [],
      };
      index.set(key, group);
      groups.push(group);
    }
    group.alerts.push(alert);
  }
  return groups;
}

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

  const groups = useMemo(() => groupAlertsByEvent(filtered), [filtered]);

  // Every group starts open (today's behavior shows every alert immediately)
  // — a ref tracks which group keys we've already seen so a group a user
  // manually collapsed doesn't get forced back open just because some other
  // alert in the list changed, while a brand-new event type still opens by
  // default instead of appearing collapsed.
  const seenGroupKeys = useRef<Set<string>>(new Set());
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  useEffect(() => {
    const newKeys = groups.map((g) => g.groupKey).filter((k) => !seenGroupKeys.current.has(k));
    if (newKeys.length === 0) return;
    newKeys.forEach((k) => seenGroupKeys.current.add(k));
    setOpenGroups((prev) => [...prev, ...newKeys]);
  }, [groups]);

  function toggle<T>(set: Set<T>, value: T, setter: (s: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-3 px-1">
        <div className="section-title">
          Audit Log
          {filtered.length > 0 && <span className="section-title-count"> ({filtered.length})</span>}
        </div>
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
          {groups.length > 0 && (
            <Accordion multiple value={openGroups} onValueChange={(v) => setOpenGroups(v as string[])}>
              {groups.map((group) => (
                <AccordionItem key={group.groupKey} value={group.groupKey}>
                  <AccordionHeader>
                    <AccordionTrigger className="alert-group-trigger">
                      <i className="ph ph-caret-right alert-group-caret" aria-hidden="true" />
                      <span className="alert-group-title">{group.displayEvent}</span>
                      <span className="alert-group-count">{group.alerts.length}</span>
                    </AccordionTrigger>
                  </AccordionHeader>
                  <AccordionPanel className="flex flex-col gap-1">
                    {group.alerts.map((alert) => (
                      <AlertRow key={alert.id} alert={alert} />
                    ))}
                  </AccordionPanel>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
