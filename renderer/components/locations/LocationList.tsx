"use client";

import type { SavedLocation } from "@/types/settings";
import { LocationItem } from "./LocationItem";

export interface LocationListProps {
  locations: SavedLocation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

export function LocationList({ locations, activeId, onSelect, onRemove }: LocationListProps) {
  if (!locations.length) {
    return (
      <div className="geo-notice" style={{ fontSize: "0.75rem" }}>
        No saved locations yet. Search for a place or use GPS, then “Save this location” below.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {locations.map((loc) => (
        <LocationItem
          key={loc.id}
          location={loc}
          isActive={loc.id === activeId}
          onSelect={() => onSelect(loc.id)}
          onRemove={() => onRemove(loc.id)}
        />
      ))}
    </div>
  );
}
