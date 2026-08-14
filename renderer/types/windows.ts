// Mirrors electron/types.ts's window/session types — kept as a separate
// copy since renderer/ and electron/ are independent TypeScript projects.
// Field names must stay in sync with the IPC contract in electron/preload.ts.

/** A window's "kind" — every non-main window carries its own independent
 * radar/conditions/audit-log state. "alert" windows are transient (token
 * handoff only) and are never persisted/restored across launches. */
export type WindowRole = "main" | "radar" | "conditions" | "alert" | "auditLog";

export interface WindowLocation {
  lat: number;
  lon: number;
  label: string;
}

export interface WindowBoundsRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SessionWindowEntry {
  role: WindowRole;
  /** Unique per radar/conditions instance. Absent for "main". */
  instanceId?: string;
  /** For a "conditions"/"auditLog" window, the radar instanceId (or the
   * "main" sentinel) whose location it tracks. */
  pairedInstanceId?: string;
  isPrimaryPopout?: boolean;
  location?: WindowLocation | null;
  bounds?: WindowBoundsRect;
}

export interface SessionFile {
  windows: SessionWindowEntry[];
}

export interface OpenRadarWindowOptions {
  instanceId?: string;
  location?: WindowLocation | null;
  /** True only for the single pop-out that undocks the main window's own
   * radar — Shell listens for this specific instance closing to redock. */
  isPrimaryPopout?: boolean;
}

export interface OpenConditionsWindowOptions {
  instanceId: string;
  location?: WindowLocation | null;
}

export interface OpenAuditLogWindowOptions {
  /** A real radar window's own instanceId, or the "main" sentinel used for
   * the main window's own docked audit log (see electron/main.ts). */
  instanceId: string;
  location?: WindowLocation | null;
  /** True only for the single pop-out that undocks the main window's own
   * audit log — Shell listens for this specific instance closing to redock. */
  isPrimaryPopout?: boolean;
}
