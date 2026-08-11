"use client";

import { useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AlertSource, NormalizedAlert } from "@/types/alerts";
import { AlertRow } from "./AlertRow";

const SEVERITIES = ["Extreme", "Severe", "Moderate", "Minor"] as const;
const SOURCE_LABEL: Record<AlertSource, string> = {
  nws: "NWS",
  eccc: "ECCC",
  librewxr: "WMO",
};

interface AlertLogProps {
  alerts: NormalizedAlert[];
  isLoading?: boolean;
  demoAlerts?: NormalizedAlert[];
}

export function AlertLog({ alerts, isLoading, demoAlerts = [] }: AlertLogProps) {
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
        <div className="flex flex-wrap gap-1">
          {SEVERITIES.map((s) => (
            <button
              key={s}
              className={`unit-btn ${severityFilter.has(s) ? "active" : ""}`}
              style={{ borderRadius: "var(--radius)" }}
              onClick={() => toggle(severityFilter, s, setSeverityFilter)}
            >
              {s}
            </button>
          ))}
          {sourcesPresent.map((s) => (
            <button
              key={s}
              className={`unit-btn ${sourceFilter.has(s) ? "active" : ""}`}
              style={{ borderRadius: "var(--radius)" }}
              onClick={() => toggle(sourceFilter, s, setSourceFilter)}
            >
              {SOURCE_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col gap-2 pr-2 pb-2">
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
