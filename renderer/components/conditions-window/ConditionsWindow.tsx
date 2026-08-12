"use client";

import { useEffect, useState } from "react";
import { RightSidebar } from "@/components/layout/RightSidebar";
import { useWeather } from "@/hooks/useWeather";
import { useSettings } from "@/hooks/useSettings";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { ipc } from "@/lib/ipc-client";
import { ProviderConfigError } from "@/lib/providers";
import type { WindowLocation } from "@/types/windows";
import type { UnitPref } from "@/types/settings";

export interface ConditionsWindowProps {
  /** The radar window instance this one is paired to — main only relays
   * location updates to the correctly paired window, so nothing here needs
   * to filter incoming events by it; kept for clarity/future use. */
  instanceId: string;
  initialLocation: WindowLocation | null;
}

/**
 * A standalone "current conditions" window tracking one specific radar
 * instance's location — reuses RightSidebar (the main window's 3rd column)
 * completely as-is, so it's styled identically. Updates automatically
 * whenever its paired radar window's location changes (search, GPS).
 */
export function ConditionsWindow({ initialLocation }: ConditionsWindowProps) {
  const [location, setLocation] = useState<WindowLocation | null>(initialLocation);
  const { config } = useSettings();
  const theme = useResolvedTheme();
  const weatherQuery = useWeather(location);

  useEffect(() => ipc.windows.onInstanceLocation(setLocation), []);

  const unit: UnitPref = config?.units ?? "F";
  const timeFormat = config?.timeFormat ?? "12";

  const weatherError =
    weatherQuery.error instanceof ProviderConfigError
      ? weatherQuery.error.message
      : weatherQuery.error instanceof Error
        ? `Couldn't load weather: ${weatherQuery.error.message}`
        : null;

  return (
    <div className="flex h-screen flex-col gap-2 p-3" style={{ background: "var(--bg)" }}>
      <div className="glass-card px-3 py-1.5 font-mono text-xs" style={{ color: "var(--text2)" }}>
        {location?.label ?? "Waiting for radar location…"}
      </div>
      <div className="min-h-0 flex-1">
        <RightSidebar
          weather={weatherQuery.data}
          isLoading={weatherQuery.isLoading}
          error={weatherError}
          unit={unit}
          timeFormat={timeFormat}
          theme={theme}
        />
      </div>
    </div>
  );
}
