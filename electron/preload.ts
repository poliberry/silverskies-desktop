import { contextBridge, ipcRenderer } from "electron";
import type {
  AppInfo,
  ConfigFile,
  LocationsFile,
  MapViewBounds,
  SavedLocation,
  UpdaterStatus,
  WindowLocation,
} from "./types";

/**
 * Narrow, typed bridge exposed to the renderer as `window.silverSkies`.
 * The renderer never gets direct `fs`/`ipcRenderer` access — only these
 * specific request/response calls, matching the IPC handlers in main.ts.
 */
const api = {
  locations: {
    get: (): Promise<LocationsFile> => ipcRenderer.invoke("locations:get"),
    add: (location: Omit<SavedLocation, "id">): Promise<LocationsFile> =>
      ipcRenderer.invoke("locations:add", location),
    remove: (id: string): Promise<LocationsFile> => ipcRenderer.invoke("locations:remove", id),
    update: (id: string, patch: Partial<Omit<SavedLocation, "id">>): Promise<LocationsFile> =>
      ipcRenderer.invoke("locations:update", id, patch),
    setActive: (id: string | null): Promise<LocationsFile> =>
      ipcRenderer.invoke("locations:setActive", id),
  },
  config: {
    get: (): Promise<ConfigFile> => ipcRenderer.invoke("config:get"),
    set: (patch: Partial<ConfigFile>): Promise<ConfigFile> => ipcRenderer.invoke("config:set", patch),
  },
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke("app:getVersion"),
    getInfo: (): Promise<AppInfo> => ipcRenderer.invoke("app:getInfo"),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke("app:openExternal", url),
    setOverlayIcon: (dataUrl: string | null, description: string): Promise<void> =>
      ipcRenderer.invoke("app:setOverlayIcon", dataUrl, description),
    notify: (title: string, body: string): Promise<void> => ipcRenderer.invoke("app:notify", title, body),
  },
  updater: {
    check: (): Promise<void> => ipcRenderer.invoke("updater:check"),
    download: (): Promise<void> => ipcRenderer.invoke("updater:download"),
    install: (): Promise<void> => ipcRenderer.invoke("updater:install"),
    getStatus: (): Promise<UpdaterStatus> => ipcRenderer.invoke("updater:getStatus"),
    onStatus: (callback: (status: UpdaterStatus) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: UpdaterStatus) => callback(status);
      ipcRenderer.on("updater:status", listener);
      return () => ipcRenderer.removeListener("updater:status", listener);
    },
  },
  windows: {
    openRadar: (opts?: {
      instanceId?: string;
      location?: WindowLocation | null;
      isPrimaryPopout?: boolean;
    }): Promise<void> => ipcRenderer.invoke("windows:openRadar", opts ?? {}),
    openConditions: (opts: { instanceId: string; location?: WindowLocation | null }): Promise<void> =>
      ipcRenderer.invoke("windows:openConditions", opts),
    openAuditLog: (opts: {
      instanceId: string;
      location?: WindowLocation | null;
      isPrimaryPopout?: boolean;
    }): Promise<void> => ipcRenderer.invoke("windows:openAuditLog", opts),
    // `alert` is an opaque, JSON-serializable payload (a NormalizedAlert on
    // the renderer side) — the main process just stashes it in memory and
    // hands it back once to whichever window asks for this token, so it
    // isn't typed any more narrowly here (electron/'s TS project has no
    // access to renderer/'s alert types).
    openAlert: (alert: unknown): Promise<void> => ipcRenderer.invoke("windows:openAlert", alert),
    getAlertPayload: (token: string): Promise<unknown> => ipcRenderer.invoke("windows:getAlertPayload", token),
    // Fire-and-forget: a radar window announces its active location whenever
    // it changes; main relays it only to that instance's paired Conditions
    // window (if one is open), so no response/ack is meaningful here.
    sendInstanceLocation: (instanceId: string, location: WindowLocation): void =>
      ipcRenderer.send("windows:instanceLocationChanged", instanceId, location),
    onInstanceLocation: (callback: (location: WindowLocation) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, location: WindowLocation) => callback(location);
      ipcRenderer.on("windows:instanceLocation", listener);
      return () => ipcRenderer.removeListener("windows:instanceLocation", listener);
    },
    // Same fire-and-forget shape as sendInstanceLocation/onInstanceLocation
    // above, for a radar instance's current map viewport (or an active
    // shift-drag selection within it) instead of its lat/lon — powers the
    // paired audit-log window's "alerts for what's on screen" view.
    sendInstanceBounds: (instanceId: string, bounds: MapViewBounds): void =>
      ipcRenderer.send("windows:instanceBoundsChanged", instanceId, bounds),
    onInstanceBounds: (callback: (bounds: MapViewBounds) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, bounds: MapViewBounds) => callback(bounds);
      ipcRenderer.on("windows:instanceBounds", listener);
      return () => ipcRenderer.removeListener("windows:instanceBounds", listener);
    },
    // Catches a newly (re)mounted window up on whatever bbox its paired
    // radar instance already reported before it existed — onInstanceBounds
    // above only ever delivers *future* updates.
    getInstanceBounds: (instanceId: string): Promise<MapViewBounds | null> =>
      ipcRenderer.invoke("windows:getInstanceBounds", instanceId),
    // Fires when the one radar window that undocked the main window's own
    // radar (opened via openRadar({isPrimaryPopout:true})) closes, so Shell
    // knows to redock.
    onPrimaryRadarClosed: (callback: () => void): (() => void) => {
      const listener = () => callback();
      ipcRenderer.on("windows:primaryRadarClosed", listener);
      return () => ipcRenderer.removeListener("windows:primaryRadarClosed", listener);
    },
    // Lets a freshly (re)mounted Shell learn whether its radar is already
    // undocked (a pop-out window survived a main-window reload, or was
    // restored from session.json on relaunch) instead of assuming docked.
    isPrimaryRadarOpen: (): Promise<boolean> => ipcRenderer.invoke("windows:isPrimaryRadarOpen"),
    // Same pair, for the main window's own poppable audit log.
    onPrimaryAuditLogClosed: (callback: () => void): (() => void) => {
      const listener = () => callback();
      ipcRenderer.on("windows:primaryAuditLogClosed", listener);
      return () => ipcRenderer.removeListener("windows:primaryAuditLogClosed", listener);
    },
    isPrimaryAuditLogOpen: (): Promise<boolean> => ipcRenderer.invoke("windows:isPrimaryAuditLogOpen"),
    openBrowser: (opts: { url: string; title?: string }): Promise<void> =>
      ipcRenderer.invoke("windows:openBrowser", opts),
    openWeatherRadio: (opts?: { location?: WindowLocation | null }): Promise<void> =>
      ipcRenderer.invoke("windows:openWeatherRadio", opts ?? {}),
  },
  // Controls for the sandboxed WebContentsView a "browser" role window
  // embeds (see electron/main.ts's attachBrowserContentView) — the
  // navigation itself happens entirely in the main process, so these are
  // just remote-control calls plus a push-state subscription.
  browser: {
    navigate: (url: string): Promise<void> => ipcRenderer.invoke("browser:navigate", url),
    goBack: (): Promise<void> => ipcRenderer.invoke("browser:goBack"),
    goForward: (): Promise<void> => ipcRenderer.invoke("browser:goForward"),
    reload: (): Promise<void> => ipcRenderer.invoke("browser:reload"),
    reportChromeHeight: (height: number): void => ipcRenderer.send("browser:chromeHeight", height),
    onState: (
      callback: (state: {
        url: string;
        title: string;
        canGoBack: boolean;
        canGoForward: boolean;
        isLoading: boolean;
      }) => void,
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        state: { url: string; title: string; canGoBack: boolean; canGoForward: boolean; isLoading: boolean },
      ) => callback(state);
      ipcRenderer.on("browser:state", listener);
      return () => ipcRenderer.removeListener("browser:state", listener);
    },
  },
  // Every window is frameless and draws its own titlebar (drag region +
  // these three buttons) — see WindowControlButtons.tsx on the renderer
  // side. Scoped to "whichever window made this call" in main.ts, so the
  // same calls work from the main window's TopBar or any pop-out's toolbar.
  windowControls: {
    minimize: (): Promise<void> => ipcRenderer.invoke("windowControls:minimize"),
    toggleMaximize: (): Promise<void> => ipcRenderer.invoke("windowControls:toggleMaximize"),
    close: (): Promise<void> => ipcRenderer.invoke("windowControls:close"),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke("windowControls:isMaximized"),
    onMaximizeChanged: (callback: (isMaximized: boolean) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, isMaximized: boolean) => callback(isMaximized);
      ipcRenderer.on("windowControls:maximizeChanged", listener);
      return () => ipcRenderer.removeListener("windowControls:maximizeChanged", listener);
    },
  },
};

export type SilverSkiesApi = typeof api;

contextBridge.exposeInMainWorld("silverSkies", api);
