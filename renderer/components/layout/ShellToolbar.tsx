"use client";

import { useClock } from "@/hooks/useClock";
import { fmtClockTime } from "@/lib/units";
import { BENTO_TILES, type BentoTileId } from "@/lib/bento-layout";
import type { TimeFormatPref, UnitPref } from "@/types/settings";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { WindowControlButtons } from "./WindowControlButtons";

export interface ShellToolbarProps {
  /** Location omnibox, rendered on the left. */
  searchSlot: React.ReactNode;
  lastRefresh: Date | null;
  isRefreshing: boolean;
  onRefresh: () => void;
  unit: UnitPref;
  onSetUnit: (u: UnitPref) => void;
  timezone: string | undefined;
  timeFormat: TimeFormatPref;
  onOpenRadio: () => void;
  radioEnabled?: boolean;

  /** Canvas controls — see useBentoLayout / usePoppedOutTiles. */
  hiddenTiles: BentoTileId[];
  onSetTileHidden: (id: BentoTileId, hidden: boolean) => void;
  poppedOutTiles: ReadonlySet<BentoTileId>;
  onDockTile: (id: BentoTileId) => void;
  layoutLocked: boolean;
  onSetLayoutLocked: (locked: boolean) => void;
  onResetLayout: () => void;
  onNewRadarWindow: () => void;
}

/** The main window's sticky header over the bento canvas — omnibox on the
 * left, then the clock, canvas/window controls, and the essentials. */
export function ShellToolbar({
  searchSlot,
  lastRefresh,
  isRefreshing,
  onRefresh,
  unit,
  onSetUnit,
  timezone,
  timeFormat,
  onOpenRadio,
  radioEnabled,
  hiddenTiles,
  onSetTileHidden,
  poppedOutTiles,
  onDockTile,
  layoutLocked,
  onSetLayoutLocked,
  onResetLayout,
  onNewRadarWindow,
}: ShellToolbarProps) {
  const clock = useClock(timezone, timeFormat);
  // macOS draws its own traffic lights (titleBarStyle: "hidden"); every
  // other platform gets no native controls at all, so draw ours.
  const isMac = /Mac/i.test(navigator.userAgent);
  const poppedOutList = BENTO_TILES.filter((t) => poppedOutTiles.has(t.id));

  return (
    <div className="drag-region flex flex-row items-center gap-2">
      <div className="no-drag flex min-w-0 flex-1 items-center gap-1">
        <SidebarTrigger className="text-(--text3)" />
        {searchSlot}
      </div>

      <div className="no-drag flex flex-shrink-0 items-center gap-2">
        <span className="hidden font-mono text-[0.7rem] whitespace-nowrap xl:inline" style={{ color: "var(--text3)" }}>
          Refreshed{" "}
          <span style={{ color: "var(--accent2)" }}>{lastRefresh ? fmtClockTime(lastRefresh, timeFormat) : "—"}</span>
          <span className="mx-2" style={{ opacity: 0.4 }}>
            ·
          </span>
          {clock}
        </span>

        <div className="unit-toggle">
          <button
            type="button"
            className={`unit-btn ${layoutLocked ? "active" : ""}`}
            onClick={() => onSetLayoutLocked(!layoutLocked)}
            title={layoutLocked ? "Unlock layout" : "Lock layout"}
            aria-label={layoutLocked ? "Unlock layout" : "Lock layout"}
          >
            <i className={`ph ${layoutLocked ? "ph-lock-simple" : "ph-lock-simple-open"}`} aria-hidden="true" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button type="button" className="unit-btn" title="Tiles & windows" aria-label="Tiles and windows">
                  <i className="ph ph-squares-four" aria-hidden="true" />
                  {poppedOutList.length > 0 && (
                    <span className="ml-1 font-mono text-[0.65rem]" style={{ color: "var(--accent2)" }}>
                      {poppedOutList.length}
                    </span>
                  )}
                </button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-60">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Tiles</DropdownMenuLabel>
                {BENTO_TILES.map((t) => {
                  const out = poppedOutTiles.has(t.id);
                  return (
                    <DropdownMenuCheckboxItem
                      key={t.id}
                      checked={!hiddenTiles.includes(t.id) && !out}
                      disabled={out}
                      onCheckedChange={(checked) => onSetTileHidden(t.id, !checked)}
                    >
                      <i className={`ph ph-${t.icon}`} aria-hidden="true" />
                      {t.title}
                      {out && <span className="ml-auto text-[0.65rem] text-muted-foreground">in window</span>}
                    </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Windows</DropdownMenuLabel>
                {poppedOutList.map((t) => (
                  <DropdownMenuItem key={t.id} onClick={() => onDockTile(t.id)}>
                    <i className="ph ph-arrow-square-in" aria-hidden="true" />
                    Dock {t.title}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem onClick={onNewRadarWindow}>
                  <i className="ph ph-plus-square" aria-hidden="true" />
                  New independent radar window
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onResetLayout}>
                <i className="ph ph-arrow-counter-clockwise" aria-hidden="true" />
                Reset layout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <button
          type="button"
          className={`unit-btn ${radioEnabled ? "active" : ""}`}
          style={{ borderRadius: "var(--radius)" }}
          onClick={onOpenRadio}
          title="Weather Radio"
          aria-label="Weather Radio"
        >
          <i className="ph ph-radio" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`refresh-btn ${isRefreshing ? "spinning" : ""}`}
          onClick={onRefresh}
          title="Refresh"
          aria-label="Refresh"
        >
          <span className="ri">↻</span>
        </button>
        <div className="unit-toggle">
          <button type="button" className={`unit-btn ${unit === "F" ? "active" : ""}`} onClick={() => onSetUnit("F")}>
            °F
          </button>
          <button type="button" className={`unit-btn ${unit === "C" ? "active" : ""}`} onClick={() => onSetUnit("C")}>
            °C
          </button>
        </div>
        {!isMac && <WindowControlButtons />}
      </div>
    </div>
  );
}
