import type { ConfigFile, LocationsFile, SavedLocation } from "./settings";

// Mirrors the shape contextBridge.exposeInMainWorld("silverSkies", ...)
// exposes from electron/preload.ts. Kept as a separate declaration since
// renderer/ can't import from the electron/ package.
export interface SilverSkiesApi {
  locations: {
    get(): Promise<LocationsFile>;
    add(location: Omit<SavedLocation, "id">): Promise<LocationsFile>;
    remove(id: string): Promise<LocationsFile>;
    update(id: string, patch: Partial<Omit<SavedLocation, "id">>): Promise<LocationsFile>;
    setActive(id: string | null): Promise<LocationsFile>;
  };
  config: {
    get(): Promise<ConfigFile>;
    set(patch: Partial<ConfigFile>): Promise<ConfigFile>;
  };
  app: {
    getVersion(): Promise<string>;
    openExternal(url: string): Promise<void>;
    setOverlayIcon(dataUrl: string | null, description: string): Promise<void>;
    notify(title: string, body: string): Promise<void>;
  };
}

declare global {
  interface Window {
    silverSkies?: SilverSkiesApi;
  }
}
