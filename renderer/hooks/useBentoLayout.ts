import { useCallback, useEffect, useState } from "react";
import type { Layout } from "react-grid-layout";
import {
  defaultBentoLayout,
  loadBentoState,
  mergeVisibleLayout,
  saveBentoState,
  type BentoState,
  type BentoTileId,
} from "@/lib/bento-layout";

export interface BentoLayoutApi extends BentoState {
  onLayoutChange: (visible: Layout) => void;
  setHidden: (id: BentoTileId, hidden: boolean) => void;
  setLocked: (locked: boolean) => void;
  resetLayout: () => void;
}

export function useBentoLayout(): BentoLayoutApi {
  // Safe to read synchronously — Shell only ever mounts client-side, after
  // WindowRouter has parsed the window's URL params (see WindowRouter.tsx).
  const [state, setState] = useState<BentoState>(loadBentoState);

  useEffect(() => {
    saveBentoState(state);
  }, [state]);

  const onLayoutChange = useCallback((visible: Layout) => {
    setState((s) => ({ ...s, layout: mergeVisibleLayout(s.layout, visible) }));
  }, []);

  const setHidden = useCallback((id: BentoTileId, hidden: boolean) => {
    setState((s) => ({
      ...s,
      hidden: hidden ? [...new Set([...s.hidden, id])] : s.hidden.filter((h) => h !== id),
    }));
  }, []);

  const setLocked = useCallback((locked: boolean) => {
    setState((s) => ({ ...s, locked }));
  }, []);

  const resetLayout = useCallback(() => {
    setState((s) => ({ ...s, layout: defaultBentoLayout(), hidden: [] }));
  }, []);

  return { ...state, onLayoutChange, setHidden, setLocked, resetLayout };
}
