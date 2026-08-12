import { contextBridge, ipcRenderer } from "electron";
import type {
  AppInfo,
  ConfigFile,
  LocationsFile,
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
    // Fires when the one radar window that undocked the main window's own
    // radar (opened via openRadar({isPrimaryPopout:true})) closes, so Shell
    // knows to redock.
    onPrimaryRadarClosed: (callback: () => void): (() => void) => {
      const listener = () => callback();
      ipcRenderer.on("windows:primaryRadarClosed", listener);
      return () => ipcRenderer.removeListener("windows:primaryRadarClosed", listener);
    },
  },
};

export type SilverSkiesApi = typeof api;

contextBridge.exposeInMainWorld("silverSkies", api);
