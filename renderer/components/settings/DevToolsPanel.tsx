"use client";

import { useState } from "react";
import { DemoAlertPanel } from "@/components/easter-eggs/DemoAlertPanel";
import type { NormalizedAlert } from "@/types/alerts";

export interface DevToolsPanelProps {
  demoAlerts: NormalizedAlert[];
  onDemoAlertsChange: (alerts: NormalizedAlert[]) => void;
  onTriggerAsteroid: () => void;
  asteroidActive: boolean;
}

export function DevToolsPanel({ demoAlerts, onDemoAlertsChange, onTriggerAsteroid, asteroidActive }: DevToolsPanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="demo-panel">
      <button
        className="settings-bar-label flex w-full items-center justify-between"
        style={{ cursor: "pointer" }}
        onClick={() => setExpanded((v) => !v)}
      >
        <span>DEV TOOLS</span>
        <span style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▸</span>
      </button>
      {expanded && (
        <div className="mt-3">
          <DemoAlertPanel
            demoAlerts={demoAlerts}
            onDemoAlertsChange={onDemoAlertsChange}
            onTriggerAsteroid={onTriggerAsteroid}
            asteroidActive={asteroidActive}
          />
        </div>
      )}
    </div>
  );
}
