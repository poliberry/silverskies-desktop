"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { CurrentConditions } from "@/components/current/CurrentConditions";
import { StatsRow } from "@/components/current/StatsRow";
import { HourlyRow } from "@/components/current/HourlyRow";
import { ForecastList } from "@/components/current/ForecastList";
import { ConditionsDetail } from "@/components/current/ConditionsDetail";
import { SunCard } from "@/components/current/SunCard";
import type { NormalizedWeather } from "@/types/weather";
import type { TimeFormatPref, UnitPref } from "@/types/settings";
import { Loader } from "lucide-react";

export interface RightSidebarProps {
  weather: NormalizedWeather | undefined;
  isLoading: boolean;
  error: string | null;
  unit: UnitPref;
  timeFormat: TimeFormatPref;
  theme: "light" | "dark";
}

export function RightSidebar({ weather, isLoading, error, unit, timeFormat, theme }: RightSidebarProps) {
  return (
    <aside>
      <ScrollArea className="thin-scroll min-h-0 flex-1">

      </ScrollArea>
    </aside>
  );
}
