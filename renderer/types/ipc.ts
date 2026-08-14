import type { ConfigFile, LocationsFile, SavedLocation } from "./settings";
import type { AppInfo, UpdaterStatus } from "./updater";
import type { BrowserWindowState, MapViewBounds, WindowLocation } from "./windows";
import type { NormalizedAlert } from "./alerts";

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
    getInfo(): Promise<AppInfo>;
    openExternal(url: string): Promise<void>;
    setOverlayIcon(dataUrl: string | null, description: string): Promise<void>;
    notify(title: string, body: string): Promise<void>;
  };
  updater: {
    check(): Promise<void>;
    download(): Promise<void>;
    install(): Promise<void>;
    getStatus(): Promise<UpdaterStatus>;
    onStatus(callback: (status: UpdaterStatus) => void): () => void;
  };
  windows: {
    openRadar(opts?: {
      instanceId?: string;
      location?: WindowLocation | null;
      isPrimaryPopout?: boolean;
    }): Promise<void>;
    openConditions(opts: { instanceId: string; location?: WindowLocation | null }): Promise<void>;
    openAuditLog(opts: {
      instanceId: string;
      location?: WindowLocation | null;
      isPrimaryPopout?: boolean;
    }): Promise<void>;
    openAlert(alert: NormalizedAlert): Promise<void>;
    getAlertPayload(token: string): Promise<NormalizedAlert | null>;
    sendInstanceLocation(instanceId: string, location: WindowLocation): void;
    onInstanceLocation(callback: (location: WindowLocation) => void): () => void;
    sendInstanceBounds(instanceId: string, bounds: MapViewBounds): void;
    onInstanceBounds(callback: (bounds: MapViewBounds) => void): () => void;
    getInstanceBounds(instanceId: string): Promise<MapViewBounds | null>;
    onPrimaryRadarClosed(callback: () => void): () => void;
    isPrimaryRadarOpen(): Promise<boolean>;
    onPrimaryAuditLogClosed(callback: () => void): () => void;
    isPrimaryAuditLogOpen(): Promise<boolean>;
    openBrowser(opts: { url: string; title?: string }): Promise<void>;
    openWeatherRadio(opts: { instanceId: string; location?: WindowLocation | null }): Promise<void>;
  };
  browser: {
    navigate(url: string): Promise<void>;
    goBack(): Promise<void>;
    goForward(): Promise<void>;
    reload(): Promise<void>;
    reportChromeHeight(height: number): void;
    onState(callback: (state: BrowserWindowState) => void): () => void;
  };
  windowControls: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    onMaximizeChanged(callback: (isMaximized: boolean) => void): () => void;
  };
}

declare global {
  interface Window {
    silverSkies?: SilverSkiesApi;
  }
}
