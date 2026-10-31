"use client";

import type { TodayOutlook } from "@/lib/forecast-outlook";

/**
 * A single, plain, unclickable line — deliberately not styled as one of the
 * real alert-banner cards below it (no border, no background, no severity
 * color tier, no expand-to-modal). This is a locally-derived forecast note,
 * not an official alert, and shouldn't read as one at a glance.
 */
export function TodayOutlookRow({ outlook }: { outlook: TodayOutlook }) {
  return (
    <div
      className="flex items-center gap-2 px-1 font-mono text-xs"
      style={{ color: outlook.isSevere ? "var(--accent2)" : "var(--text3)" }}
      title={outlook.text}
    >
      <i
        className={`ph ${outlook.isSevere ? "ph-cloud-lightning" : "ph-cloud-sun"}`}
        aria-hidden="true"
        style={{ flexShrink: 0, opacity: 0.8, fontSize: "0.95em" }}
      />
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{outlook.text}</span>
    </div>
  );
}
