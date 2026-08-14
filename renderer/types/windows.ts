// Mirrors electron/types.ts's window/session types — kept as a separate
// copy since renderer/ and electron/ are independent TypeScript projects.
// Field names must stay in sync with the IPC contract in electron/preload.ts.

/** A window's "kind" — every non-main window carries its own independent
 * radar/conditions/audit-log state. "alert" windows are transient (token
 * handoff only) and are never persisted/restored across launches. */
export type WindowRole = "main" | "radar" | "conditions" | "alert" | "auditLog" | "browser" | "weatherRadio";

export interface WindowLocation {
  lat: number;
  lon: number;
  label: string;
}

/** A map viewport (or a user-drawn selection within one), as
 * [west, south, east, north] — same tuple shape as lib/alerts/librewxr.ts's
 * own `BBox`, duplicated here rather than imported since this type is also
 * mirrored into electron/types.ts, which can't see renderer/lib. Relayed
 * fire-and-forget between a radar instance and its paired audit-log
 * window(s), the same way WindowLocation is — but never persisted to
 * session.json, since a viewport isn't part of a window's identity the way
 * its location is. */
export type MapViewBounds = [west: number, south: number, east: number, north: number];

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

export interface OpenBrowserWindowOptions {
  url: string;
  title?: string;
}

/** Pushed from the main process whenever the embedded page in a "browser"
 * role window navigates, finishes loading, or changes title — see
 * electron/main.ts's attachBrowserContentView. */
export interface BrowserWindowState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}
