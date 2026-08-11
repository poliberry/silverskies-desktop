import { contextBridge, ipcRenderer } from "electron";
import type { ConfigFile, LocationsFile, SavedLocation } from "./types";

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
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke("app:openExternal", url),
    setOverlayIcon: (dataUrl: string | null, description: string): Promise<void> =>
      ipcRenderer.invoke("app:setOverlayIcon", dataUrl, description),
    notify: (title: string, body: string): Promise<void> => ipcRenderer.invoke("app:notify", title, body),
  },
};

export type SilverSkiesApi = typeof api;

contextBridge.exposeInMainWorld("silverSkies", api);
