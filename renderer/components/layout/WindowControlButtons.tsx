"use client";

import { useWindowControls } from "@/hooks/useWindowControls";

export interface WindowControlButtonsProps {
  /** Icon font-size in px — the surrounding button hit-target stays fixed
   * (32x22) regardless, only the glyph scales. */
  iconSize?: number;
}

/** Minimize/maximize/close — every window is frameless (see
 * electron/main.ts's createAppWindow) and draws its own titlebar, so this
 * is the one titlebar-button set reused identically in the main window's
 * TopBar and every radar/conditions/alert pop-out's own toolbar. Must sit
 * inside (or itself carry) `.no-drag`, since it's typically placed at the
 * end of a `.drag-region` bar. */
export function WindowControlButtons({ iconSize = 11 }: WindowControlButtonsProps) {
  const { isMaximized, minimize, toggleMaximize, close } = useWindowControls();

  return (
    <div className="window-controls no-drag">
      <button type="button" className="window-control-btn" onClick={minimize} title="Minimize" aria-label="Minimize">
        <i className="ph ph-minus" aria-hidden="true" style={{ fontSize: iconSize }} />
      </button>
      <button
        type="button"
        className="window-control-btn"
        onClick={toggleMaximize}
        title={isMaximized ? "Restore" : "Maximize"}
        aria-label={isMaximized ? "Restore" : "Maximize"}
      >
        <i className={`ph ${isMaximized ? "ph-copy-simple" : "ph-square"}`} aria-hidden="true" style={{ fontSize: iconSize }} />
      </button>
      <button type="button" className="window-control-btn close-btn" onClick={close} title="Close" aria-label="Close">
        <i className="ph ph-x" aria-hidden="true" style={{ fontSize: iconSize }} />
      </button>
    </div>
  );
}
