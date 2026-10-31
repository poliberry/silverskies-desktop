"use client";

import { useMemo, type ReactNode } from "react";
import ReactGridLayout, { useContainerWidth, verticalCompactor, type Layout } from "react-grid-layout";
import { BENTO_COLS, BENTO_MARGIN, BENTO_ROW_HEIGHT, type BentoTileId } from "@/lib/bento-layout";
import type { LayoutItem } from "react-grid-layout";
import { cn } from "@/lib/utils";

/** Anything interactive inside a tile header — clicking these must never
 * be swallowed by the drag gesture. */
const BENTO_DRAG_CANCEL = "button, a, input, select, textarea, [role='button'], [role='combobox'], .no-tile-drag";

export interface BentoGridProps {
  /** Full stored layout, including tiles not currently rendered. */
  layout: LayoutItem[];
  /** Tiles to actually render, in any order — each keyed by tile id. Tiles
   * absent from this map (hidden, popped out, or waiting on data) are left
   * out of the grid and the rest reflow around them. */
  tiles: Partial<Record<BentoTileId, ReactNode>>;
  editable: boolean;
  onLayoutChange: (visible: Layout) => void;
}

export function BentoGrid({ layout, tiles, editable, onLayoutChange }: BentoGridProps) {
  const { width, containerRef, mounted } = useContainerWidth();

  const ids = Object.keys(tiles) as BentoTileId[];
  const idKey = ids.join("|");
  const visibleLayout = useMemo(
    () => layout.filter((item) => idKey.split("|").includes(item.i)),
    [layout, idKey],
  );

  return (
    <div ref={containerRef} className={cn("bento-grid w-full", editable && "bento-grid-editable")}>
      {mounted && (
        <ReactGridLayout
          width={width}
          layout={visibleLayout}
          gridConfig={{
            cols: BENTO_COLS,
            rowHeight: BENTO_ROW_HEIGHT,
            margin: BENTO_MARGIN,
            containerPadding: [0, 0],
          }}
          dragConfig={{
            enabled: editable,
            handle: ".bento-drag-handle",
            cancel: BENTO_DRAG_CANCEL,
          }}
          resizeConfig={{ enabled: editable, handles: ["se", "e", "s"] }}
          compactor={verticalCompactor}
          onLayoutChange={onLayoutChange}
        >
          {ids.map((id) => (
            <div key={id} className="bento-cell">
              {tiles[id]}
            </div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  );
}
