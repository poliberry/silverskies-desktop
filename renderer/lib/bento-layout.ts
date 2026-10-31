import type { Layout, LayoutItem } from "react-grid-layout";

/** Every tile the main window's bento canvas knows how to render — see
 * Shell.tsx for what each one actually shows. */
export type BentoTileId =
  | "current"
  | "stats"
  | "hourly"
  | "radar"
  | "alerts"
  | "forecast"
  | "details"
  | "sun";

export interface BentoTileMeta {
  id: BentoTileId;
  title: string;
  /** Phosphor icon name (without the `ph-` prefix). */
  icon: string;
  minW: number;
  minH: number;
  /** Extra classes for the tile body (e.g. scrolling for long content). */
  bodyClassName?: string;
  /** Edge-to-edge body with no inner padding (the radar map). */
  flush?: boolean;
  /** The tile's content already draws its own header row (the audit log),
   * so the tile chrome skips its standard one. */
  headerless?: boolean;
}

export const BENTO_COLS = 12;
export const BENTO_ROW_HEIGHT = 36;
export const BENTO_MARGIN: [number, number] = [10, 10];

export const BENTO_TILES: BentoTileMeta[] = [
  { id: "current", title: "Now", icon: "map-pin", minW: 3, minH: 4 },
  { id: "stats", title: "Stats", icon: "gauge", minW: 3, minH: 2 },
  { id: "hourly", title: "Hourly", icon: "clock", minW: 3, minH: 3, bodyClassName: "px-0" },
  { id: "radar", title: "Radar", icon: "broadcast", minW: 4, minH: 6, flush: true },
  { id: "alerts", title: "Audit Log", icon: "warning", minW: 3, minH: 5, headerless: true },
  {
    id: "forecast",
    title: "7-Day Forecast",
    icon: "calendar-dots",
    minW: 3,
    minH: 5,
    bodyClassName: "overflow-y-auto thin-scroll",
  },
  {
    id: "details",
    title: "Conditions Detail",
    icon: "list-magnifying-glass",
    minW: 2,
    minH: 5,
    bodyClassName: "overflow-y-auto thin-scroll",
  },
  { id: "sun", title: "Sun Position", icon: "sun-horizon", minW: 3, minH: 5, bodyClassName: "overflow-y-auto thin-scroll" },
];

export function isBentoTileId(id: string): id is BentoTileId {
  return BENTO_TILES.some((t) => t.id === id);
}

export const BENTO_TILE_BY_ID = Object.fromEntries(BENTO_TILES.map((t) => [t.id, t])) as Record<
  BentoTileId,
  BentoTileMeta
>;

const DEFAULT_POSITIONS: Record<BentoTileId, Pick<LayoutItem, "x" | "y" | "w" | "h">> = {
  current: { x: 0, y: 0, w: 4, h: 5 },
  stats: { x: 0, y: 5, w: 4, h: 3 },
  sun: { x: 0, y: 8, w: 4, h: 6 },
  radar: { x: 4, y: 0, w: 8, h: 14 },
  hourly: { x: 0, y: 14, w: 8, h: 4 },
  alerts: { x: 8, y: 14, w: 4, h: 12 },
  forecast: { x: 0, y: 18, w: 5, h: 8 },
  details: { x: 5, y: 18, w: 3, h: 8 },
};

function withConstraints(item: Pick<LayoutItem, "i" | "x" | "y" | "w" | "h">): LayoutItem {
  const meta = BENTO_TILE_BY_ID[item.i as BentoTileId];
  return {
    i: item.i,
    x: item.x,
    y: item.y,
    w: Math.max(item.w, meta.minW),
    h: Math.max(item.h, meta.minH),
    minW: meta.minW,
    minH: meta.minH,
  };
}

export function defaultBentoLayout(): LayoutItem[] {
  return BENTO_TILES.map((t) => withConstraints({ i: t.id, ...DEFAULT_POSITIONS[t.id] }));
}

export interface BentoState {
  /** Positions for *every* tile, including hidden ones — so un-hiding a
   * tile puts it back roughly where it was instead of dumping it at the
   * bottom of the canvas. */
  layout: LayoutItem[];
  /** Tiles the user switched off from the Advanced "Tiles" menu. Ignored in
   * Classic mode, which always shows everything. */
  hidden: BentoTileId[];
  /** Advanced-only: freezes drag/resize so tiles can't be knocked around by
   * accident (e.g. panning the radar near a tile edge). */
  locked: boolean;
}

const STORAGE_KEY = "silverskies.bento.v1";

export function defaultBentoState(): BentoState {
  return { layout: defaultBentoLayout(), hidden: [], locked: false };
}

/** Reads the persisted canvas, repairing anything stale — unknown tile ids
 * (a tile removed in a later version) are dropped, missing ones (a tile
 * added since the layout was saved) get their default slot, and min sizes
 * always come from the current tile registry rather than whatever was
 * saved alongside them. */
export function loadBentoState(): BentoState {
  if (typeof window === "undefined") return defaultBentoState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultBentoState();
    const parsed = JSON.parse(raw) as Partial<BentoState>;
    const known = new Set<string>(BENTO_TILES.map((t) => t.id));
    const saved = new Map(
      (parsed.layout ?? []).filter((item) => known.has(item.i)).map((item) => [item.i, item]),
    );
    const layout = BENTO_TILES.map((t) =>
      withConstraints(saved.get(t.id) ?? { i: t.id, ...DEFAULT_POSITIONS[t.id] }),
    );
    const hidden = (parsed.hidden ?? []).filter((id): id is BentoTileId => known.has(id));
    return { layout, hidden, locked: Boolean(parsed.locked) };
  } catch {
    return defaultBentoState();
  }
}

export function saveBentoState(state: BentoState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota/private-mode failures just mean the layout won't survive a
    // restart — not worth surfacing.
  }
}

/** Folds the grid's reported layout (visible tiles only) back into the
 * full stored layout, keeping hidden tiles' last known positions. */
export function mergeVisibleLayout(stored: LayoutItem[], visible: Layout): LayoutItem[] {
  const next = new Map(visible.map((item) => [item.i, item]));
  return stored.map((item) => {
    const moved = next.get(item.i);
    return moved ? withConstraints(moved) : item;
  });
}
