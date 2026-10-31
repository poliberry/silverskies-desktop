import { useCallback, useEffect, useRef, useState } from "react";
import { ipc } from "@/lib/ipc-client";
import { isBentoTileId, type BentoTileId } from "@/lib/bento-layout";
import type { WindowLocation } from "@/types/windows";

export interface PoppedOutTilesApi {
  /** Tiles currently open in their own window. */
  poppedOut: ReadonlySet<BentoTileId>;
  /** False until main has told us which tile windows already exist — a
   * pop-out can outlive a main-window reload, or be restored from
   * session.json on relaunch, and until we know, tiles like the radar
   * shouldn't mount something that may immediately unmount again. */
  known: boolean;
  popOut: (id: BentoTileId, location: WindowLocation | null, sourceEl?: Element | null) => void;
  dock: (id: BentoTileId) => void;
}

/** Opens a pop-out at the tile's own on-screen position and size, so it
 * reads as the tile lifting off the canvas rather than a window appearing
 * somewhere arbitrary. Returns undefined (main's default size) if the tile's
 * element isn't available. */
function screenBoundsOf(el: Element | null | undefined) {
  const cell = el?.closest(".bento-cell") ?? el;
  if (!cell) return undefined;
  const r = cell.getBoundingClientRect();
  // With titleBarStyle "hidden" there's no OS chrome above the page, but
  // measure it anyway rather than assume.
  const chromeTop = Math.max(0, window.outerHeight - window.innerHeight);
  return {
    x: Math.round(window.screenX + r.left),
    y: Math.round(window.screenY + chromeTop + r.top),
    width: Math.max(260, Math.round(r.width)),
    height: Math.max(160, Math.round(r.height)),
  };
}

export function usePoppedOutTiles(): PoppedOutTilesApi {
  const [poppedOut, setPoppedOut] = useState<ReadonlySet<BentoTileId>>(new Set());
  const [known, setKnown] = useState(false);
  // Guards against a double-click opening two windows before React has
  // re-rendered with the first click's state update.
  const inFlight = useRef(new Set<BentoTileId>());

  useEffect(() => {
    let cancelled = false;
    void ipc.windows.getOpenTiles().then((ids) => {
      if (cancelled) return;
      setPoppedOut((current) => new Set([...current, ...ids.filter(isBentoTileId)]));
      setKnown(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () =>
      ipc.windows.onTileClosed((id) => {
        if (!isBentoTileId(id)) return;
        inFlight.current.delete(id);
        setPoppedOut((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }),
    [],
  );

  const popOut = useCallback((id: BentoTileId, location: WindowLocation | null, sourceEl?: Element | null) => {
    if (inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setPoppedOut((current) => new Set([...current, id]));
    void ipc.windows.openTile({ tileId: id, location, bounds: screenBoundsOf(sourceEl) });
  }, []);

  const dock = useCallback((id: BentoTileId) => {
    void ipc.windows.closeTile(id);
  }, []);

  return { poppedOut, known, popOut, dock };
}
