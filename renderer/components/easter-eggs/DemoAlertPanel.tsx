"use client";

import { useState } from "react";
import type { NormalizedAlert } from "@/types/alerts";
import { ASTEROID_SENTINEL, DEMO_ALERT_GROUPS, buildDemoAlert } from "@/lib/alerts/demo";

export interface DemoAlertPanelProps {
  demoAlerts: NormalizedAlert[];
  onDemoAlertsChange: (alerts: NormalizedAlert[]) => void;
  onTriggerAsteroid: () => void;
  asteroidActive: boolean;
}

export function DemoAlertPanel({ demoAlerts, onDemoAlertsChange, onTriggerAsteroid, asteroidActive }: DemoAlertPanelProps) {
  const first = DEMO_ALERT_GROUPS[0].options[0];
  const [selected, setSelected] = useState(`${first.event}|${first.severity}`);

  function handleAdd() {
    if (selected === ASTEROID_SENTINEL) {
      onTriggerAsteroid();
      return;
    }
    const [event, severity] = selected.split("|");
    onDemoAlertsChange([...demoAlerts, buildDemoAlert(event, severity)]);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="demo-label">⚠ ALERT DEMO</div>
      <div className="demo-row flex flex-wrap gap-2">
        <select
          className="demo-select"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={asteroidActive}
        >
          {DEMO_ALERT_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((opt) => (
                <option key={opt.event} value={`${opt.event}|${opt.severity}`}>
                  {opt.event}
                </option>
              ))}
            </optgroup>
          ))}
          <optgroup label="🌑">
            <option value={ASTEROID_SENTINEL}>Asteroid Impact Warning</option>
          </optgroup>
        </select>
        <button className="demo-btn" onClick={handleAdd} disabled={asteroidActive}>
          Add Alert
        </button>
        <button
          className="demo-btn demo-btn-clear"
          onClick={() => onDemoAlertsChange([])}
          disabled={asteroidActive || demoAlerts.length === 0}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
