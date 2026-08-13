"use client";

import { useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { ALERT_TYPE_CATALOG, type AlertTypeEntry } from "@/lib/alerts/alertTypeCatalog";
import { resolveAlertColor } from "@/lib/alerts/color.client";

type Override = { visible?: boolean; color?: string };

function groupEntries(): [string, AlertTypeEntry[]][] {
  const map = new Map<string, AlertTypeEntry[]>();
  for (const entry of ALERT_TYPE_CATALOG) {
    const list = map.get(entry.group) ?? [];
    list.push(entry);
    map.set(entry.group, list);
  }
  return Array.from(map.entries());
}

const GROUPS = groupEntries();

function AlertTypeRow({
  cssClass,
  label,
  override,
  onChange,
}: {
  cssClass: string;
  label: string;
  override: Override | undefined;
  onChange: (next: Override | undefined) => void;
}) {
  // This panel only ever mounts client-side (inside an already-open Settings
  // dialog), so reading the CSS-defined default color via a lazy initial
  // state — rather than a setState-in-effect — is safe and avoids an extra
  // render just to replace a placeholder color.
  const [defaultColor] = useState(() => resolveAlertColor(cssClass));

  const visible = override?.visible !== false;
  const color = override?.color ?? defaultColor;
  const hasOverride = override?.visible !== undefined || override?.color !== undefined;

  return (
    <div className="flex items-center gap-2 py-1">
      <input
        type="color"
        value={color}
        onChange={(e) => onChange({ ...override, color: e.target.value })}
        className="h-6 w-8 shrink-0 cursor-pointer rounded-sm border-0 bg-transparent p-0"
        title="Polygon color"
      />
      <span className="flex-1 truncate font-mono text-[0.72rem]" style={{ color: "var(--text2)" }}>
        {label}
      </span>
      {hasOverride && (
        <button className="unit-btn" style={{ fontSize: "0.6rem" }} onClick={() => onChange(undefined)}>
          RESET
        </button>
      )}
      <button
        className={`unit-btn ${visible ? "active" : ""}`}
        style={{ fontSize: "0.6rem" }}
        onClick={() => onChange({ ...override, visible: !visible })}
      >
        {visible ? "ON" : "OFF"}
      </button>
    </div>
  );
}

export function AlertTypesPanel() {
  const { config, updateConfig } = useSettings();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (!config) return null;
  const overrides = config.alertTypeOverrides ?? {};

  function setOverride(cssClass: string, next: Override | undefined) {
    const nextOverrides = { ...overrides };
    if (!next || (next.visible === undefined && next.color === undefined)) {
      delete nextOverrides[cssClass];
    } else {
      nextOverrides[cssClass] = next;
    }
    updateConfig({ alertTypeOverrides: nextOverrides });
  }

  function toggleGroup(group: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
        Choose the polygon color for each alert type, and toggle which types render on the radar map. Changes
        apply immediately — anything not customized keeps its default color.
      </p>
      {GROUPS.map(([group, entries]) => (
        <div key={group} className="settings-bar-section">
          <button
            className="settings-bar-label flex w-full items-center justify-between"
            style={{ cursor: "pointer" }}
            onClick={() => toggleGroup(group)}
          >
            <span>{group.toUpperCase()}</span>
            <span style={{ transform: expanded.has(group) ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
              ▸
            </span>
          </button>
          {expanded.has(group) && (
            <div className="mt-2 flex flex-col gap-0.5">
              {entries.map((entry) => (
                <AlertTypeRow
                  key={entry.cssClass}
                  cssClass={entry.cssClass}
                  label={entry.label}
                  override={overrides[entry.cssClass]}
                  onChange={(next) => setOverride(entry.cssClass, next)}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
