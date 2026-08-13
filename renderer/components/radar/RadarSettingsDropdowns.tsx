"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { RadarSettings } from "@/hooks/useRadarSettings";
import type { LibreWxrColorScheme } from "@/lib/alerts/librewxr";

export interface RadarSettingsDropdownsProps {
  colorSchemes: LibreWxrColorScheme[];
  settings: RadarSettings;
  overlaysAvailable: boolean;
}

// Inline styles (not the shared .unit-btn/.search-input classes) —
// deliberately near-zero chrome/padding, so this stays compact wherever
// it's used (the main window's combined RadarControls bar, and every
// pop-out radar window's alt bar).
const triggerStyle: React.CSSProperties = {
  height: 18,
  padding: "0 4px",
  border: "none",
  background: "none",
  color: "var(--text3)",
  fontSize: "0.7rem",
  fontFamily: "var(--mono)",
};

/**
 * Radar type/arrows/cells/polygons + weather-overlay toggles, as a compact
 * Select + one "Layers" dropdown menu instead of a wall of always-visible
 * buttons — used by both RadarControls (the main docked window's combined
 * bar) and RadarWindowToolbar (a pop-out radar window's alt bar).
 */
export function RadarSettingsDropdowns({ colorSchemes, settings, overlaysAvailable }: RadarSettingsDropdownsProps) {
  return (
    <div className="flex flex-shrink-0 items-center">
      <Select
        value={String(settings.colorScheme)}
        onValueChange={(v) => settings.setColorScheme(Number(v))}
      >
        <SelectTrigger size="sm" className="min-w-0 gap-1 rounded-none" style={triggerStyle}>
          <SelectValue placeholder="Type">
            {(value: string) => colorSchemes.find((s) => String(s.id) === value)?.name ?? "Type"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {colorSchemes.map((scheme) => (
            <SelectItem key={scheme.id} value={String(scheme.id)}>
              {scheme.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button style={triggerStyle} className="cursor-pointer">
              Layers
            </button>
          }
        />
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Radar</DropdownMenuLabel>
            <DropdownMenuCheckboxItem checked={settings.showArrows} onCheckedChange={settings.toggleArrows}>
              Arrows
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={settings.showCells} onCheckedChange={settings.toggleCells}>
              Cells
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={settings.showPolygons} onCheckedChange={settings.togglePolygons}>
              Polygons
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={settings.showRadarStations} onCheckedChange={settings.toggleRadarStations}>
              Radar Stations
            </DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              Overlays{!overlaysAvailable && " (needs an OpenWeatherMap API key)"}
            </DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              disabled={!overlaysAvailable}
              checked={settings.showWindOverlay}
              onCheckedChange={settings.toggleWindOverlay}
            >
              Wind
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              disabled={!overlaysAvailable}
              checked={settings.showTempOverlay}
              onCheckedChange={settings.toggleTempOverlay}
            >
              Temp
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              disabled={!overlaysAvailable}
              checked={settings.showPrecipOverlay}
              onCheckedChange={settings.togglePrecipOverlay}
            >
              Precip
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              disabled={!overlaysAvailable}
              checked={settings.showAqiOverlay}
              onCheckedChange={settings.toggleAqiOverlay}
            >
              AQI
            </DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
