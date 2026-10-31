"use client";

import { fmtTemp, unitSuffix, uvLabel } from "@/lib/units";
import type { CurrentConditions, DailyPoint } from "@/types/weather";
import type { UnitPref } from "@/types/settings";

function cloudDescription(pct: number): string {
  if (pct < 20) return "Clear skies";
  if (pct < 50) return "Partly cloudy";
  if (pct < 85) return "Mostly cloudy";
  return "Overcast";
}

export function ConditionsDetail({
  current,
  today,
  unit,
}: {
  current: CurrentConditions;
  today: DailyPoint | undefined;
  unit: UnitPref;
}) {
  const uv = current.uvIndex ?? today?.uvIndexMax ?? 0;
  const { label: uvText, color: uvColor } = uvLabel(uv);
  const uvMarkerPct = Math.min(Math.round((uv / 11) * 100), 100);

  return (
    <div className="flex flex-col gap-2">
      <div className="info-card">
        <div className="info-card-label">UV Index</div>
        <div className="info-card-value" style={{ color: uvColor }}>
          {uv.toFixed(1)}
        </div>
        <div className="info-card-desc">
          {uvText} — {uv > 5 ? "SPF recommended" : "Low risk"}
        </div>
        <div className="uv-bar">
          <div className="uv-marker" style={{ left: `${uvMarkerPct}%` }} />
        </div>
      </div>
      <div className="info-card">
        <div className="info-card-label">Apparent Temp</div>
        <div className="info-card-value">
          {fmtTemp(current.apparentTemperatureC, unit)}
          {unitSuffix(unit)}
        </div>
        <div className="info-card-desc">Feels like outside</div>
      </div>
      <div className="info-card">
        <div className="info-card-label">Cloud Cover</div>
        <div className="info-card-value">{current.cloudCoverPct}%</div>
        <div className="info-card-desc">{cloudDescription(current.cloudCoverPct)}</div>
      </div>
    </div>
  );
}
