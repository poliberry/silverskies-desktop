"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface BentoTileProps {
  title?: string;
  /** Phosphor icon name (without the `ph-` prefix). */
  icon?: string;
  /** Right-aligned header controls. Clicks on these never start a drag —
   * see BENTO_DRAG_CANCEL in BentoGrid. */
  actions?: ReactNode;
  /** Skip the standard header entirely, for tiles whose content already
   * has its own header row (the audit log) — that content is then
   * responsible for rendering a `.bento-drag-handle` itself. */
  headerless?: boolean;
  /** Drops the body's inner padding, for edge-to-edge content (the radar). */
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

/** The grip that starts a tile drag. Exported for headerless tiles that
 * need to place it inside their own header row. */
export function BentoGrip() {
  return (
    <span className="bento-grip" aria-hidden="true">
      <i className="ph ph-dots-six-vertical" />
    </span>
  );
}

/** One cell of the main window's bento canvas — a rounded glass panel with
 * a slim draggable header. Always fills whatever grid cell it's placed in;
 * size/position are owned by BentoGrid, never by the tile itself. */
export function BentoTile({
  title,
  icon,
  actions,
  headerless,
  flush,
  className,
  bodyClassName,
  children,
}: BentoTileProps) {
  return (
    <section className={cn("bento-tile", className)}>
      {!headerless && (
        <header className="bento-tile-header bento-drag-handle">
          <BentoGrip />
          {icon && <i className={`ph ph-${icon} bento-tile-icon`} aria-hidden="true" />}
          {title && <h2 className="bento-tile-title">{title}</h2>}
          <div className="flex-1" />
          {actions && <div className="bento-tile-actions">{actions}</div>}
        </header>
      )}
      <div className={cn("bento-tile-body", flush && "bento-tile-body-flush", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

/** Small icon-only button for tile headers, matching the tile chrome. */
export function BentoTileAction({
  icon,
  label,
  onClick,
  active,
}: {
  icon: string;
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn("bento-tile-action", active && "active")}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <i className={`ph ph-${icon}`} aria-hidden="true" />
    </button>
  );
}
