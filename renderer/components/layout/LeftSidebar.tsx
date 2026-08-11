"use client";

import { LocationSearch } from "@/components/locations/LocationSearch";
import { LocationList } from "@/components/locations/LocationList";
import { AddLocationDialog } from "@/components/locations/AddLocationDialog";
import { Button } from "@/components/ui/button";
import type { ActiveLocationState } from "@/hooks/useActiveLocation";
import type { SavedLocation } from "@/types/settings";

export interface LeftSidebarProps {
  active: ActiveLocationState | null;
  savedLocations: SavedLocation[];
  isLocating: boolean;
  geoError: string | null;
  searchError: string | null;
  onSearch: (query: string) => void | Promise<void>;
  onGps: () => void;
  onSelectSaved: (id: string) => void;
  onRemoveSaved: (id: string) => void;
  onSaveCurrent: (label: string) => void | Promise<void>;
  settingsSlot?: React.ReactNode;
}

export function LeftSidebar({
  active,
  savedLocations,
  isLocating,
  geoError,
  searchError,
  onSearch,
  onGps,
  onSelectSaved,
  onRemoveSaved,
  onSaveCurrent,
  settingsSlot,
}: LeftSidebarProps) {
  const alreadySaved = Boolean(active?.savedLocation);

  return (
    <aside className="glass-card flex h-full min-h-0 flex-col gap-4 p-4">
      <LocationSearch onSearch={onSearch} onGps={onGps} isLocating={isLocating} error={geoError || searchError} />

      <div className="section-header">
        <div className="section-title">Current</div>
        <div className="section-line" />
      </div>
      {active ? (
        <div className="glass-card px-3 py-2.5" style={{ borderColor: "var(--border-active)", background: "var(--accent-glow2)" }}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium" style={{ color: "var(--accent2)" }}>
                {active.label}
              </div>
              <div className="font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
                {active.isGps ? "GPS" : alreadySaved ? "Saved" : "Search result"}
              </div>
            </div>
            {!alreadySaved && (
              <AddLocationDialog
                defaultLabel={active.label}
                onConfirm={onSaveCurrent}
                trigger={
                  <Button size="sm" variant="outline">
                    Save
                  </Button>
                }
              />
            )}
          </div>
        </div>
      ) : (
        <div className="loading-text">Locating…</div>
      )}

      <div className="section-header">
        <div className="section-title">Saved Locations</div>
        <div className="section-line" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto thin-scroll">
        <LocationList
          locations={savedLocations}
          activeId={active?.savedLocation?.id ?? null}
          onSelect={onSelectSaved}
          onRemove={onRemoveSaved}
        />
      </div>

      {settingsSlot}
    </aside>
  );
}
