"use client";

import { LocationList } from "@/components/locations/LocationList";
import { AddLocationDialog } from "@/components/locations/AddLocationDialog";
import { Button } from "@/components/ui/button";
import type { ActiveLocationState } from "@/hooks/useActiveLocation";
import type { SavedLocation } from "@/types/settings";
import {
  Sidebar,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
} from "@/components/ui/sidebar";
import Image from "next/image";
import { Logo } from "./Logo";
import { ChevronDown, Save } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { Card } from "../ui/card";

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
  /** Fires on every logo click — Shell counts these to trigger the
   * asteroid-shooter easter egg after 10 in a row. */
  onLogoClick?: () => void;
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
  onLogoClick,
}: LeftSidebarProps) {
  const alreadySaved = Boolean(active?.savedLocation);

  return (
    <Sidebar variant="inset" className="bg-transparent">
      <SidebarHeader className="pt-8 bg-transparent flex flex-col items-start">
        <button
          type="button"
          className="no-drag"
          onClick={onLogoClick}
          style={{ background: "none", border: "none", padding: 0, cursor: onLogoClick ? "pointer" : "default" }}
          aria-label="Silver Skies"
        >
          <Logo
            style={{
              height: 30,
              width: "auto",
              display: "block",
              color: "var(--text2)",
              flexShrink: 0,
            }}
          />
        </button>
      </SidebarHeader>
      <SidebarGroup>
        <SidebarGroupLabel>Current location</SidebarGroupLabel>
        <SidebarGroupContent>
          {active ? (
            <Card
              className="px-2 border py-2"
              style={{
                borderColor: "var(--border-active)",
                background: "var(--accent-glow2)",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div
                    className="truncate text-sm font-medium"
                    style={{ color: "var(--accent2)" }}
                  >
                    {active.label}
                  </div>
                </div>
                {!alreadySaved && (
                  <AddLocationDialog
                    defaultLabel={active.label}
                    onConfirm={onSaveCurrent}
                    trigger={
                      <Button size="icon" variant="ghost" className="text-(--text3) cursor-pointer">
                        <Save />
                      </Button>
                    }
                  />
                )}
              </div>
            </Card>
          ) : (
            <div className="loading-text">Locating…</div>
          )}
        </SidebarGroupContent>
      </SidebarGroup>
      <Collapsible defaultOpen className="group/collapsible">
        <SidebarGroup>
          <SidebarGroupLabel render={<CollapsibleTrigger />}>
            Saved
            <ChevronDown className="ml-auto transition-transform group-data-open/collapsible:rotate-180" />
          </SidebarGroupLabel>
          <CollapsibleContent>
            <SidebarGroupContent>
              <LocationList
                locations={savedLocations}
                activeId={active?.savedLocation?.id ?? null}
                onSelect={onSelectSaved}
                onRemove={onRemoveSaved}
              />
            </SidebarGroupContent>
          </CollapsibleContent>
        </SidebarGroup>
      </Collapsible>
      <SidebarFooter>{settingsSlot}</SidebarFooter>
    </Sidebar>
  );
}
